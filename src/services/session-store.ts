/**
 * Session Store - SQLite-based session persistence
 */

import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { Session, LoginSession, Cookie } from '../models/types.js';

export class SessionStore {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.initializeTables();
  }

  private initializeTables(): void {
    // Sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        nim TEXT,
        semester TEXT,
        cookies TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);

    // Login sessions table (for OAuth flow)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS login_sessions (
        id TEXT PRIMARY KEY,
        login_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        session_id TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_login_sessions_status ON login_sessions(status);
    `);
  }

  // ============================================
  // Session Methods
  // ============================================

  createSession(userId: string, cookies: Cookie[], expiresInMinutes: number = 60): Session {
    const id = nanoid(32);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInMinutes * 60 * 1000);

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, user_id, cookies, created_at, last_accessed_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      userId,
      JSON.stringify(cookies),
      now.toISOString(),
      now.toISOString(),
      expiresAt.toISOString()
    );

    return {
      id,
      userId,
      cookies,
      createdAt: now.toISOString(),
      lastAccessedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  getSession(sessionId: string): Session | null {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE id = ? AND expires_at > datetime('now')
    `);

    const row = stmt.get(sessionId) as any;
    if (!row) return null;

    // Update last accessed
    this.db.prepare(`UPDATE sessions SET last_accessed_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), sessionId);

    return {
      id: row.id,
      userId: row.user_id,
      nim: row.nim,
      semester: row.semester,
      cookies: JSON.parse(row.cookies),
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      expiresAt: row.expires_at,
    };
  }

  getSessionByUserId(userId: string): Session | null {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE user_id = ? AND expires_at > datetime('now')
      ORDER BY created_at DESC LIMIT 1
    `);

    const row = stmt.get(userId) as any;
    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      nim: row.nim,
      semester: row.semester,
      cookies: JSON.parse(row.cookies),
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      expiresAt: row.expires_at,
    };
  }

  updateSession(sessionId: string, updates: Partial<Pick<Session, 'nim' | 'semester' | 'cookies'>>): void {
    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.nim !== undefined) {
      setClauses.push('nim = ?');
      values.push(updates.nim);
    }
    if (updates.semester !== undefined) {
      setClauses.push('semester = ?');
      values.push(updates.semester);
    }
    if (updates.cookies !== undefined) {
      setClauses.push('cookies = ?');
      values.push(JSON.stringify(updates.cookies));
    }

    if (setClauses.length === 0) return;

    values.push(sessionId);
    this.db.prepare(`UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteSession(sessionId: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
  }

  deleteSessionByUserId(userId: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  }

  // ============================================
  // Login Session Methods (OAuth Flow)
  // ============================================

  createLoginSession(loginUrl: string, expiresInMinutes: number = 10): LoginSession {
    const id = nanoid(16);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInMinutes * 60 * 1000);

    const stmt = this.db.prepare(`
      INSERT INTO login_sessions (id, login_url, status, created_at, expires_at)
      VALUES (?, ?, 'pending', ?, ?)
    `);

    stmt.run(id, loginUrl, now.toISOString(), expiresAt.toISOString());

    return {
      id,
      loginUrl,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  getLoginSession(loginId: string): LoginSession | null {
    const stmt = this.db.prepare(`
      SELECT ls.*, s.id as session_id
      FROM login_sessions ls
      LEFT JOIN sessions s ON ls.session_id = s.id
      WHERE ls.id = ?
    `);

    const row = stmt.get(loginId) as any;
    if (!row) return null;

    return {
      id: row.id,
      loginUrl: row.login_url,
      status: row.status,
      session: row.session_id ? this.getSession(row.session_id) ?? undefined : undefined,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  completeLoginSession(loginId: string, sessionId: string): void {
    this.db.prepare(`
      UPDATE login_sessions SET status = 'completed', session_id = ? WHERE id = ?
    `).run(sessionId, loginId);
  }

  expireLoginSession(loginId: string): void {
    this.db.prepare(`
      UPDATE login_sessions SET status = 'expired' WHERE id = ?
    `).run(loginId);
  }

  // ============================================
  // Cleanup Methods
  // ============================================

  cleanupExpired(): number {
    const result = this.db.prepare(`
      DELETE FROM sessions WHERE expires_at < datetime('now')
    `).run();

    this.db.prepare(`
      DELETE FROM login_sessions WHERE expires_at < datetime('now')
    `).run();

    return result.changes;
  }

  // ============================================
  // Utility Methods
  // ============================================

  getStats(): { active: number; total: number; oldestSession: string | null } {
    const activeResult = this.db.prepare(`
      SELECT COUNT(*) as count FROM sessions WHERE expires_at > datetime('now')
    `).get() as { count: number };

    const totalResult = this.db.prepare(`
      SELECT COUNT(*) as count FROM sessions
    `).get() as { count: number };

    const oldestResult = this.db.prepare(`
      SELECT created_at FROM sessions WHERE expires_at > datetime('now') ORDER BY created_at ASC LIMIT 1
    `).get() as { created_at: string } | undefined;

    return {
      active: activeResult.count,
      total: totalResult.count,
      oldestSession: oldestResult?.created_at || null,
    };
  }

  close(): void {
    this.db.close();
  }
}

// Singleton instance
let storeInstance: SessionStore | null = null;

export function getSessionStore(dbPath?: string): SessionStore {
  if (!storeInstance) {
    storeInstance = new SessionStore(dbPath);
  }
  return storeInstance;
}