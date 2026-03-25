/**
 * Browser Proxy - WebSocket proxy for remote browser access
 *
 * Allows users to interact with a headless browser through a web interface.
 * Used for OAuth-like login flow on server deployments.
 */

import { FastifyInstance } from 'fastify';
import { chromium, BrowserServer, Page, Browser, BrowserContext } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getSessionStore } from './session-store.js';
import { detectCurrentSemester } from './six-scraper.js';

const SIX_MS365_LOGIN = 'https://six.itb.ac.id/login/MS365';

interface LoginSession {
  id: string;
  userId: string;
  browserServer: BrowserServer;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  status: 'pending' | 'authenticated' | 'expired' | 'error';
  createdAt: Date;
  expiresAt: Date;
  callbackUrl?: string;
  sessionId?: string;
  nim?: string;
  error?: string;
}

// Active login sessions
const loginSessions = new Map<string, LoginSession>();

// Clean up expired sessions every minute
setInterval(() => {
  const now = new Date();
  for (const [id, session] of loginSessions) {
    if (session.expiresAt < now) {
      session.browserServer.close().catch(() => {});
      loginSessions.delete(id);
    }
  }
}, 60000);

export async function browserProxyRoutes(app: FastifyInstance) {
  const sessionStore = getSessionStore();

  /**
   * POST /auth/browser - Start login session
   * Returns a URL the user can visit to login
   */
  app.post('/browser', async (request, reply) => {
    const schema = z.object({
      userId: z.string().min(1),
      callbackUrl: z.string().url().optional(),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'userId is required' },
      });
    }

    const { userId, callbackUrl } = body.data;
    const loginId = uuidv4();

    try {
      // Launch browser server with remote debugging
      const browserServer = await chromium.launchServer({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      // Connect to the browser
      const browser = await chromium.connect(browserServer.wsEndpoint());
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      // Navigate to login page
      await page.goto(SIX_MS365_LOGIN, { waitUntil: 'networkidle' });

      // Create login session
      const loginSession: LoginSession = {
        id: loginId,
        userId,
        browserServer,
        browser,
        context,
        page,
        status: 'pending',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
        callbackUrl,
      };

      loginSessions.set(loginId, loginSession);

      // Start monitoring for successful login (background)
      monitorLoginSession(loginSession, sessionStore).catch(err => {
        loginSession.status = 'error';
        loginSession.error = err.message;
      });

      // Get the base URL from request
      const protocol = request.protocol || 'http';
      const host = request.headers.host || 'localhost:3000';
      const baseUrl = `${protocol}://${host}`;

      return {
        success: true,
        data: {
          loginId,
          loginUrl: `${baseUrl}/auth/browser/${loginId}`,
          wsEndpoint: browserServer.wsEndpoint(),
          expiresAt: loginSession.expiresAt,
          message: 'Open the loginUrl in your browser to complete authentication.',
        },
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'BROWSER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to start browser',
        },
      });
    }
  });

  /**
   * GET /auth/browser/:loginId - Browser login page
   * Serves an HTML page with remote browser view
   */
  app.get('/browser/:loginId', async (request, reply) => {
    const { loginId } = request.params as { loginId: string };
    const loginSession = loginSessions.get(loginId);

    if (!loginSession) {
      return reply.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Login Expired</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Login Session Not Found</h1>
          <p>This login session has expired or doesn't exist.</p>
          <p>Please request a new login URL.</p>
        </body>
        </html>
      `);
    }

    if (loginSession.status === 'authenticated') {
      return reply.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Login Successful</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: green;">✓ Login Successful!</h1>
          <p>You are now authenticated.</p>
          <p>Session ID: <code>${loginSession.sessionId}</code></p>
          ${loginSession.callbackUrl ? `<p>Redirecting...</p><script>setTimeout(() => window.location.href = '${loginSession.callbackUrl}', 2000);</script>` : ''}
        </body>
        </html>
      `);
    }

    // Get WebSocket endpoint
    const wsEndpoint = loginSession.browserServer.wsEndpoint();
    const protocol = request.protocol === 'https' ? 'wss' : 'ws';
    const host = request.headers.host || 'localhost:3000';

    // Serve the remote browser interface
    return reply.type('text/html').send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SIX ITB Login</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0f172a;
            color: #e2e8f0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
          }
          .header {
            background: #1e293b;
            padding: 16px 24px;
            border-bottom: 1px solid #334155;
            display: flex;
            align-items: center;
            gap: 16px;
          }
          .header h1 { font-size: 1.25rem; color: #38bdf8; }
          .status {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.875rem;
            background: #f59e0b;
            color: #0f172a;
          }
          .status.success { background: #22c55e; }
          .status.error { background: #ef4444; color: white; }
          .container {
            flex: 1;
            display: flex;
            flex-direction: column;
            padding: 24px;
            max-width: 1400px;
            margin: 0 auto;
            width: 100%;
          }
          .info {
            background: #1e293b;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 16px;
          }
          .info p { color: #94a3b8; line-height: 1.6; }
          .info strong { color: #f1f5f9; }
          #screen {
            flex: 1;
            background: #000;
            border-radius: 8px;
            overflow: hidden;
            position: relative;
            min-height: 500px;
          }
          #screen img {
            width: 100%;
            height: auto;
            display: block;
          }
          .loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
          }
          .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid #334155;
            border-top-color: #38bdf8;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
          .controls {
            margin-top: 16px;
            display: flex;
            gap: 8px;
          }
          button {
            padding: 8px 16px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
          }
          .btn-primary { background: #38bdf8; color: #0f172a; }
          .btn-secondary { background: #334155; color: #e2e8f0; }
          .hidden { display: none; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>SIX ITB Login</h1>
          <span class="status" id="status">Waiting for login...</span>
        </div>
        <div class="container">
          <div class="info">
            <p><strong>Instructions:</strong> Use the browser below to login with your ITB Microsoft 365 account.</p>
            <p>After successful login, your session will be automatically captured.</p>
          </div>
          <div id="screen">
            <div class="loading" id="loading">
              <div class="spinner"></div>
              <p>Connecting to browser...</p>
            </div>
            <img id="screenshot" class="hidden" alt="Browser Screen">
          </div>
          <div class="controls">
            <button class="btn-secondary" onclick="refreshScreenshot()">Refresh Screen</button>
            <button class="btn-primary" onclick="clickElement()">Click Selected</button>
          </div>
        </div>
        <script>
          const loginId = '${loginId}';
          const pollInterval = 1000;
          let lastClickX = 0, lastClickY = 0;

          // Check login status
          async function checkStatus() {
            try {
              const res = await fetch('/auth/browser/' + loginId + '/status');
              const data = await res.json();

              if (data.status === 'authenticated') {
                document.getElementById('status').textContent = '✓ Authenticated';
                document.getElementById('status').classList.add('success');
                document.getElementById('info').innerHTML = '<p><strong>Login successful!</strong> Session ID: ' + data.sessionId + '</p>';
                return true;
              } else if (data.status === 'error') {
                document.getElementById('status').textContent = 'Error';
                document.getElementById('status').classList.add('error');
                return true;
              }
              return false;
            } catch (e) {
              console.error('Status check failed:', e);
              return false;
            }
          }

          // Get screenshot
          async function refreshScreenshot() {
            try {
              const res = await fetch('/auth/browser/' + loginId + '/screenshot');
              if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                document.getElementById('screenshot').src = url;
                document.getElementById('screenshot').classList.remove('hidden');
                document.getElementById('loading').classList.add('hidden');
              }
            } catch (e) {
              console.error('Screenshot failed:', e);
            }
          }

          // Click handler
          document.getElementById('screen').addEventListener('click', async (e) => {
            const rect = e.target.getBoundingClientRect();
            const x = Math.round((e.clientX - rect.left) * (1280 / rect.width));
            const y = Math.round((e.clientY - rect.top) * (720 / rect.height));

            try {
              await fetch('/auth/browser/' + loginId + '/click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ x, y })
              });
              setTimeout(refreshScreenshot, 500);
            } catch (e) {
              console.error('Click failed:', e);
            }
          });

          // Type text
          async function typeText(text) {
            await fetch('/auth/browser/' + loginId + '/type', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text })
            });
            setTimeout(refreshScreenshot, 500);
          }

          // Poll for updates
          setInterval(async () => {
            const done = await checkStatus();
            if (!done) {
              refreshScreenshot();
            }
          }, pollInterval);

          // Initial load
          refreshScreenshot();
        </script>
      </body>
      </html>
    `);
  });

  /**
   * GET /auth/browser/:loginId/status - Check login status
   */
  app.get('/browser/:loginId/status', async (request, reply) => {
    const { loginId } = request.params as { loginId: string };
    const loginSession = loginSessions.get(loginId);

    if (!loginSession) {
      return reply.status(404).send({
        status: 'not_found',
        error: 'Login session not found',
      });
    }

    return {
      status: loginSession.status,
      sessionId: loginSession.sessionId,
      nim: loginSession.nim,
      error: loginSession.error,
    };
  });

  /**
   * GET /auth/browser/:loginId/screenshot - Get browser screenshot
   */
  app.get('/browser/:loginId/screenshot', async (request, reply) => {
    const { loginId } = request.params as { loginId: string };
    const loginSession = loginSessions.get(loginId);

    if (!loginSession) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    try {
      const screenshot = await loginSession.page.screenshot({ type: 'png' });
      return reply.type('image/png').send(screenshot);
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to capture screenshot' });
    }
  });

  /**
   * POST /auth/browser/:loginId/click - Click at coordinates
   */
  app.post('/browser/:loginId/click', async (request, reply) => {
    const { loginId } = request.params as { loginId: string };
    const loginSession = loginSessions.get(loginId);

    if (!loginSession) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const { x, y } = request.body as { x: number; y: number };

    try {
      await loginSession.page.mouse.click(x, y);
      return { success: true };
    } catch (error) {
      return reply.status(500).send({ error: 'Click failed' });
    }
  });

  /**
   * POST /auth/browser/:loginId/type - Type text
   */
  app.post('/browser/:loginId/type', async (request, reply) => {
    const { loginId } = request.params as { loginId: string };
    const loginSession = loginSessions.get(loginId);

    if (!loginSession) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const { text } = request.body as { text: string };

    try {
      await loginSession.page.keyboard.type(text);
      return { success: true };
    } catch (error) {
      return reply.status(500).send({ error: 'Type failed' });
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
        error: { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
      });
    }

    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        nim: session.nim,
        semester: session.semester,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      },
    };
  });
}

/**
 * Monitor login session for successful authentication
 */
async function monitorLoginSession(loginSession: LoginSession, sessionStore: ReturnType<typeof getSessionStore>) {
  const page = loginSession.page;

  try {
    // Wait for redirect to SIX home (indicates successful login)
    // URL pattern: https://six.itb.ac.id/home?context=mahasiswa:NIM
    await page.waitForURL('**/six.itb.ac.id/home**', { timeout: 5 * 60 * 1000 }); // 5 minutes

    // Wait for page to stabilize
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Get current URL
    const currentUrl = page.url();

    // Extract NIM from URL
    let nim = '';
    const urlMatch = currentUrl.match(/context=mahasiswa:(\d+)/);
    if (urlMatch) {
      nim = urlMatch[1];
    }

    // Fallback: Extract NIM from page links
    if (!nim) {
      try {
        nim = await page.evaluate(() => {
          const links = document.querySelectorAll('a[href*="mahasiswa:"]');
          for (let i = 0; i < links.length; i++) {
            const href = links[i].getAttribute('href') || '';
            const match = href.match(/mahasiswa:(\d+)/);
            if (match) return match[1];
          }
          return '';
        });
      } catch {
        // Ignore
      }
    }

    // Get cookies
    const cookies = await loginSession.context.cookies();
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
    const session = sessionStore.createSession(loginSession.userId, formattedCookies, 60);

    // Update with NIM and semester
    if (nim) {
      sessionStore.updateSession(session.id, { nim, semester: detectCurrentSemester() });
    } else {
      sessionStore.updateSession(session.id, { semester: detectCurrentSemester() });
    }

    // Update login session
    loginSession.status = 'authenticated';
    loginSession.sessionId = session.id;
    loginSession.nim = nim;

    // Close browser after a delay (user might want to see success message)
    setTimeout(() => {
      loginSession.browserServer.close().catch(() => {});
      loginSessions.delete(loginSession.id);
    }, 30000);

  } catch (error) {
    // Check if it's just a timeout while still on login page
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('microsoftonline')) {
      loginSession.status = 'expired';
      loginSession.error = 'Login timed out. Please try again.';
    } else {
      loginSession.status = 'error';
      loginSession.error = error instanceof Error ? error.message : 'Unknown error';
    }

    // Clean up
    loginSession.browserServer.close().catch(() => {});
    loginSessions.delete(loginSession.id);
  }
}