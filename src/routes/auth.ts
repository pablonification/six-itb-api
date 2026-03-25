/**
 * Authentication Routes - OAuth-like flow for SIX ITB
 *
 * Flow:
 * 1. Client calls POST /auth/browser to get a login URL
 * 2. User opens login URL in their browser (any device)
 * 3. User logs in with Microsoft 365
 * 4. API captures the session automatically
 * 5. Client polls GET /auth/session/:sessionId to check status
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getBrowserPool } from '../services/browser-pool.js';
import { getSessionStore } from '../services/session-store.js';
import { checkSessionValid, detectCurrentSemester } from '../services/six-scraper.js';
import { browserProxyRoutes } from '../services/browser-proxy.js';

const SIX_LOGIN_URL = 'https://six.itb.ac.id';

export async function authRoutes(app: FastifyInstance) {
  const browserPool = getBrowserPool();
  const sessionStore = getSessionStore();

  // Register browser proxy routes (handles /auth/browser, /auth/browser/:loginId/*)
  await browserProxyRoutes(app);

  /**
   * POST /auth/restore - Restore session from cookies
   *
   * Alternative auth method: User exports cookies from their browser
   * and sends them to create a session directly.
   */
  app.post('/auth/restore', async (request, reply) => {
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
        error: { code: 'INVALID_INPUT', message: 'userId and cookies are required. Cookie format: {name, value, domain, path}' },
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
      // Create context with provided cookies to validate
      const context = await browserPool.createContext(`validate_${userId}`, cookies);
      const page = await context.newPage();

      // Navigate to validate session
      await page.goto(SIX_LOGIN_URL, { waitUntil: 'networkidle' });

      const isValid = await checkSessionValid(page);
      await page.close();
      await browserPool.closeContext(`validate_${userId}`);

      if (!isValid) {
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_COOKIES', message: 'Provided cookies are invalid or expired. Please login again and export fresh cookies.' },
        });
      }

      // Create new session
      const session = sessionStore.createSession(userId, cookies, 60);

      return {
        success: true,
        data: {
          sessionId: session.id,
          expiresAt: session.expiresAt,
          message: 'Session restored successfully. Use sessionId for data endpoints.',
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

  /**
   * DELETE /auth/session/:sessionId - End a session
   */
  app.delete('/auth/session/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Session not found' },
      });
    }

    sessionStore.deleteSession(sessionId);
    await browserPool.closeContext(sessionId);

    return { success: true, message: 'Session ended' };
  });
}