/**
 * Authentication Routes
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getBrowserPool } from '../services/browser-pool.js';
import { getSessionStore } from '../services/session-store.js';
import { checkSessionValid, detectCurrentSemester } from '../services/six-scraper.js';
import { simpleAuthRoutes } from '../services/simple-auth.js';

const SIX_LOGIN_URL = 'https://six.itb.ac.id';

export async function authRoutes(app: FastifyInstance) {
  const browserPool = getBrowserPool();
  const sessionStore = getSessionStore();

  // Register simple auth routes (handles /browser, /browser/:id/status, /session/:id)
  await simpleAuthRoutes(app);

  /**
   * POST /restore - Restore session from cookies
   */
  app.post('/restore', async (request, reply) => {
    const schema = z.object({
      userId: z.string().min(1),
      cookies: z.array(z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
        path: z.string().default('/'),
        expires: z.number().optional(),
        httpOnly: z.boolean().optional(),
        secure: z.boolean().optional(),
      })),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'userId and cookies are required' },
      });
    }

    const { userId, cookies } = body.data;

    if (cookies.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'At least one cookie is required' },
      });
    }

    try {
      const context = await browserPool.createContext(`validate_${userId}`, cookies);
      const page = await context.newPage();

      await page.goto(SIX_LOGIN_URL, { waitUntil: 'networkidle' });

      const isValid = await checkSessionValid(page);
      await page.close();
      await browserPool.closeContext(`validate_${userId}`);

      if (!isValid) {
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_COOKIES', message: 'Cookies are invalid or expired' },
        });
      }

      const session = sessionStore.createSession(userId, cookies, 60);

      return {
        success: true,
        data: {
          sessionId: session.id,
          expiresAt: session.expiresAt,
          message: 'Session restored successfully',
        },
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'RESTORE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to restore session',
        },
      });
    }
  });
}