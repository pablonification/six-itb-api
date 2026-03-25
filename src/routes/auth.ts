/**
 * Authentication Routes
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getBrowserPool } from '../services/browser-pool.js';
import { getSessionStore } from '../services/session-store.js';
import { checkSessionValid, detectCurrentSemester } from '../services/six-scraper.js';

const SIX_LOGIN_URL = 'https://six.itb.ac.id';

export async function authRoutes(app: FastifyInstance) {
  const browserPool = getBrowserPool();
  const sessionStore = getSessionStore();

  /**
   * GET /login - Helper page for users to login
   */
  app.get('/login', async (request, reply) => {
    const protocol = request.protocol || 'http';
    const host = request.headers.host || 'localhost:3000';
    const apiBaseUrl = `${protocol}://${host}`;

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
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: #1e293b;
      border-radius: 16px;
      padding: 40px;
      max-width: 600px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    }
    h1 { color: #38bdf8; font-size: 1.75rem; margin-bottom: 8px; }
    .subtitle { color: #94a3b8; margin-bottom: 32px; }
    .step { margin-bottom: 24px; }
    .step-num {
      display: inline-block;
      width: 28px;
      height: 28px;
      background: #38bdf8;
      color: #0f172a;
      border-radius: 50%;
      text-align: center;
      line-height: 28px;
      font-weight: 600;
      margin-right: 12px;
    }
    .step-title { color: #f1f5f9; font-weight: 600; margin-bottom: 8px; }
    .step-desc { color: #94a3b8; font-size: 0.9rem; margin-left: 40px; }
    .step-desc a { color: #38bdf8; }
    .step-desc code {
      background: #0f172a;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: monospace;
      color: #fbbf24;
    }
    .input-group { margin: 24px 0; }
    label { display: block; color: #94a3b8; margin-bottom: 8px; font-size: 0.9rem; }
    input, textarea {
      width: 100%;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 12px 16px;
      color: #f1f5f9;
      font-size: 1rem;
    }
    textarea { min-height: 120px; font-family: monospace; }
    input:focus, textarea:focus { outline: none; border-color: #38bdf8; }
    .btn {
      width: 100%;
      background: #38bdf8;
      color: #0f172a;
      border: none;
      border-radius: 8px;
      padding: 14px 24px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn:hover { background: #7dd3fc; }
    .btn:disabled { background: #475569; cursor: not-allowed; }
    .result { margin-top: 24px; padding: 16px; border-radius: 8px; display: none; }
    .result.success { background: #064e3b; border: 1px solid #10b981; }
    .result.error { background: #7f1d1d; border: 1px solid #ef4444; }
    .result-title { font-weight: 600; margin-bottom: 8px; }
    .result.success .result-title { color: #10b981; }
    .result.error .result-title { color: #ef4444; }
    .result-content { color: #e2e8f0; word-break: break-all; }
    .code-block {
      background: #0f172a;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
      overflow-x: auto;
    }
    .code-block code { color: #e2e8f0; font-family: monospace; font-size: 0.85rem; }
    .tip {
      background: #1e3a5f;
      border-left: 4px solid #38bdf8;
      padding: 12px 16px;
      margin: 16px 0;
      border-radius: 0 8px 8px 0;
    }
    .tip-title { color: #38bdf8; font-weight: 600; margin-bottom: 4px; }
    .tip p { color: #94a3b8; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔑 SIX ITB Login</h1>
    <p class="subtitle">Get your session to use the API</p>

    <div class="step">
      <span class="step-num">1</span>
      <span class="step-title">Open SIX ITB</span>
      <p class="step-desc">
        Go to <a href="https://six.itb.ac.id" target="_blank">six.itb.ac.id</a> and login with your ITB account
      </p>
    </div>

    <div class="step">
      <span class="step-num">2</span>
      <span class="step-title">Open Developer Tools</span>
      <p class="step-desc">
        Press <code>F12</code> (or right-click → Inspect), then go to <strong>Application</strong> → <strong>Cookies</strong> → <code>six.itb.ac.id</code>
      </p>
    </div>

    <div class="step">
      <span class="step-num">3</span>
      <span class="step-title">Copy Required Cookies</span>
      <p class="step-desc">
        Find and copy these cookies:<br>
        <code>ASP.NET_SessionId</code> and <code>.ASPXAUTH</code>
      </p>
    </div>

    <div class="tip">
      <div class="tip-title">💡 Quick Method</div>
      <p>In Console tab, paste this and press Enter:<br>
      <code style="font-size: 0.8rem;">copy(document.cookie)</code><br>
      Then paste below!</p>
    </div>

    <div class="input-group">
      <label for="userId">Your User ID (any name)</label>
      <input type="text" id="userId" placeholder="e.g., my-app-name">
    </div>

    <div class="input-group">
      <label for="cookies">Paste Cookies Here</label>
      <textarea id="cookies" placeholder="Paste document.cookie output here, or manually enter: ASP.NET_SessionId=xxx; .ASPXAUTH=yyy"></textarea>
    </div>

    <button class="btn" onclick="submitLogin()">Get Session</button>

    <div id="result" class="result">
      <div class="result-title"></div>
      <div class="result-content"></div>
    </div>
  </div>

  <script>
    const API_BASE = '${apiBaseUrl}';

    function parseCookies(cookieString) {
      const cookies = [];
      const pairs = cookieString.split(';').map(s => s.trim()).filter(s => s);

      for (const pair of pairs) {
        const [name, ...valueParts] = pair.split('=');
        if (name && valueParts.length > 0) {
          cookies.push({
            name: name.trim(),
            value: valueParts.join('=').trim(),
            domain: 'six.itb.ac.id',
            path: '/'
          });
        }
      }
      return cookies;
    }

    async function submitLogin() {
      const userId = document.getElementById('userId').value.trim();
      const cookieString = document.getElementById('cookies').value.trim();
      const result = document.getElementById('result');
      const btn = document.querySelector('.btn');

      if (!userId) {
        showError('Please enter a User ID');
        return;
      }

      if (!cookieString) {
        showError('Please paste your cookies');
        return;
      }

      const cookies = parseCookies(cookieString);
      if (cookies.length === 0) {
        showError('Could not parse cookies. Make sure they are in format: name=value; name2=value2');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Processing...';

      try {
        const res = await fetch(API_BASE + '/auth/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, cookies })
        });

        const data = await res.json();

        if (data.success) {
          showSuccess(data.data.sessionId, data.data.expiresAt);
        } else {
          showError(data.error?.message || 'Failed to create session');
        }
      } catch (e) {
        showError('Network error: ' + e.message);
      }

      btn.disabled = false;
      btn.textContent = 'Get Session';
    }

    function showSuccess(sessionId, expiresAt) {
      const result = document.getElementById('result');
      result.className = 'result success';
      result.querySelector('.result-title').textContent = '✓ Session Created!';
      result.querySelector('.result-content').innerHTML = \`
        <p style="margin-bottom: 12px;">Your Session ID:</p>
        <div class="code-block"><code>\${sessionId}</code></div>
        <p style="margin-bottom: 12px; font-size: 0.9rem; color: #94a3b8;">Expires: \${new Date(expiresAt).toLocaleString()}</p>
        <p style="margin-bottom: 8px;">Use it in API calls:</p>
        <div class="code-block"><code>GET \${API_BASE}/data/profile?sessionId=\${sessionId}</code></div>
      \`;
      result.style.display = 'block';
    }

    function showError(message) {
      const result = document.getElementById('result');
      result.className = 'result error';
      result.querySelector('.result-title').textContent = '✗ Error';
      result.querySelector('.result-content').textContent = message;
      result.style.display = 'block';
    }
  </script>
</body>
</html>
    `);
  });

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
          error: { code: 'INVALID_COOKIES', message: 'Cookies are invalid or expired. Please login to SIX again.' },
        });
      }

      const session = sessionStore.createSession(userId, cookies, 60);

      return {
        success: true,
        data: {
          sessionId: session.id,
          expiresAt: session.expiresAt,
          message: 'Session created successfully',
        },
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'RESTORE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create session',
        },
      });
    }
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
        error: { code: 'NOT_FOUND', message: 'Session not found or expired' },
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