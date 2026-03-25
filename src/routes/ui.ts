/**
 * UI Routes - Web interface for API key management and documentation
 */

import { FastifyInstance } from 'fastify';

export async function uiRoutes(app: FastifyInstance) {
  /**
   * GET /ui - Dashboard (API key management)
   */
  app.get('/ui', async (request, reply) => {
    reply.type('text/html');
    return getDashboardHTML();
  });

  /**
   * GET /docs - API Documentation
   */
  app.get('/docs', async (request, reply) => {
    reply.type('text/html');
    return getDocsHTML();
  });
}

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SIX API - Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    .container { max-width: 900px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 2rem; margin-bottom: 10px; color: #38bdf8; }
    .subtitle { color: #94a3b8; margin-bottom: 30px; }
    .card { background: #1e293b; border-radius: 12px; padding: 24px; margin-bottom: 20px; border: 1px solid #334155; }
    .card-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 16px; color: #f1f5f9; }
    .input-group { margin-bottom: 16px; }
    label { display: block; font-size: 0.875rem; color: #94a3b8; margin-bottom: 6px; }
    input, select { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; font-size: 1rem; }
    input:focus, select:focus { outline: none; border-color: #38bdf8; }
    button { padding: 12px 24px; border-radius: 8px; border: none; cursor: pointer; font-size: 1rem; font-weight: 500; transition: all 0.2s; }
    .btn-primary { background: #38bdf8; color: #0f172a; }
    .btn-primary:hover { background: #7dd3fc; }
    .btn-secondary { background: #334155; color: #e2e8f0; }
    .btn-secondary:hover { background: #475569; }
    .response { background: #0f172a; border-radius: 8px; padding: 16px; margin-top: 16px; font-family: 'Monaco', 'Menlo', monospace; font-size: 0.875rem; white-space: pre-wrap; word-break: break-all; max-height: 400px; overflow-y: auto; }
    .error { color: #f87171; }
    .success { color: #4ade80; }
    .tabs { display: flex; gap: 10px; margin-bottom: 20px; }
    .tab { padding: 10px 20px; border-radius: 8px; background: #1e293b; cursor: pointer; border: 1px solid #334155; color: #94a3b8; }
    .tab.active { background: #38bdf8; color: #0f172a; border-color: #38bdf8; }
    .hidden { display: none; }
    .permission-group { display: flex; flex-wrap: wrap; gap: 10px; }
    .permission-item { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: #0f172a; border-radius: 6px; cursor: pointer; }
    .permission-item input { width: auto; }
    .permission-item:hover { background: #1e293b; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 16px; }
    .stat-box { background: #0f172a; padding: 16px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 1.5rem; font-weight: 700; color: #38bdf8; }
    .stat-label { font-size: 0.75rem; color: #94a3b8; margin-top: 4px; }
    .nav { display: flex; gap: 20px; margin-bottom: 30px; }
    .nav a { color: #94a3b8; text-decoration: none; padding: 8px 16px; border-radius: 6px; }
    .nav a:hover { background: #1e293b; color: #e2e8f0; }
    .nav a.active { background: #38bdf8; color: #0f172a; }
    .copy-btn { padding: 4px 8px; font-size: 0.75rem; margin-left: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <nav class="nav">
      <a href="/ui" class="active">Dashboard</a>
      <a href="/docs">Documentation</a>
      <a href="/">API Info</a>
    </nav>

    <h1>SIX API Dashboard</h1>
    <p class="subtitle">Manage your API keys and view usage statistics</p>

    <div class="tabs">
      <div class="tab active" onclick="showTab('check')">Check API Key</div>
      <div class="tab" onclick="showTab('create')">Create Key (Admin)</div>
    </div>

    <!-- Check API Key Tab -->
    <div id="check-tab">
      <div class="card">
        <div class="card-title">Enter Your API Key</div>
        <div class="input-group">
          <label for="checkApiKey">API Key</label>
          <input type="text" id="checkApiKey" placeholder="sk_xxxxxxxxxxxx">
        </div>
        <button class="btn-primary" onclick="checkApiKey()">View Key Info</button>
        <div id="checkResponse" class="response" style="display:none;"></div>
      </div>

      <div id="keyInfo" class="card" style="display:none;">
        <div class="card-title">Key Information</div>
        <div id="keyDetails"></div>
      </div>

      <div id="usageInfo" class="card" style="display:none;">
        <div class="card-title">Usage Statistics (Last 7 Days)</div>
        <div id="usageStats"></div>
      </div>
    </div>

    <!-- Create Key Tab -->
    <div id="create-tab" class="hidden">
      <div class="card">
        <div class="card-title">Create New API Key (Requires Master Admin Key)</div>
        <div class="input-group">
          <label for="masterKey">Master Admin Key</label>
          <input type="password" id="masterKey" placeholder="Enter master admin key">
        </div>
        <div class="input-group">
          <label for="keyName">Key Name</label>
          <input type="text" id="keyName" placeholder="My Application">
        </div>
        <div class="input-group">
          <label for="userId">User ID</label>
          <input type="text" id="userId" placeholder="user-123">
        </div>
        <div class="input-group">
          <label for="rateLimit">Rate Limit (requests/minute)</label>
          <input type="number" id="rateLimit" value="60" min="1" max="1000">
        </div>
        <div class="input-group">
          <label for="expiryDays">Expiry (days, 0 = never)</label>
          <input type="number" id="expiryDays" value="365" min="0">
        </div>
        <div class="input-group">
          <label>Permissions</label>
          <div class="permission-group">
            <label class="permission-item"><input type="checkbox" id="perm-read" checked> read</label>
            <label class="permission-item"><input type="checkbox" id="perm-auth"> auth</label>
            <label class="permission-item"><input type="checkbox" id="perm-write"> write</label>
            <label class="permission-item"><input type="checkbox" id="perm-presence"> presence</label>
            <label class="permission-item"><input type="checkbox" id="perm-admin"> admin</label>
          </div>
        </div>
        <button class="btn-primary" onclick="createApiKey()">Create API Key</button>
        <div id="createResponse" class="response" style="display:none;"></div>
      </div>
    </div>
  </div>

  <script>
    const API_BASE = window.location.origin;

    function showTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('[id$="-tab"]').forEach(t => t.classList.add('hidden'));
      event.target.classList.add('active');
      document.getElementById(tab + '-tab').classList.remove('hidden');
    }

    async function checkApiKey() {
      const apiKey = document.getElementById('checkApiKey').value.trim();
      const responseDiv = document.getElementById('checkResponse');
      const keyInfoDiv = document.getElementById('keyInfo');
      const usageInfoDiv = document.getElementById('usageInfo');

      if (!apiKey) {
        responseDiv.className = 'response error';
        responseDiv.textContent = 'Please enter an API key';
        responseDiv.style.display = 'block';
        return;
      }

      try {
        const res = await fetch(API_BASE + '/admin/me', {
          headers: { 'X-API-Key': apiKey }
        });
        const data = await res.json();
        responseDiv.style.display = 'none';

        if (data.success) {
          const key = data.data.key;
          const usage = data.data.usage;

          // Show key info
          keyInfoDiv.style.display = 'block';
          document.getElementById('keyDetails').innerHTML = \`
            <p><strong>Name:</strong> \${key.name}</p>
            <p><strong>User ID:</strong> \${key.userId}</p>
            <p><strong>Key ID:</strong> \${key.id}</p>
            <p><strong>Created:</strong> \${new Date(key.createdAt).toLocaleDateString()}</p>
            <p><strong>Expires:</strong> \${key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : 'Never'}</p>
            <p><strong>Status:</strong> <span class="success">Active</span></p>
            <p><strong>Rate Limit:</strong> \${key.rateLimit} req/min</p>
            <p><strong>Permissions:</strong> \${key.permissions.join(', ')}</p>
          \`;

          // Show usage stats
          usageInfoDiv.style.display = 'block';
          document.getElementById('usageStats').innerHTML = \`
            <div class="stats-grid">
              <div class="stat-box">
                <div class="stat-value">\${usage.totalRequests}</div>
                <div class="stat-label">Total Requests</div>
              </div>
              <div class="stat-box">
                <div class="stat-value">\${usage.avgResponseTime}ms</div>
                <div class="stat-label">Avg Response</div>
              </div>
              <div class="stat-box">
                <div class="stat-value">\${usage.errorRate}%</div>
                <div class="stat-label">Error Rate</div>
              </div>
            </div>
            <p><strong>Top Endpoints:</strong></p>
            <ul>
              \${usage.endpoints.map(e => \`<li>\${e.endpoint}: \${e.count} requests</li>\`).join('')}
            </ul>
          \`;
        } else {
          responseDiv.className = 'response error';
          responseDiv.textContent = JSON.stringify(data, null, 2);
          responseDiv.style.display = 'block';
          keyInfoDiv.style.display = 'none';
          usageInfoDiv.style.display = 'none';
        }
      } catch (err) {
        responseDiv.className = 'response error';
        responseDiv.textContent = 'Error: ' + err.message;
        responseDiv.style.display = 'block';
      }
    }

    async function createApiKey() {
      const masterKey = document.getElementById('masterKey').value.trim();
      const responseDiv = document.getElementById('createResponse');

      const permissions = [];
      if (document.getElementById('perm-read').checked) permissions.push('read');
      if (document.getElementById('perm-auth').checked) permissions.push('auth');
      if (document.getElementById('perm-write').checked) permissions.push('write');
      if (document.getElementById('perm-presence').checked) permissions.push('presence');
      if (document.getElementById('perm-admin').checked) permissions.push('admin');

      const body = {
        name: document.getElementById('keyName').value,
        userId: document.getElementById('userId').value,
        rateLimit: parseInt(document.getElementById('rateLimit').value) || 60,
        expiresInDays: parseInt(document.getElementById('expiryDays').value) || undefined,
        permissions: permissions.length > 0 ? permissions : ['read']
      };

      try {
        const res = await fetch(API_BASE + '/admin/keys', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': masterKey
          },
          body: JSON.stringify(body)
        });
        const data = await res.json();

        responseDiv.style.display = 'block';
        if (data.success) {
          responseDiv.className = 'response success';
          responseDiv.innerHTML = \`<strong>API Key Created!</strong>\\n\\nKey: \${data.data.key}\\n\\n<strong>Save this key - it won't be shown again!</strong>\\n\\n\` + JSON.stringify(data.data, null, 2);
        } else {
          responseDiv.className = 'response error';
          responseDiv.textContent = JSON.stringify(data, null, 2);
        }
      } catch (err) {
        responseDiv.className = 'response error';
        responseDiv.textContent = 'Error: ' + err.message;
        responseDiv.style.display = 'block';
      }
    }

    // Check for API key in URL params
    const urlParams = new URLSearchParams(window.location.search);
    const keyParam = urlParams.get('key');
    if (keyParam) {
      document.getElementById('checkApiKey').value = keyParam;
      checkApiKey();
    }
  </script>
</body>
</html>`;
}

function getDocsHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SIX API - Documentation</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; line-height: 1.6; }
    .container { max-width: 1000px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 2rem; margin-bottom: 10px; color: #38bdf8; }
    h2 { font-size: 1.5rem; margin: 30px 0 15px; color: #f1f5f9; border-bottom: 1px solid #334155; padding-bottom: 10px; }
    h3 { font-size: 1.1rem; margin: 20px 0 10px; color: #38bdf8; }
    .subtitle { color: #94a3b8; margin-bottom: 30px; }
    .nav { display: flex; gap: 20px; margin-bottom: 30px; }
    .nav a { color: #94a3b8; text-decoration: none; padding: 8px 16px; border-radius: 6px; }
    .nav a:hover { background: #1e293b; color: #e2e8f0; }
    .nav a.active { background: #38bdf8; color: #0f172a; }
    .endpoint { background: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 12px; border: 1px solid #334155; }
    .endpoint-method { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; margin-right: 10px; }
    .get { background: #22c55e; color: #fff; }
    .post { background: #3b82f6; color: #fff; }
    .delete { background: #ef4444; color: #fff; }
    .endpoint-path { font-family: 'Monaco', monospace; color: #f1f5f9; }
    .endpoint-desc { color: #94a3b8; margin-top: 8px; font-size: 0.9rem; }
    .code-block { background: #0f172a; border-radius: 6px; padding: 16px; margin: 10px 0; overflow-x: auto; font-family: 'Monaco', 'Menlo', monospace; font-size: 0.85rem; }
    .code-block code { color: #e2e8f0; }
    .param-table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    .param-table th, .param-table td { padding: 10px; text-align: left; border-bottom: 1px solid #334155; }
    .param-table th { color: #94a3b8; font-weight: 500; font-size: 0.85rem; }
    .param-name { font-family: 'Monaco', monospace; color: #38bdf8; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; margin-left: 8px; }
    .tag-auth { background: #f59e0b; color: #0f172a; }
    .tag-public { background: #22c55e; color: #0f172a; }
    .note { background: #1e3a5f; border-left: 4px solid #38bdf8; padding: 12px 16px; margin: 15px 0; border-radius: 0 8px 8px 0; }
    .note-title { font-weight: 600; color: #38bdf8; margin-bottom: 4px; }
    .sidebar { position: fixed; right: 20px; top: 100px; width: 200px; }
    .sidebar a { display: block; color: #94a3b8; text-decoration: none; padding: 6px 12px; font-size: 0.85rem; border-radius: 4px; }
    .sidebar a:hover { background: #1e293b; color: #e2e8f0; }
    @media (max-width: 1200px) { .sidebar { display: none; } }
  </style>
</head>
<body>
  <div class="container">
    <nav class="nav">
      <a href="/ui">Dashboard</a>
      <a href="/docs" class="active">Documentation</a>
      <a href="/">API Info</a>
    </nav>

    <h1>SIX API Documentation</h1>
    <p class="subtitle">Unofficial API for SIX ITB academic system</p>

    <div class="sidebar">
      <a href="#authentication">Authentication</a>
      <a href="#auth-endpoints">Auth Endpoints</a>
      <a href="#data-endpoints">Data Endpoints</a>
      <a href="#admin-endpoints">Admin Endpoints</a>
      <a href="#errors">Error Codes</a>
    </div>

    <h2 id="authentication">Authentication</h2>
    <p>All API requests require an API key. Include it in one of two ways:</p>

    <h3>Header (Recommended)</h3>
    <div class="code-block"><code>curl -H "X-API-Key: sk_your_api_key" https://api.example.com/data/profile</code></div>

    <h3>Query Parameter</h3>
    <div class="code-block"><code>curl "https://api.example.com/data/profile?api_key=sk_your_api_key"</code></div>

    <div class="note">
      <div class="note-title">Master Admin Key</div>
      Server administrators can use the MASTER_ADMIN_KEY for full access to all endpoints.
    </div>

    <h2 id="auth-endpoints">Authentication Endpoints</h2>

    <div class="note">
      <div class="note-title">Server Deployment</div>
      For VPS/server deployments, use <code>POST /auth/restore</code> with cookies exported from your browser.
      The <code>/auth/browser</code> endpoint requires a display and is only for local development.
    </div>

    <div class="endpoint">
      <span class="endpoint-method post">POST</span>
      <span class="endpoint-path">/auth/restore</span>
      <span class="tag tag-auth">auth</span>
      <p class="endpoint-desc"><strong>RECOMMENDED for servers.</strong> Create session from browser cookies. User logs in on their own browser and exports cookies.</p>
      <h3>How to get cookies:</h3>
      <ol style="color: #94a3b8; margin: 10px 0; padding-left: 20px;">
        <li>Login to <a href="https://six.itb.ac.id" style="color: #38bdf8;">six.itb.ac.id</a> on your browser</li>
        <li>Open DevTools (F12) → Application → Cookies</li>
        <li>Export cookies for <code>six.itb.ac.id</code> domain</li>
        <li>Required cookies: <code>ASP.NET_SessionId</code>, <code>.ASPXAUTH</code></li>
      </ol>
      <div class="code-block"><code>curl -X POST https://api.example.com/auth/restore \\
  -H "X-API-Key: sk_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "userId": "user-123",
    "cookies": [
      {"name": "ASP.NET_SessionId", "value": "...", "domain": "six.itb.ac.id", "path": "/"},
      {"name": ".ASPXAUTH", "value": "...", "domain": "six.itb.ac.id", "path": "/"}
    ]
  }'</code></div>
      <div class="code-block"><code>// Response
{
  "success": true,
  "data": {
    "sessionId": "abc123...",
    "expiresAt": "2026-03-25T22:00:00.000Z",
    "message": "Session restored successfully. Use sessionId for data endpoints."
  }
}</code></div>
    </div>

    <div class="endpoint">
      <span class="endpoint-method post">POST</span>
      <span class="endpoint-path">/auth/browser</span>
      <span class="tag tag-auth">auth</span>
      <p class="endpoint-desc"><strong>Local development only.</strong> Opens a browser for login. Not suitable for servers (requires display).</p>
      <div class="code-block"><code>curl -X POST https://api.example.com/auth/browser \\
  -H "X-API-Key: sk_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"userId": "user-123"}'</code></div>
    </div>

    <div class="endpoint">
      <span class="endpoint-method post">POST</span>
      <span class="endpoint-path">/auth/restore</span>
      <span class="tag tag-auth">auth</span>
      <p class="endpoint-desc">Restore a session from previously saved cookies.</p>
    </div>

    <div class="endpoint">
      <span class="endpoint-method get">GET</span>
      <span class="endpoint-path">/auth/session/:sessionId</span>
      <span class="tag tag-auth">auth</span>
      <p class="endpoint-desc">Get session status and details.</p>
    </div>

    <div class="endpoint">
      <span class="endpoint-method delete">DELETE</span>
      <span class="endpoint-path">/auth/session/:sessionId</span>
      <span class="tag tag-auth">auth</span>
      <p class="endpoint-desc">Logout and delete session.</p>
    </div>

    <h2 id="data-endpoints">Data Endpoints</h2>
    <p>All data endpoints require a valid session ID from the authentication flow.</p>

    <div class="endpoint">
      <span class="endpoint-method get">GET</span>
      <span class="endpoint-path">/data/profile</span>
      <span class="tag tag-auth">read</span>
      <p class="endpoint-desc">Get student profile information.</p>
      <table class="param-table">
        <tr><th>Parameter</th><th>Type</th><th>Description</th></tr>
        <tr><td class="param-name">sessionId</td><td>string</td><td>Session ID from login</td></tr>
        <tr><td class="param-name">refresh</td><td>string</td><td>Set to "true" to bypass cache and fetch fresh data</td></tr>
      </table>
      <div class="note">
        <div class="note-title">Caching</div>
        Data is cached for 30 seconds by default. Use <code>refresh=true</code> to fetch fresh data.
        Response includes <code>cached: true/false</code> to indicate cache status.
      </div>
      <div class="code-block"><code>{
  "success": true,
  "cached": false,
  "data": {
    "nim": "18223047",
    "name": "John Doe",
    "faculty": "STEI",
    "studyProgram": "Informatics",
    "gpa": 3.89
  }
}</code></div>
    </div>

    <div class="endpoint">
      <span class="endpoint-method get">GET</span>
      <span class="endpoint-path">/data/courses</span>
      <span class="tag tag-auth">read</span>
      <p class="endpoint-desc">Get current semester courses.</p>
    </div>

    <div class="endpoint">
      <span class="endpoint-method get">GET</span>
      <span class="endpoint-path">/data/schedule</span>
      <span class="tag tag-auth">read</span>
      <p class="endpoint-desc">Get weekly schedule.</p>
      <table class="param-table">
        <tr><th>Parameter</th><th>Type</th><th>Description</th></tr>
        <tr><td class="param-name">sessionId</td><td>string</td><td>Session ID from login</td></tr>
        <tr><td class="param-name">semester</td><td>string</td><td>Semester code (e.g., "2024-1"), optional</td></tr>
      </table>
    </div>

    <div class="endpoint">
      <span class="endpoint-method get">GET</span>
      <span class="endpoint-path">/data/schedule/today</span>
      <span class="tag tag-auth">read</span>
      <p class="endpoint-desc">Get today's classes.</p>
    </div>

    <div class="endpoint">
      <span class="endpoint-method get">GET</span>
      <span class="endpoint-path">/data/financial</span>
      <span class="tag tag-auth">read</span>
      <p class="endpoint-desc">Get financial/payment status.</p>
    </div>

    <div class="endpoint">
      <span class="endpoint-method get">GET</span>
      <span class="endpoint-path">/data/study-plan</span>
      <span class="tag tag-auth">read</span>
      <p class="endpoint-desc">Get study plan (KRS).</p>
    </div>

    <h2 id="admin-endpoints">Admin Endpoints</h2>
    <p>These endpoints require master admin key or API key with admin permission.</p>

    <div class="endpoint">
      <span class="endpoint-method post">POST</span>
      <span class="endpoint-path">/admin/keys</span>
      <p class="endpoint-desc">Create a new API key.</p>
      <table class="param-table">
        <tr><th>Parameter</th><th>Type</th><th>Description</th></tr>
        <tr><td class="param-name">name</td><td>string</td><td>Key name (required)</td></tr>
        <tr><td class="param-name">userId</td><td>string</td><td>User identifier (required)</td></tr>
        <tr><td class="param-name">permissions</td><td>array</td><td>Permissions: read, auth, write, presence, admin</td></tr>
        <tr><td class="param-name">rateLimit</td><td>number</td><td>Requests per minute (default: 60)</td></tr>
        <tr><td class="param-name">expiresInDays</td><td>number</td><td>Days until expiration (optional)</td></tr>
      </table>
    </div>

    <div class="endpoint">
      <span class="endpoint-method get">GET</span>
      <span class="endpoint-path">/admin/keys</span>
      <p class="endpoint-desc">List API keys for a user.</p>
      <table class="param-table">
        <tr><th>Parameter</th><th>Type</th><th>Description</th></tr>
        <tr><td class="param-name">userId</td><td>string</td><td>User identifier</td></tr>
      </table>
    </div>

    <div class="endpoint">
      <span class="endpoint-method get">GET</span>
      <span class="endpoint-path">/admin/keys/:keyId/stats</span>
      <p class="endpoint-desc">Get usage statistics for an API key.</p>
      <table class="param-table">
        <tr><th>Parameter</th><th>Type</th><th>Description</th></tr>
        <tr><td class="param-name">days</td><td>number</td><td>Number of days (default: 7)</td></tr>
      </table>
    </div>

    <div class="endpoint">
      <span class="endpoint-method get">GET</span>
      <span class="endpoint-path">/admin/me</span>
      <p class="endpoint-desc">Get current API key info and usage stats (client self-service).</p>
    </div>

    <div class="endpoint">
      <span class="endpoint-method delete">DELETE</span>
      <span class="endpoint-path">/admin/keys/:keyId</span>
      <p class="endpoint-desc">Revoke an API key.</p>
    </div>

    <h2 id="errors">Error Codes</h2>
    <table class="param-table">
      <tr><th>Code</th><th>Description</th></tr>
      <tr><td class="param-name">MISSING_API_KEY</td><td>No API key provided</td></tr>
      <tr><td class="param-name">INVALID_API_KEY</td><td>API key is invalid, expired, or revoked</td></tr>
      <tr><td class="param-name">INSUFFICIENT_PERMISSIONS</td><td>API key lacks required permission</td></tr>
      <tr><td class="param-name">RATE_LIMIT_EXCEEDED</td><td>Too many requests</td></tr>
      <tr><td class="param-name">SESSION_NOT_FOUND</td><td>Session doesn't exist or expired</td></tr>
      <tr><td class="param-name">SESSION_EXPIRED</td><td>Session has expired, please login again</td></tr>
    </table>

    <h2>Permissions</h2>
    <table class="param-table">
      <tr><th>Permission</th><th>Access</th></tr>
      <tr><td class="param-name">read</td><td>Data endpoints (profile, courses, schedule, etc.)</td></tr>
      <tr><td class="param-name">auth</td><td>Authentication endpoints (login, restore)</td></tr>
      <tr><td class="param-name">write</td><td>Snipe/write endpoints</td></tr>
      <tr><td class="param-name">presence</td><td>Presence marking endpoints</td></tr>
      <tr><td class="param-name">admin</td><td>Full access to all endpoints</td></tr>
    </table>
  </div>
</body>
</html>`;
}