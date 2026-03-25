/**
 * SIX API Server - Main entry point
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { authRoutes } from './routes/auth.js';
import { dataRoutes } from './routes/data.js';
import { presenceRoutes } from './routes/presence.js';
import { snipeRoutes } from './routes/snipe.js';
import { uiRoutes } from './routes/ui.js';
import { getBrowserPool } from './services/browser-pool.js';
import { getSessionStore } from './services/session-store.js';
import { getSnipeManager } from './services/snipe-manager.js';
import { createAuthMiddleware, apiKeyAdminRoutes } from './services/auth-middleware.js';
import { getApiKeyStore } from './services/api-key-store.js';
import type { WsMessage, WsSnipeUpdate } from './models/types.js';

// Environment configuration
const config = {
  port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  dbPath: process.env.DB_PATH || ':memory:',
  apiKeyDbPath: process.env.API_KEY_DB_PATH || ':memory:',
  apiKeyEnabled: process.env.API_KEY_ENABLED !== 'false',
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

const PORT = config.port;
const HOST = config.host;

export async function createServer() {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.nodeEnv !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // Register plugins
  await fastify.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
  });

  await fastify.register(websocket);

  // Initialize services
  const browserPool = getBrowserPool({ headless: true });
  const sessionStore = getSessionStore(config.dbPath);
  const snipeManager = getSnipeManager();
  const apiKeyStore = getApiKeyStore(config.apiKeyDbPath);

  // Auth middleware
  const authMiddleware = createAuthMiddleware({
    enabled: config.apiKeyEnabled,
    dbPath: config.apiKeyDbPath,
  });

  // Register hooks for authentication and rate limiting
  fastify.addHook('onRequest', authMiddleware.onRequest);
  fastify.addHook('preHandler', authMiddleware.preHandler);
  fastify.addHook('onResponse', authMiddleware.onResponse);

  // Set up snipe manager events for WebSocket broadcasts
  const wsClients = new Set<WebSocket>();

  snipeManager.setEvents({
    onUpdate: (job) => {
      const message: WsMessage = {
        type: 'snipe_update',
        payload: {
          jobId: job.id,
          status: job.status,
          checks: job.checks,
          lastCheck: job.lastCheck,
          result: job.result,
        } as WsSnipeUpdate,
        timestamp: new Date().toISOString(),
      };

      for (const client of wsClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(message));
        }
      }
    },
    onComplete: (job) => {
      const message: WsMessage = {
        type: 'snipe_update',
        payload: {
          jobId: job.id,
          status: job.status,
          checks: job.checks,
          lastCheck: job.lastCheck,
          result: job.result,
        } as WsSnipeUpdate,
        timestamp: new Date().toISOString(),
      };

      for (const client of wsClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(message));
        }
      }
    },
    onError: (job, error) => {
      const message: WsMessage = {
        type: 'snipe_update',
        payload: {
          jobId: job.id,
          status: job.status,
          checks: job.checks,
          lastCheck: job.lastCheck,
          result: { success: false, error },
        } as WsSnipeUpdate,
        timestamp: new Date().toISOString(),
      };

      for (const client of wsClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(message));
        }
      }
    },
  });

  // WebSocket route for real-time updates
  fastify.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, (connection: WebSocket, req) => {
      // In @fastify/websocket, connection is the WebSocket itself
      const socket = connection;
      wsClients.add(socket);

      fastify.log.info('WebSocket client connected');

      socket.on('message', (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString());

          // Handle subscription to specific job updates
          if (data.type === 'subscribe' && data.jobId) {
            socket.send(JSON.stringify({
              type: 'subscribed',
              payload: { jobId: data.jobId },
              timestamp: new Date().toISOString(),
            }));
          }
        } catch {
          // Ignore invalid messages
        }
      });

      socket.on('close', () => {
        wsClients.delete(socket);
        fastify.log.info('WebSocket client disconnected');
      });
    });
  });

  // Health check
  fastify.get('/health', async () => {
    const browserStats = browserPool.getStats();
    const sessionStats = sessionStore.getStats ? sessionStore.getStats() : { active: 'unknown' };

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: config.nodeEnv,
      apiKeyEnabled: config.apiKeyEnabled,
      services: {
        browser: browserStats,
        sessions: sessionStats,
      },
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        unit: 'MB',
      },
    };
  });

  // Readiness check for Kubernetes
  fastify.get('/ready', async () => {
    const browserStats = browserPool.getStats();
    return {
      status: browserStats.browsers > 0 ? 'ready' : 'initializing',
      timestamp: new Date().toISOString(),
    };
  });

  // API info
  fastify.get('/', async () => ({
    name: 'SIX ITB API',
    version: '1.0.0',
    description: 'Unofficial API for SIX ITB academic system',
    authentication: config.apiKeyEnabled ? 'API Key required (X-API-Key header or api_key query param)' : 'Disabled',
    endpoints: {
      public: {
        'GET /': 'API information',
        'GET /health': 'Health check',
        'GET /ready': 'Readiness check (for Kubernetes)',
        'GET /ws': 'WebSocket for real-time updates',
      },
      auth: {
        'POST /auth/login': 'Start login session',
        'POST /auth/browser': 'Browser-based login',
        'POST /auth/callback': 'Check login status',
        'GET /auth/session/:sessionId': 'Get session info',
        'DELETE /auth/session/:sessionId': 'Logout',
        'POST /auth/restore': 'Restore session from cookies',
      },
      data: {
        'GET /data/profile': 'Get student profile',
        'GET /data/courses': 'Get current courses',
        'GET /data/courses/slots': 'Get course slots',
        'GET /data/schedule': 'Get schedule',
        'GET /data/schedule/today': 'Get today\'s schedule',
        'GET /data/financial': 'Get financial status',
        'GET /data/study-plan': 'Get study plan (KRS)',
      },
      presence: {
        'GET /presence/status': 'Check presence availability',
        'POST /presence/mark': 'Mark presence',
        'POST /presence/mark-course': 'Mark presence for specific course',
        'GET /presence/today': 'Get today\'s classes',
      },
      snipe: {
        'POST /snipe/start': 'Start snipe job',
        'GET /snipe/status/:jobId': 'Get job status',
        'GET /snipe/jobs/:userId': 'Get user jobs',
        'POST /snipe/cancel/:jobId': 'Cancel job',
        'POST /snipe/check': 'One-time slot check',
      },
      admin: {
        'POST /admin/keys': 'Create new API key',
        'GET /admin/keys': 'List API keys for user',
        'GET /admin/keys/:keyId/stats': 'Get usage statistics',
        'DELETE /admin/keys/:keyId': 'Revoke API key',
      },
    },
    permissions: {
      read: 'Access to data endpoints',
      write: 'Access to snipe/write endpoints',
      presence: 'Access to presence marking',
      auth: 'Access to authentication endpoints',
      admin: 'Full access to all endpoints',
    },
  }));

  // Register routes
  await fastify.register(uiRoutes);
  await fastify.register(authRoutes, { prefix: '/auth' });
  await fastify.register(dataRoutes, { prefix: '/data' });
  await fastify.register(presenceRoutes, { prefix: '/presence' });
  await fastify.register(snipeRoutes, { prefix: '/snipe' });
  await fastify.register(apiKeyAdminRoutes, { prefix: '/admin' });

  return fastify;
}

// Start server
async function start() {
  const server = await createServer();

  // Initialize browser pool
  const browserPool = getBrowserPool();
  await browserPool.initialize();

  // Cleanup on shutdown
  const cleanup = async () => {
    server.log.info('Shutting down...');
    await browserPool.shutdown();
    getSessionStore().close();
    getSnipeManager().cleanup();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    await server.listen({ port: PORT, host: HOST });
    server.log.info(`SIX API server running on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

// Run if executed directly
start();