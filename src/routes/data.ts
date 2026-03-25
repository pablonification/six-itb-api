/**
 * Core Data Routes - Profile, Schedule, Courses, Financial, Study Plan
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getBrowserPool } from '../services/browser-pool.js';
import { getSessionStore } from '../services/session-store.js';
import {
  scrapeProfile,
  scrapeCurrentCourses,
  scrapeCourseSlots,
  scrapeSchedule,
  scrapeTodaySchedule,
  scrapeFinancialStatus,
  scrapeStudyPlan,
  navigateToProfile,
  navigateToSchedule,
  navigateToFinancial,
  navigateToStudyPlan,
  navigateToCourse,
  checkSessionValid,
  detectCurrentSemester,
} from '../services/six-scraper.js';
import type { Cookie } from '../models/types.js';

const SIX_BASE_URL = 'https://six.itb.ac.id';

// Cache with TTL for frequently accessed data
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const dataCache = new Map<string, CacheEntry<unknown>>();

// Default TTL for cached data (in milliseconds)
const DEFAULT_CACHE_TTL = 30 * 1000; // 30 seconds

function getCached<T>(key: string): T | null {
  const entry = dataCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;

  if (Date.now() > entry.timestamp + entry.ttl) {
    dataCache.delete(key);
    return null;
  }

  return entry.data;
}

function setCache<T>(key: string, data: T, ttl: number = DEFAULT_CACHE_TTL): void {
  dataCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl,
  });
}

// Helper to get session and create browser context
async function getSessionAndContext(
  sessionId: string,
  sessionStore: ReturnType<typeof getSessionStore>,
  browserPool: ReturnType<typeof getBrowserPool>
): Promise<{ cookies: Cookie[]; nim: string; semester: string }> {
  const session = sessionStore.getSession(sessionId);
  if (!session) {
    throw new Error('SESSION_NOT_FOUND');
  }

  return {
    cookies: session.cookies,
    nim: session.nim || '',
    semester: session.semester || '',
  };
}

// Helper to create a page with session cookies
async function createAuthenticatedPage(
  sessionId: string,
  cookies: Cookie[]
): Promise<{ page: import('playwright').Page; context: import('playwright').BrowserContext }> {
  const browserPool = getBrowserPool();
  const context = await browserPool.createContext(sessionId, cookies);
  const page = await context.newPage();

  return { page, context };
}

// Validation schemas
const SessionIdSchema = z.object({
  sessionId: z.string().min(1),
  refresh: z.string().optional(), // Set to "true" to bypass cache
});

const SemesterSchema = z.object({
  sessionId: z.string().min(1),
  semester: z.string().optional(), // e.g., "2024-1"
  refresh: z.string().optional(), // Set to "true" to bypass cache
});

const CourseUrlSchema = z.object({
  sessionId: z.string().min(1),
  courseUrl: z.string().url(),
  refresh: z.string().optional(),
});

export async function dataRoutes(app: FastifyInstance) {
  const browserPool = getBrowserPool();
  const sessionStore = getSessionStore();

  // ============================================
  // Profile Routes
  // ============================================

  /**
   * GET /data/profile - Get student profile
   */
  app.get('/profile', async (request, reply) => {
    const query = SessionIdSchema.safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'sessionId is required' },
      });
    }

    const { sessionId, refresh } = query.data;
    const skipCache = refresh === 'true';

    try {
      const { cookies, nim } = await getSessionAndContext(sessionId, sessionStore, browserPool);

      // Check cache first
      const cacheKey = `profile:${sessionId}`;
      if (!skipCache) {
        const cached = getCached(cacheKey);
        if (cached) {
          return { success: true, data: cached, cached: true };
        }
      }

      // If NIM not in session, try to discover it from the page
      let discoveredNim = nim;

      if (!discoveredNim) {
        // Navigate to SIX main page and look for profile links
        const { page } = await createAuthenticatedPage(sessionId, cookies);

        await page.goto(SIX_BASE_URL, { waitUntil: 'networkidle' });

        // Try to find NIM in links on the page
        try {
          discoveredNim = await page.evaluate(() => {
            // Look for links containing mahasiswa:NIM pattern
            const links = document.querySelectorAll('a[href*="mahasiswa:"]');
            for (let i = 0; i < links.length; i++) {
              const href = links[i].getAttribute('href') || '';
              const match = href.match(/mahasiswa:(\d+)/);
              if (match) return match[1];
            }

            // Try to find in text content
            const bodyText = document.body.textContent || '';
            const textMatch = bodyText.match(/NIM[:\s]*(\d{8})/i);
            if (textMatch) return textMatch[1];

            return '';
          });

          if (discoveredNim) {
            sessionStore.updateSession(sessionId, { nim: discoveredNim });
          }
        } catch {
          // Continue without NIM
        }

        await page.close();

        if (!discoveredNim) {
          return reply.status(400).send({
            success: false,
            error: { code: 'NIM_NOT_SET', message: 'NIM not found. Please provide NIM manually via PATCH /data/session/nim' },
          });
        }
      }

      const { page, context } = await createAuthenticatedPage(sessionId, cookies);

      await navigateToProfile(page, discoveredNim);

      const isValid = await checkSessionValid(page);
      if (!isValid) {
        await page.close();
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session has expired, please login again' },
        });
      }

      const profile = await scrapeProfile(page);

      // Update session with NIM if we got it from profile
      if (profile.nim && profile.nim !== discoveredNim) {
        sessionStore.updateSession(sessionId, { nim: profile.nim });
      }

      await page.close();

      // Cache the result
      setCache(cacheKey, profile);

      return { success: true, data: profile, cached: false };
    } catch (error) {
      if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
        });
      }

      return reply.status(500).send({
        success: false,
        error: {
          code: 'SCRAPING_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch profile',
        },
      });
    }
  });

  // ============================================
  // Course Routes
  // ============================================

  /**
   * GET /data/courses - Get current semester courses
   */
  app.get('/courses', async (request, reply) => {
    const query = SessionIdSchema.safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'sessionId is required' },
      });
    }

    const { sessionId, refresh } = query.data;
    const skipCache = refresh === 'true';

    try {
      const { cookies, nim } = await getSessionAndContext(sessionId, sessionStore, browserPool);

      if (!nim) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NIM_NOT_SET', message: 'NIM not found in session' },
        });
      }

      // Check cache first
      const cacheKey = `courses:${sessionId}`;
      if (!skipCache) {
        const cached = getCached(cacheKey);
        if (cached) {
          return { success: true, data: cached, cached: true };
        }
      }

      const { page } = await createAuthenticatedPage(sessionId, cookies);

      await navigateToProfile(page, nim);

      const isValid = await checkSessionValid(page);
      if (!isValid) {
        await page.close();
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session has expired' },
        });
      }

      const courses = await scrapeCurrentCourses(page);
      await page.close();

      // Cache the result
      setCache(cacheKey, courses);

      return { success: true, data: courses, cached: false };
    } catch (error) {
      if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
        });
      }

      return reply.status(500).send({
        success: false,
        error: {
          code: 'SCRAPING_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch courses',
        },
      });
    }
  });

  /**
   * GET /data/courses/slots - Get available slots for a course
   */
  app.get('/courses/slots', async (request, reply) => {
    const schema = z.object({
      sessionId: z.string().min(1),
      courseUrl: z.string().url(),
    });

    const query = schema.safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'sessionId and courseUrl are required' },
      });
    }

    const { sessionId, courseUrl } = query.data;

    try {
      const { cookies } = await getSessionAndContext(sessionId, sessionStore, browserPool);

      const { page } = await createAuthenticatedPage(sessionId, cookies);

      await navigateToCourse(page, courseUrl);

      const isValid = await checkSessionValid(page);
      if (!isValid) {
        await page.close();
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session has expired' },
        });
      }

      const slots = await scrapeCourseSlots(page);
      await page.close();

      return { success: true, data: slots };
    } catch (error) {
      if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
        });
      }

      return reply.status(500).send({
        success: false,
        error: {
          code: 'SCRAPING_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch course slots',
        },
      });
    }
  });

  // ============================================
  // Schedule Routes
  // ============================================

  /**
   * GET /data/schedule - Get schedule (requires semester)
   */
  app.get('/schedule', async (request, reply) => {
    const query = SemesterSchema.safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'sessionId is required' },
      });
    }

    const { sessionId, semester, refresh } = query.data;
    const skipCache = refresh === 'true';

    try {
      const { cookies, nim } = await getSessionAndContext(sessionId, sessionStore, browserPool);

      if (!nim) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NIM_NOT_SET', message: 'NIM not found in session' },
        });
      }

      // Default to current semester if not provided
      const activeSemester = semester || sessionStore.getSession(sessionId)?.semester || detectCurrentSemester();

      // Check cache first
      const cacheKey = `schedule:${sessionId}:${activeSemester}`;
      if (!skipCache) {
        const cached = getCached(cacheKey);
        if (cached) {
          return { success: true, data: cached, cached: true };
        }
      }

      const { page } = await createAuthenticatedPage(sessionId, cookies);

      await navigateToSchedule(page, nim, activeSemester);

      const isValid = await checkSessionValid(page);
      if (!isValid) {
        await page.close();
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session has expired' },
        });
      }

      const schedule = await scrapeSchedule(page);
      await page.close();

      // Cache the result
      setCache(cacheKey, schedule);

      return { success: true, data: schedule, cached: false };
    } catch (error) {
      if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
        });
      }

      return reply.status(500).send({
        success: false,
        error: {
          code: 'SCRAPING_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch schedule',
        },
      });
    }
  });

  /**
   * GET /data/schedule/today - Get today's schedule
   */
  app.get('/schedule/today', async (request, reply) => {
    const query = SemesterSchema.safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'sessionId is required' },
      });
    }

    const { sessionId, semester, refresh } = query.data;
    const skipCache = refresh === 'true';

    try {
      const { cookies, nim } = await getSessionAndContext(sessionId, sessionStore, browserPool);

      if (!nim) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NIM_NOT_SET', message: 'NIM not found in session' },
        });
      }

      const activeSemester = semester || sessionStore.getSession(sessionId)?.semester || detectCurrentSemester();

      // Check cache first (shorter TTL for today's schedule - 10 seconds)
      const cacheKey = `schedule-today:${sessionId}`;
      if (!skipCache) {
        const cached = getCached(cacheKey);
        if (cached) {
          return { success: true, data: cached, cached: true };
        }
      }

      const { page } = await createAuthenticatedPage(sessionId, cookies);

      await navigateToSchedule(page, nim, activeSemester);

      const isValid = await checkSessionValid(page);
      if (!isValid) {
        await page.close();
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session has expired' },
        });
      }

      const schedule = await scrapeTodaySchedule(page);
      await page.close();

      // Cache with shorter TTL for today's schedule
      setCache(cacheKey, schedule, 10 * 1000);

      return { success: true, data: schedule, cached: false };
    } catch (error) {
      if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
        });
      }

      return reply.status(500).send({
        success: false,
        error: {
          code: 'SCRAPING_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch today schedule',
        },
      });
    }
  });

  // ============================================
  // Financial Routes
  // ============================================

  /**
   * GET /data/financial - Get financial/payment status
   */
  app.get('/financial', async (request, reply) => {
    const query = SessionIdSchema.safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'sessionId is required' },
      });
    }

    const { sessionId, refresh } = query.data;
    const skipCache = refresh === 'true';

    try {
      const { cookies, nim } = await getSessionAndContext(sessionId, sessionStore, browserPool);

      if (!nim) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NIM_NOT_SET', message: 'NIM not found in session' },
        });
      }

      // Check cache first
      const cacheKey = `financial:${sessionId}`;
      if (!skipCache) {
        const cached = getCached(cacheKey);
        if (cached) {
          return { success: true, data: cached, cached: true };
        }
      }

      const { page } = await createAuthenticatedPage(sessionId, cookies);

      await navigateToFinancial(page, nim);

      const isValid = await checkSessionValid(page);
      if (!isValid) {
        await page.close();
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session has expired' },
        });
      }

      const financial = await scrapeFinancialStatus(page);
      await page.close();

      // Cache the result
      setCache(cacheKey, financial);

      return { success: true, data: financial, cached: false };
    } catch (error) {
      if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
        });
      }

      return reply.status(500).send({
        success: false,
        error: {
          code: 'SCRAPING_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch financial status',
        },
      });
    }
  });

  // ============================================
  // Study Plan Routes
  // ============================================

  /**
   * GET /data/study-plan - Get study plan (KRS)
   */
  app.get('/study-plan', async (request, reply) => {
    const query = SemesterSchema.safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'sessionId is required' },
      });
    }

    const { sessionId, semester, refresh } = query.data;
    const skipCache = refresh === 'true';

    try {
      const { cookies, nim } = await getSessionAndContext(sessionId, sessionStore, browserPool);

      if (!nim) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NIM_NOT_SET', message: 'NIM not found in session' },
        });
      }

      const activeSemester = semester || sessionStore.getSession(sessionId)?.semester || detectCurrentSemester();

      // Check cache first
      const cacheKey = `study-plan:${sessionId}:${activeSemester}`;
      if (!skipCache) {
        const cached = getCached(cacheKey);
        if (cached) {
          return { success: true, data: cached, cached: true };
        }
      }

      // Student ID is often different from NIM - we need to extract it from the page
      // For now, use NIM as student ID (may need adjustment)
      const studentId = nim;

      const { page } = await createAuthenticatedPage(sessionId, cookies);

      await navigateToStudyPlan(page, nim, activeSemester, studentId);

      const isValid = await checkSessionValid(page);
      if (!isValid) {
        await page.close();
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session has expired' },
        });
      }

      const studyPlan = await scrapeStudyPlan(page);
      await page.close();

      // Cache the result
      setCache(cacheKey, studyPlan);

      return { success: true, data: studyPlan, cached: false };
    } catch (error) {
      if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
        });
      }

      return reply.status(500).send({
        success: false,
        error: {
          code: 'SCRAPING_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch study plan',
        },
      });
    }
  });

  // ============================================
  // Session Update Route
  // ============================================

  /**
   * PATCH /data/session/semester - Set current semester for session
   */
  app.patch('/session/semester', async (request, reply) => {
    const schema = z.object({
      sessionId: z.string().min(1),
      semester: z.string().min(1),
    });

    const body = schema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'sessionId and semester are required' },
      });
    }

    const { sessionId, semester } = body.data;

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return reply.status(404).send({
        success: false,
        error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' },
      });
    }

    sessionStore.updateSession(sessionId, { semester });

    return {
      success: true,
      data: { message: 'Semester updated', semester },
    };
  });

  /**
   * PATCH /data/session/nim - Set NIM for session (manual override)
   */
  app.patch('/session/nim', async (request, reply) => {
    const schema = z.object({
      sessionId: z.string().min(1),
      nim: z.string().min(1),
    });

    const body = schema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'sessionId and nim are required' },
      });
    }

    const { sessionId, nim } = body.data;

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return reply.status(404).send({
        success: false,
        error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' },
      });
    }

    sessionStore.updateSession(sessionId, { nim });

    return {
      success: true,
      data: { message: 'NIM updated', nim },
    };
  });
}