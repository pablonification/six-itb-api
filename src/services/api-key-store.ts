/**
 * API Key Service - Manages API keys for authentication
 */

import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  userId: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
  rateLimit: number; // requests per minute
  permissions: string[]; // e.g., ['read', 'write', 'presence']
}

export interface ApiKeyCreateInput {
  name: string;
  userId: string;
  expiresInDays?: number;
  rateLimit?: number;
  permissions?: string[];
}

export interface ApiKeyUsage {
  keyId: string;
  timestamp: Date;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
}

// Singleton instance
let dbInstance: Database.Database | null = null;

export function getApiKeyStore(dbPath: string = ':memory:'): ApiKeyStore {
  if (!dbInstance) {
    dbInstance = new Database(dbPath);
    dbInstance.pragma('journal_mode = WAL');

    // Create tables
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        expires_at TEXT,
        is_active INTEGER DEFAULT 1,
        rate_limit INTEGER DEFAULT 60,
        permissions TEXT DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS api_key_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        response_time INTEGER NOT NULL,
        FOREIGN KEY (key_id) REFERENCES api_keys(id)
      );

      CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
      CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
      CREATE INDEX IF NOT EXISTS idx_api_key_usage_key_id ON api_key_usage(key_id);
      CREATE INDEX IF NOT EXISTS idx_api_key_usage_timestamp ON api_key_usage(timestamp);
    `);
  }

  return new ApiKeyStore(dbInstance);
}

export class ApiKeyStore {
  constructor(private db: Database.Database) {}

  /**
   * Create a new API key
   */
  createKey(input: ApiKeyCreateInput): ApiKey {
    const id = nanoid(12);
    const key = `sk_${nanoid(32)}`;
    const now = new Date();

    const expiresAt = input.expiresInDays
      ? new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const permissions = input.permissions || ['read'];
    const rateLimit = input.rateLimit || 60; // Default 60 requests per minute

    const stmt = this.db.prepare(`
      INSERT INTO api_keys (id, key, name, user_id, created_at, expires_at, rate_limit, permissions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      key,
      input.name,
      input.userId,
      now.toISOString(),
      expiresAt?.toISOString() || null,
      rateLimit,
      JSON.stringify(permissions)
    );

    return {
      id,
      key,
      name: input.name,
      userId: input.userId,
      createdAt: now,
      lastUsedAt: null,
      expiresAt,
      isActive: true,
      rateLimit,
      permissions,
    };
  }

  /**
   * Validate an API key
   */
  validateKey(key: string): ApiKey | null {
    const stmt = this.db.prepare(`
      SELECT * FROM api_keys WHERE key = ? AND is_active = 1
    `);

    const row = stmt.get(key) as any;
    if (!row) return null;

    const apiKey: ApiKey = {
      id: row.id,
      key: row.key,
      name: row.name,
      userId: row.user_id,
      createdAt: new Date(row.created_at),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      isActive: row.is_active === 1,
      rateLimit: row.rate_limit,
      permissions: JSON.parse(row.permissions),
    };

    // Check if expired
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return null;
    }

    return apiKey;
  }

  /**
   * Update last used timestamp
   */
  updateLastUsed(keyId: string): void {
    const stmt = this.db.prepare(`
      UPDATE api_keys SET last_used_at = ? WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), keyId);
  }

  /**
   * Record API key usage
   */
  recordUsage(usage: Omit<ApiKeyUsage, 'keyId'> & { keyId: string }): void {
    const stmt = this.db.prepare(`
      INSERT INTO api_key_usage (key_id, timestamp, endpoint, method, status_code, response_time)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      usage.keyId,
      usage.timestamp.toISOString(),
      usage.endpoint,
      usage.method,
      usage.statusCode,
      usage.responseTime
    );
  }

  /**
   * Get usage count for rate limiting (last minute)
   */
  getUsageCount(keyId: string): number {
    const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM api_key_usage
      WHERE key_id = ? AND timestamp > ?
    `);
    const result = stmt.get(keyId, oneMinuteAgo) as { count: number };
    return result.count;
  }

  /**
   * Get all keys for a user
   */
  getKeysByUser(userId: string): ApiKey[] {
    const stmt = this.db.prepare(`
      SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC
    `);

    const rows = stmt.all(userId) as any[];
    return rows.map(row => ({
      id: row.id,
      key: row.key,
      name: row.name,
      userId: row.user_id,
      createdAt: new Date(row.created_at),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      isActive: row.is_active === 1,
      rateLimit: row.rate_limit,
      permissions: JSON.parse(row.permissions),
    }));
  }

  /**
   * Revoke an API key
   */
  revokeKey(keyId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE api_keys SET is_active = 0 WHERE id = ?
    `);
    const result = stmt.run(keyId);
    return result.changes > 0;
  }

  /**
   * Delete an API key permanently
   */
  deleteKey(keyId: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM api_keys WHERE id = ?
    `);
    const result = stmt.run(keyId);
    return result.changes > 0;
  }

  /**
   * Get usage statistics for a key
   */
  getUsageStats(keyId: string, days: number = 7): {
    totalRequests: number;
    avgResponseTime: number;
    errorRate: number;
    endpoints: { endpoint: string; count: number }[];
  } {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const totalStmt = this.db.prepare(`
      SELECT COUNT(*) as total, AVG(response_time) as avg_time,
             SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors
      FROM api_key_usage
      WHERE key_id = ? AND timestamp > ?
    `);

    const totalResult = totalStmt.get(keyId, since) as any;

    const endpointsStmt = this.db.prepare(`
      SELECT endpoint, COUNT(*) as count
      FROM api_key_usage
      WHERE key_id = ? AND timestamp > ?
      GROUP BY endpoint
      ORDER BY count DESC
      LIMIT 10
    `);

    const endpoints = endpointsStmt.all(keyId, since) as { endpoint: string; count: number }[];

    return {
      totalRequests: totalResult.total || 0,
      avgResponseTime: Math.round(totalResult.avg_time || 0),
      errorRate: totalResult.total > 0
        ? Math.round((totalResult.errors / totalResult.total) * 100)
        : 0,
      endpoints,
    };
  }

  /**
   * Clean up old usage records (older than 30 days)
   */
  cleanupOldRecords(): number {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const stmt = this.db.prepare(`
      DELETE FROM api_key_usage WHERE timestamp < ?
    `);
    const result = stmt.run(thirtyDaysAgo);
    return result.changes;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}