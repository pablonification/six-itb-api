/**
 * Auth Middleware - API Key authentication and rate limiting
 */

import { FastifyInstance, FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { getApiKeyStore, ApiKey } from './api-key-store.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKey;
  }
}

// Endpoints that don't require API key
const PUBLIC_ENDPOINTS = [
  '/',
  '/health',
  '/health/',
  '/ws',
  '/ws/',
  '/ready',
  '/ready/',
  '/ui',
  '/ui/',
  '/docs',
  '/docs/',
  '/auth/login',      // Helper page for users
  '/auth/login/',
];

// Master admin key for initial setup (from environment variable)
const MASTER_ADMIN_KEY = process.env.MASTER_ADMIN_KEY || null;

// Endpoints that require specific permissions
const PERMISSION_MAP: Record<string, string> = {
  'POST /auth/restore': 'auth',
  'GET /auth/session': 'auth',
  'DELETE /auth/session': 'auth',

  'GET /data/profile': 'read',
  'GET /data/courses': 'read',
  'GET /data/schedule': 'read',
  'GET /data/financial': 'read',
  'GET /data/study-plan': 'read',

  'POST /presence/mark': 'presence',
  'POST /presence/mark-course': 'presence',

  'POST /snipe/start': 'write',
  'POST /snipe/cancel': 'write',
};

export interface AuthMiddlewareOptions {
  enabled?: boolean;
  dbPath?: string;
}

// Store for rate limiting (in-memory for speed)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Clean up expired rate limit entries periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000);

export function createAuthMiddleware(options: AuthMiddlewareOptions = {}) {
  const enabled = options.enabled !== false;
  const apiKeyStore = getApiKeyStore(options.dbPath);

  return {
    // Pre-handler hook for authentication and rate limiting
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      if (!enabled) {
        return;
      }

      const path = request.url.split('?')[0];
      const method = request.method;
      const endpointKey = `${method} ${path}`;

      // Skip public endpoints
      if (PUBLIC_ENDPOINTS.includes(path)) {
        return;
      }

      // Get API key from header or query
      const apiKeyHeader = request.headers['x-api-key'] as string;
      const apiKeyQuery = (request.query as any)?.api_key as string;
      const apiKeyValue = apiKeyHeader || apiKeyQuery;

      if (!apiKeyValue) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'MISSING_API_KEY',
            message: 'API key is required. Provide it via X-API-Key header or api_key query parameter.',
          },
        });
      }

      // Check for master admin key (full access)
      if (MASTER_ADMIN_KEY && apiKeyValue === MASTER_ADMIN_KEY) {
        request.apiKey = {
          id: 'master-admin',
          key: MASTER_ADMIN_KEY,
          name: 'Master Admin Key',
          userId: 'system',
          createdAt: new Date(),
          lastUsedAt: new Date(),
          expiresAt: null,
          isActive: true,
          rateLimit: 999999,
          permissions: ['admin', 'read', 'write', 'presence', 'auth'],
        };
        return;
      }

      // Validate API key
      const apiKey = apiKeyStore.validateKey(apiKeyValue);
      if (!apiKey) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'INVALID_API_KEY',
            message: 'The provided API key is invalid, expired, or revoked.',
          },
        });
      }

      // Check permissions
      const requiredPermission = PERMISSION_MAP[endpointKey];
      if (requiredPermission && !apiKey.permissions.includes(requiredPermission) && !apiKey.permissions.includes('admin')) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: `This endpoint requires '${requiredPermission}' permission.`,
            required: requiredPermission,
            current: apiKey.permissions,
          },
        });
      }

      // Check rate limit
      const rateLimitKey = apiKey.id;
      const now = Date.now();
      const windowMs = 60000; // 1 minute
      const limitEntry = rateLimitStore.get(rateLimitKey);

      if (limitEntry && limitEntry.resetAt > now) {
        if (limitEntry.count >= apiKey.rateLimit) {
          return reply.status(429).send({
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: `Rate limit of ${apiKey.rateLimit} requests per minute exceeded.`,
              retryAfter: Math.ceil((limitEntry.resetAt - now) / 1000),
            },
          });
        }
        limitEntry.count++;
      } else {
        rateLimitStore.set(rateLimitKey, { count: 1, resetAt: now + windowMs });
      }

      // Attach API key to request
      request.apiKey = apiKey;

      // Update last used
      apiKeyStore.updateLastUsed(apiKey.id);
    },

    // On-response hook for usage tracking
    onResponse: async (request: FastifyRequest, reply: FastifyReply) => {
      if (!enabled || !request.apiKey) {
        return;
      }

      const startTime = (request as any).startTime || Date.now();
      const responseTime = Date.now() - startTime;
      const path = request.url.split('?')[0];

      apiKeyStore.recordUsage({
        keyId: request.apiKey.id,
        timestamp: new Date(),
        endpoint: path,
        method: request.method,
        statusCode: reply.statusCode,
        responseTime,
      });
    },

    // On-request hook for timing
    onRequest: async (request: FastifyRequest) => {
      (request as any).startTime = Date.now();
    },
  };
}

/**
 * Admin routes for API key management
 */
export async function apiKeyAdminRoutes(app: FastifyInstance) {
  const apiKeyStore = getApiKeyStore();

  /**
   * POST /admin/keys - Create a new API key
   */
  app.post('/keys', async (request, reply) => {
    const body = request.body as {
      name: string;
      userId: string;
      expiresInDays?: number;
      rateLimit?: number;
      permissions?: string[];
    };

    if (!body.name || !body.userId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'name and userId are required' },
      });
    }

    const key = apiKeyStore.createKey({
      name: body.name,
      userId: body.userId,
      expiresInDays: body.expiresInDays,
      rateLimit: body.rateLimit,
      permissions: body.permissions,
    });

    return {
      success: true,
      data: {
        id: key.id,
        key: key.key, // Only shown once!
        name: key.name,
        userId: key.userId,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt,
        rateLimit: key.rateLimit,
        permissions: key.permissions,
      },
    };
  });

  /**
   * GET /admin/keys - List API keys for a user
   */
  app.get('/keys', async (request, reply) => {
    const query = request.query as { userId: string };
    if (!query.userId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'userId is required' },
      });
    }

    const keys = apiKeyStore.getKeysByUser(query.userId);

    // Mask the actual key values
    const maskedKeys = keys.map(k => ({
      ...k,
      key: k.key.substring(0, 7) + '...' + k.key.substring(k.key.length - 4),
    }));

    return { success: true, data: maskedKeys };
  });

  /**
   * GET /admin/keys/:keyId/stats - Get usage statistics
   */
  app.get('/keys/:keyId/stats', async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    const query = request.query as { days?: string };

    const days = parseInt(query.days || '7');
    const stats = apiKeyStore.getUsageStats(keyId, days);

    return { success: true, data: stats };
  });

  /**
   * DELETE /admin/keys/:keyId - Revoke an API key
   */
  app.delete('/keys/:keyId', async (request, reply) => {
    const { keyId } = request.params as { keyId: string };

    const revoked = apiKeyStore.revokeKey(keyId);
    if (!revoked) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'API key not found' },
      });
    }

    return { success: true, data: { message: 'API key revoked' } };
  });

  /**
   * GET /admin/me - Get current API key info (client self-service)
   * Clients can use this to view their own key details and usage
   */
  app.get('/me', async (request, reply) => {
    if (!request.apiKey) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'API key required' },
      });
    }

    const stats = apiKeyStore.getUsageStats(request.apiKey.id, 7);

    return {
      success: true,
      data: {
        key: {
          id: request.apiKey.id,
          name: request.apiKey.name,
          userId: request.apiKey.userId,
          createdAt: request.apiKey.createdAt,
          lastUsedAt: request.apiKey.lastUsedAt,
          expiresAt: request.apiKey.expiresAt,
          isActive: request.apiKey.isActive,
          rateLimit: request.apiKey.rateLimit,
          permissions: request.apiKey.permissions,
        },
        usage: stats,
      },
    };
  });
}