/**
 * Authentication Routes - CLI-based OAuth flow for SIX ITB
 */

import { FastifyInstance } from 'fastify';
import { chromium } from 'playwright';
import { z } from 'zod';
import { getBrowserPool } from '../services/browser-pool.js';
import { getSessionStore } from '../services/session-store.js';
import { checkSessionValid, scrapeProfile, detectCurrentSemester } from '../services/six-scraper.js';

const SIX_LOGIN_URL = 'https://six.itb.ac.id';
const SIX_MS365_LOGIN = 'https://six.itb.ac.id/login/MS365';

// Validation schemas
const LoginStartSchema = z.object({
  userId: z.string().min(1),
});

const LoginCallbackSchema = z.object({
  loginId: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  const browserPool = getBrowserPool();
  const sessionStore = getSessionStore();

  /**
   * POST /auth/login - Start a new login session
   * Returns a login URL that the user must visit
   */
  app.post('/login', async (request, reply) => {
    const body = LoginStartSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'userId is required' },
      });
    }

    const { userId } = body.data;

    // Check if user already has an active session
    const existingSession = sessionStore.getSessionByUserId(userId);
    if (existingSession) {
      return {
        success: true,
        data: {
          sessionId: existingSession.id,
          message: 'Active session found',
          expiresAt: existingSession.expiresAt,
        },
      };
    }

    // Create a new login session
    const loginSession = sessionStore.createLoginSession(SIX_LOGIN_URL, 10);

    // Return login URL for user to visit
    const loginUrl = `${SIX_LOGIN_URL}?login_id=${loginSession.id}`;

    return {
      success: true,
      data: {
        loginId: loginSession.id,
        loginUrl,
        expiresAt: loginSession.expiresAt,
        instructions: 'Visit the loginUrl in your browser, complete authentication, then call /auth/callback',
      },
    };
  });

  /**
   * POST /auth/callback - Check if login was completed
   * This is polled by the CLI after user visits login URL
   */
  app.post('/callback', async (request, reply) => {
    const body = LoginCallbackSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'loginId is required' },
      });
    }

    const { loginId } = body.data;

    const loginSession = sessionStore.getLoginSession(loginId);
    if (!loginSession) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Login session not found or expired' },
      });
    }

    if (loginSession.status === 'expired') {
      return reply.status(410).send({
        success: false,
        error: { code: 'EXPIRED', message: 'Login session has expired' },
      });
    }

    if (loginSession.status === 'completed' && loginSession.session) {
      return {
        success: true,
        data: {
          status: 'completed',
          sessionId: loginSession.session.id,
          nim: loginSession.session.nim,
          expiresAt: loginSession.session.expiresAt,
        },
      };
    }

    return {
      success: true,
      data: {
        status: 'pending',
        message: 'Waiting for user to complete login',
      },
    };
  });

  /**
   * POST /auth/browser - Start browser-based login (for interactive use)
   * Opens a browser, user logs in, session is captured
   *
   * Login flow:
   * 1. Navigate to https://six.itb.ac.id/login/MS365
   * 2. Microsoft 365 SSO: User enters email, password, and TOTP
   * 3. Redirect to https://six.itb.ac.id/home?context=mahasiswa:NIM
   * 4. Extract NIM from URL or page links
   */
  app.post('/browser', async (request, reply) => {
    const body = LoginStartSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'userId is required' },
      });
    }

    const { userId } = body.data;

    // Check if running in headless environment
    const headless = process.env.BROWSER_HEADLESS !== 'false';

    // HEADLESS MODE: Return WebSocket endpoint for remote connection
    if (headless) {
      const browserServer = await chromium.launchServer({
        headless: true,
        port: 9222,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const wsEndpoint = browserServer.wsEndpoint();

      // Create a connected context to navigate to login page
      const browser = await chromium.connect(wsEndpoint);
      const context = await browser.newContext({ viewport: null });
      const page = await context.newPage();
      await page.goto(SIX_MS365_LOGIN);

      return reply.status(200).send({
        success: true,
        data: {
          sessionId: null,
          status: 'waiting_for_login',
          message: 'Browser launched in headless mode. Connect via WebSocket to complete login.',
          wsEndpoint,
          connectCommand: `const browser = await chromium.connect('${wsEndpoint}');`,
          instructions: [
            '1. Connect to the browser using Playwright:',
            `   const browser = await chromium.connect('${wsEndpoint}');`,
            '   const page = browser.contexts()[0].pages()[0];',
            '',
            '2. Complete login in the browser page',
            '',
            '3. After login, cookies are automatically captured',
            '',
            'Note: Browser will auto-close after 5 minutes of inactivity',
          ],
        },
      });
    }

    // HEADED MODE (local development): Launch visible browser
    try {
      const browser = await chromium.launch({
        headless: false,
        args: ['--start-maximized'],
      });

      const context = await browser.newContext({
        viewport: null,
      });

      const page = await context.newPage();

      // Navigate to MS365 login page (not the home page)
      await page.goto(SIX_MS365_LOGIN);

      // Wait for redirect back to SIX after Microsoft login (5 min timeout for 2FA)
      // The redirect URL will be like: https://six.itb.ac.id/home?context=mahasiswa:18223047
      await page.waitForURL('**/six.itb.ac.id/home**', { timeout: 300000 });

      // Wait for page to stabilize
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Check if we're actually logged in (not redirected back to login)
      const currentUrl = page.url();
      if (currentUrl.includes('login') || currentUrl.includes('microsoftonline')) {
        await browser.close();
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_FAILED', message: 'Login was not completed' },
        });
      }

      // Get cookies
      const cookies = await context.cookies();
      const formattedCookies = cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
      }));

      // Extract NIM - primary strategy: from redirect URL context parameter
      let nim = '';
      const urlMatch = currentUrl.match(/context=mahasiswa:(\d+)/);
      if (urlMatch) {
        nim = urlMatch[1];
      }

      // Fallback: Extract NIM from navigation links on the page
      if (!nim) {
        try {
          // Wait for navigation links to appear (they contain mahasiswa:NIM)
          await page.waitForSelector('a[href*="mahasiswa:"]', { timeout: 5000 }).catch(() => null);

          nim = await page.evaluate(() => {
            // Look for links containing mahasiswa:NIM pattern
            const links = document.querySelectorAll('a[href*="mahasiswa:"]');
            for (let i = 0; i < links.length; i++) {
              const href = links[i].getAttribute('href') || '';
              const match = href.match(/mahasiswa:(\d+)/);
              if (match) return match[1];
            }
            return '';
          });
        } catch {
          // Fallback failed
        }
      }

      await browser.close();

      // Create session
      const session = sessionStore.createSession(userId, formattedCookies, 60);

      // Set NIM and semester
      if (nim) {
        sessionStore.updateSession(session.id, { nim, semester: detectCurrentSemester() });
      } else {
        sessionStore.updateSession(session.id, { semester: detectCurrentSemester() });
      }

      return {
        success: true,
        data: {
          sessionId: session.id,
          nim,
          nimFound: !!nim,
          semester: detectCurrentSemester(),
          expiresAt: session.expiresAt,
        },
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'LOGIN_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error during login',
        },
      });
    }
  });

  /**
   * GET /auth/session/:sessionId - Get session status
   */
  app.get('/session/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Session not found or expired' },
      });
    }

    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        nim: session.nim,
        createdAt: session.createdAt,
        lastAccessedAt: session.lastAccessedAt,
        expiresAt: session.expiresAt,
      },
    };
  });

  /**
   * DELETE /auth/session/:sessionId - Logout (delete session)
   */
  app.delete('/session/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Session not found' },
      });
    }

    // Close browser context if exists
    await browserPool.closeContext(sessionId);

    // Delete session
    sessionStore.deleteSession(sessionId);

    return {
      success: true,
      data: { message: 'Session deleted' },
    };
  });

  /**
   * POST /auth/restore - Restore session from cookies
   */
  app.post('/restore', async (request, reply) => {
    const schema = z.object({
      userId: z.string().min(1),
      cookies: z.array(z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
        path: z.string(),
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

    try {
      // Create context with provided cookies to validate
      const context = await browserPool.createContext(`validate_${userId}`, cookies);
      const page = await context.newPage();

      // Navigate to home page to validate session
      await page.goto(SIX_LOGIN_URL, { waitUntil: 'networkidle' });

      const isValid = await checkSessionValid(page);
      await page.close();
      await browserPool.closeContext(`validate_${userId}`);

      if (!isValid) {
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_COOKIES', message: 'Provided cookies are invalid or expired' },
        });
      }

      // Create new session with provided cookies
      const session = sessionStore.createSession(userId, cookies, 60);

      return {
        success: true,
        data: {
          sessionId: session.id,
          expiresAt: session.expiresAt,
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