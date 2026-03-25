/**
 * Sniping Routes - Course registration automation (KRS/PRS)
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getSnipeManager } from '../services/snipe-manager.js';
import { getSessionStore } from '../services/session-store.js';
import type { SnipeType } from '../models/types.js';

// Validation schemas
const StartSnipeSchema = z.object({
  userId: z.string().min(1),
  type: z.enum(['krs', 'prs']),
  courseUrl: z.string().url(),
  classNumber: z.string().min(1),
  rencanaStudiUrl: z.string().url(),
  maxChecks: z.number().min(1).max(1000).optional().default(100),
  intervalMs: z.number().min(1000).max(60000).optional().default(5000),
  dryRun: z.boolean().optional().default(false),
});

export async function snipeRoutes(app: FastifyInstance) {
  const snipeManager = getSnipeManager();
  const sessionStore = getSessionStore();

  /**
   * POST /snipe/start - Start a new snipe job
   */
  app.post('/start', async (request, reply) => {
    const body = StartSnipeSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid input',
          details: body.error.errors,
        },
      });
    }

    const config = body.data;

    // Check if user has an active session
    const session = sessionStore.getSessionByUserId(config.userId);
    if (!session) {
      return reply.status(401).send({
        success: false,
        error: { code: 'NO_SESSION', message: 'User does not have an active session' },
      });
    }

    // Check for existing active jobs for this user
    const existingJobs = snipeManager.getJobsByUser(config.userId);
    const activeJobs = existingJobs.filter(
      j => j.status === 'pending' || j.status === 'monitoring' || j.status === 'executing'
    );

    if (activeJobs.length > 0) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'ACTIVE_JOB_EXISTS',
          message: 'User already has an active snipe job',
          activeJobs: activeJobs.map(j => ({ id: j.id, status: j.status })),
        },
      });
    }

    // Start new job
    const job = await snipeManager.startJob(config.userId, {
      type: config.type as SnipeType,
      courseUrl: config.courseUrl,
      classNumber: config.classNumber,
      rencanaStudiUrl: config.rencanaStudiUrl,
      maxChecks: config.maxChecks,
      intervalMs: config.intervalMs,
      dryRun: config.dryRun,
    });

    return {
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        config: job.config,
        startedAt: job.startedAt,
      },
    };
  });

  /**
   * GET /snipe/status/:jobId - Get job status
   */
  app.get('/status/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };

    const job = snipeManager.getJob(jobId);
    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    return {
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        checks: job.checks,
        lastCheck: job.lastCheck,
        result: job.result,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      },
    };
  });

  /**
   * GET /snipe/jobs/:userId - Get all jobs for a user
   */
  app.get('/jobs/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string };

    const jobs = snipeManager.getJobsByUser(userId);

    return {
      success: true,
      data: jobs.map(job => ({
        jobId: job.id,
        type: job.config.type,
        status: job.status,
        checks: job.checks,
        lastCheck: job.lastCheck,
        result: job.result,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      })),
    };
  });

  /**
   * POST /snipe/cancel/:jobId - Cancel a job
   */
  app.post('/cancel/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };

    const job = snipeManager.getJob(jobId);
    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    if (job.status !== 'pending' && job.status !== 'monitoring') {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'CANNOT_CANCEL',
          message: `Cannot cancel job with status: ${job.status}`,
        },
      });
    }

    const cancelled = snipeManager.cancelJob(jobId);

    return {
      success: cancelled,
      data: {
        jobId,
        status: cancelled ? 'cancelled' : job.status,
      },
    };
  });

  /**
   * POST /snipe/check - One-time slot check without starting a job
   */
  app.post('/check', async (request, reply) => {
    const schema = z.object({
      sessionId: z.string().min(1),
      courseUrl: z.string().url(),
      classNumber: z.string().optional(),
    });

    const body = schema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'sessionId and courseUrl are required' },
      });
    }

    const { sessionId, courseUrl, classNumber } = body.data;

    try {
      const session = sessionStore.getSession(sessionId);
      if (!session) {
        return reply.status(404).send({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
        });
      }

      // Dynamic import to avoid circular dependency
      const { getBrowserPool } = await import('../services/browser-pool.js');
      const { scrapeCourseSlots, checkSessionValid } = await import('../services/six-scraper.js');

      const browserPool = getBrowserPool();
      const context = await browserPool.createContext(sessionId, session.cookies);
      const page = await context.newPage();

      await page.goto(courseUrl, { waitUntil: 'networkidle' });

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

      // Filter by class number if provided
      const relevantSlots = classNumber
        ? slots.filter(s => s.classNumber === classNumber)
        : slots;

      return {
        success: true,
        data: {
          checkedAt: new Date().toISOString(),
          slots: relevantSlots,
          totalSlots: slots.length,
          availableSlots: slots.filter(s => s.available).length,
        },
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'CHECK_ERROR',
          message: error instanceof Error ? error.message : 'Failed to check slots',
        },
      });
    }
  });
}