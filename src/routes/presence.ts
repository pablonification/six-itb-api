/**
 * Presence Routes - Check and mark attendance
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getBrowserPool } from '../services/browser-pool.js';
import { getSessionStore } from '../services/session-store.js';
import {
  checkPresenceAvailability,
  markPresence,
  scrapeTodaySchedule,
  scrapeCourseModal,
  navigateToSchedule,
  checkSessionValid,
  detectCurrentSemester,
} from '../services/six-scraper.js';

// Validation schemas
const SessionIdSchema = z.object({
  sessionId: z.string().min(1),
});

const SemesterSchema = z.object({
  sessionId: z.string().min(1),
  semester: z.string().optional(),
});

export async function presenceRoutes(app: FastifyInstance) {
  const browserPool = getBrowserPool();
  const sessionStore = getSessionStore();

  /**
   * GET /presence/status - Check if presence can be marked now
   */
  app.get('/status', async (request, reply) => {
    const query = SemesterSchema.safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'sessionId is required' },
      });
    }

    const { sessionId, semester } = query.data;

    try {
      const session = sessionStore.getSession(sessionId);
      if (!session) {
        return reply.status(404).send({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
        });
      }

      const nim = session.nim;
      if (!nim) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NIM_NOT_SET', message: 'NIM not found in session' },
        });
      }

      const activeSemester = semester || session.semester || detectCurrentSemester();

      // Create context with session cookies
      const context = await browserPool.createContext(sessionId, session.cookies);
      const page = await context.newPage();

      // Navigate to schedule page
      await navigateToSchedule(page, nim, activeSemester);

      const isValid = await checkSessionValid(page);
      if (!isValid) {
        await page.close();
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session has expired' },
        });
      }

      // Check presence availability
      const status = await checkPresenceAvailability(page);
      await page.close();

      return { success: true, data: status };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'CHECK_ERROR',
          message: error instanceof Error ? error.message : 'Failed to check presence status',
        },
      });
    }
  });

  /**
   * POST /presence/mark - Mark presence for current class
   */
  app.post('/mark', async (request, reply) => {
    const schema = z.object({
      sessionId: z.string().min(1),
      semester: z.string().optional(),
    });

    const body = schema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'sessionId is required' },
      });
    }

    const { sessionId, semester } = body.data;

    try {
      const session = sessionStore.getSession(sessionId);
      if (!session) {
        return reply.status(404).send({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
        });
      }

      const nim = session.nim;
      if (!nim) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NIM_NOT_SET', message: 'NIM not found in session' },
        });
      }

      const activeSemester = semester || session.semester || detectCurrentSemester();

      const context = await browserPool.createContext(sessionId, session.cookies);
      const page = await context.newPage();

      await navigateToSchedule(page, nim, activeSemester);

      const isValid = await checkSessionValid(page);
      if (!isValid) {
        await page.close();
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session has expired' },
        });
      }

      // Get today's schedule
      const todayCourses = await scrapeTodaySchedule(page);

      if (todayCourses.length === 0) {
        await page.close();
        return {
          success: false,
          error: { code: 'NO_CLASSES', message: 'No classes scheduled for today' },
        };
      }

      const now = new Date();
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

      // Find current class
      let marked = false;
      let result: { success: boolean; course?: string; date?: string; time?: string; error?: string } = {
        success: false,
        error: 'No active class found',
      };

      for (const course of todayCourses) {
        const [startH, startM] = course.time.split(' - ')[0].split(':').map(Number);
        const [endH, endM] = course.time.split(' - ')[1].split(':').map(Number);

        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        // Check if within class time (with 15 min before, 30 min after buffer)
        if (currentTimeMinutes >= startMinutes - 15 && currentTimeMinutes <= endMinutes + 30) {
          // Click on the course to open modal
          const courseLinks = await page.$$('a');
          for (const link of courseLinks) {
            const text = await link.textContent();
            if (text?.includes(course.courseCode)) {
              await link.click();
              await page.waitForTimeout(1000);

              // Try to mark presence
              const markResult = await markPresence(page);
              if (markResult.success) {
                marked = true;
                result = markResult;
                break;
              }

              // Close modal
              await page.keyboard.press('Escape');
              await page.waitForTimeout(500);
            }
          }
        }

        if (marked) break;
      }

      await page.close();

      return { success: true, data: result };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'MARK_ERROR',
          message: error instanceof Error ? error.message : 'Failed to mark presence',
        },
      });
    }
  });

  /**
   * POST /presence/mark-course - Mark presence for a specific course
   */
  app.post('/mark-course', async (request, reply) => {
    const schema = z.object({
      sessionId: z.string().min(1),
      semester: z.string().optional(),
      courseCode: z.string().min(1),
    });

    const body = schema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'sessionId and courseCode are required' },
      });
    }

    const { sessionId, semester, courseCode } = body.data;

    try {
      const session = sessionStore.getSession(sessionId);
      if (!session) {
        return reply.status(404).send({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
        });
      }

      const nim = session.nim;
      if (!nim) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NIM_NOT_SET', message: 'NIM not found in session' },
        });
      }

      const activeSemester = semester || session.semester || detectCurrentSemester();

      const context = await browserPool.createContext(sessionId, session.cookies);
      const page = await context.newPage();

      await navigateToSchedule(page, nim, activeSemester);

      const isValid = await checkSessionValid(page);
      if (!isValid) {
        await page.close();
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session has expired' },
        });
      }

      // Find and click on the course
      const courseLinks = await page.$$('a');
      let found = false;

      for (const link of courseLinks) {
        const text = await link.textContent();
        if (text?.includes(courseCode)) {
          await link.click();
          await page.waitForTimeout(1000);
          found = true;
          break;
        }
      }

      if (!found) {
        await page.close();
        return reply.status(404).send({
          success: false,
          error: { code: 'COURSE_NOT_FOUND', message: `Course ${courseCode} not found in schedule` },
        });
      }

      // Check modal info
      const modalInfo = await scrapeCourseModal(page);
      if (!modalInfo?.canMarkPresence) {
        await page.close();
        return {
          success: false,
          data: {
            canMark: false,
            message: 'Presence cannot be marked at this time',
            presenceWindow: modalInfo?.presenceWindow,
          },
        };
      }

      // Mark presence
      const result = await markPresence(page);
      await page.close();

      return { success: true, data: result };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'MARK_ERROR',
          message: error instanceof Error ? error.message : 'Failed to mark presence',
        },
      });
    }
  });

  /**
   * GET /presence/today - Get today's classes with presence status
   */
  app.get('/today', async (request, reply) => {
    const query = SemesterSchema.safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'sessionId is required' },
      });
    }

    const { sessionId, semester } = query.data;

    try {
      const session = sessionStore.getSession(sessionId);
      if (!session) {
        return reply.status(404).send({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
        });
      }

      const nim = session.nim;
      if (!nim) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NIM_NOT_SET', message: 'NIM not found in session' },
        });
      }

      const activeSemester = semester || session.semester || detectCurrentSemester();

      const context = await browserPool.createContext(sessionId, session.cookies);
      const page = await context.newPage();

      await navigateToSchedule(page, nim, activeSemester);

      const isValid = await checkSessionValid(page);
      if (!isValid) {
        await page.close();
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session has expired' },
        });
      }

      const todayCourses = await scrapeTodaySchedule(page);

      // Check each course for presence availability
      const coursesWithStatus = [];
      const now = new Date();
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

      for (const course of todayCourses) {
        const [startH, startM] = course.time.split(' - ')[0].split(':').map(Number);
        const [endH, endM] = course.time.split(' - ')[1].split(':').map(Number);

        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        // Determine class status
        let status = 'upcoming';
        if (currentTimeMinutes >= startMinutes - 15 && currentTimeMinutes <= endMinutes + 30) {
          status = 'active';
        } else if (currentTimeMinutes > endMinutes + 30) {
          status = 'finished';
        }

        coursesWithStatus.push({
          ...course,
          status,
          isPresenceWindow: status === 'active',
        });
      }

      await page.close();

      return {
        success: true,
        data: {
          date: new Date().toLocaleDateString('id-ID'),
          courses: coursesWithStatus,
        },
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'FETCH_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch today classes',
        },
      });
    }
  });
}