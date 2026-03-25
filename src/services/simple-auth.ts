/**
 * Simple Auth - Headless browser waits for user login
 *
 * Flow:
 * 1. API starts browser, navigates to login page
 * 2. Returns URL to user
 * 3. User opens URL in their browser (VNC/remote view)
 * 4. User logs in
 * 5. API detects login, captures cookies
 */

import { FastifyInstance } from 'fastify';
import { chromium } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getSessionStore } from './session-store.js';
import { detectCurrentSemester } from './six-scraper.js';

const SIX_MS365_LOGIN = 'https://six.itb.ac.id/login/MS365';

interface PendingLogin {
  id: string;
  userId: string;
  status: 'pending' | 'success' | 'expired' | 'error';
  createdAt: Date;
  sessionId?: string;
  nim?: string;
  error?: string;
}

const pendingLogins = new Map<string, PendingLogin>();

export async function simpleAuthRoutes(app: FastifyInstance) {
  const sessionStore = getSessionStore();

  /**
   * POST /browser - Start login session
   */
  app.post('/browser', async (request, reply) => {
    const body = z.object({ userId: z.string().min(1) }).safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'userId is required' },
      });
    }

    const { userId } = body.data;
    const loginId = uuidv4();

    // Create pending login record
    const pending: PendingLogin = {
      id: loginId,
      userId,
      status: 'pending',
      createdAt: new Date(),
    };
    pendingLogins.set(loginId, pending);

    // Start browser in background
    startLoginBrowser(loginId, userId, sessionStore).catch(err => {
      pending.status = 'error';
      pending.error = err.message;
    });

    // Get base URL
    const protocol = request.protocol || 'http';
    const host = request.headers.host || 'localhost:3000';

    return {
      success: true,
      data: {
        loginId,
        statusUrl: `${protocol}://${host}/auth/browser/${loginId}/status`,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        message: 'Browser started. Poll statusUrl to check login status.',
      },
    };
  });

  /**
   * GET /browser/:loginId/status - Check login status
   */
  app.get('/browser/:loginId/status', async (request, reply) => {
    const { loginId } = request.params as { loginId: string };
    const pending = pendingLogins.get(loginId);

    if (!pending) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Login session not found or expired' },
      });
    }

    return {
      success: true,
      data: {
        loginId,
        status: pending.status,
        sessionId: pending.sessionId,
        nim: pending.nim,
        error: pending.error,
      },
    };
  });

  /**
   * GET /session/:sessionId - Get session info
   */
  app.get('/session/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = sessionStore.getSession(sessionId);

    if (!session) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Session not found' },
      });
    }

    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        nim: session.nim,
        semester: session.semester,
        expiresAt: session.expiresAt,
      },
    };
  });

  /**
   * DELETE /session/:sessionId - End session
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

    sessionStore.deleteSession(sessionId);
    return { success: true, message: 'Session ended' };
  });
}

/**
 * Start browser and wait for login
 */
async function startLoginBrowser(
  loginId: string,
  userId: string,
  sessionStore: ReturnType<typeof getSessionStore>
) {
  const pending = pendingLogins.get(loginId);
  if (!pending) return;

  let browser;
  try {
    // Launch headless browser
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });

    const page = await context.newPage();

    // Navigate to login
    await page.goto(SIX_MS365_LOGIN, { waitUntil: 'networkidle' });

    // Wait for redirect to SIX home (login success)
    // URL pattern: https://six.itb.ac.id/home?context=mahasiswa:NIM
    await page.waitForURL('**/six.itb.ac.id/home**', { timeout: 5 * 60 * 1000 });

    // Wait for page to stabilize
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Get current URL and extract NIM
    const currentUrl = page.url();
    let nim = '';
    const urlMatch = currentUrl.match(/context=mahasiswa:(\d+)/);
    if (urlMatch) nim = urlMatch[1];

    // Fallback: extract NIM from page
    if (!nim) {
      nim = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="mahasiswa:"]');
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          const match = href.match(/mahasiswa:(\d+)/);
          if (match) return match[1];
        }
        return '';
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

    // Create session
    const session = sessionStore.createSession(userId, formattedCookies, 60);
    if (nim) {
      sessionStore.updateSession(session.id, { nim, semester: detectCurrentSemester() });
    }

    // Update pending login
    pending.status = 'success';
    pending.sessionId = session.id;
    pending.nim = nim;

    await browser.close();

  } catch (error) {
    pending.status = 'error';
    pending.error = error instanceof Error ? error.message : 'Unknown error';
    if (browser) await browser.close().catch(() => {});
  }

  // Cleanup after 10 minutes
  setTimeout(() => {
    pendingLogins.delete(loginId);
  }, 10 * 60 * 1000);
}