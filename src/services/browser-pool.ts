/**
 * Browser Pool Service - Manages Playwright browser instances
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import type { Cookie } from '../models/types.js';

interface BrowserPoolOptions {
  maxBrowsers: number;
  maxContextsPerBrowser: number;
  headless: boolean;
}

interface PooledContext {
  id: string;
  context: BrowserContext;
  lastUsed: Date;
  inUse: boolean;
}

export class BrowserPool {
  private browsers: Browser[] = [];
  private contexts: Map<string, PooledContext> = new Map();
  private options: BrowserPoolOptions;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: Partial<BrowserPoolOptions> = {}) {
    this.options = {
      maxBrowsers: options.maxBrowsers ?? 3,
      maxContextsPerBrowser: options.maxContextsPerBrowser ?? 5,
      headless: options.headless ?? true,
    };
  }

  /**
   * Initialize the browser pool
   */
  async initialize(): Promise<void> {
    // Start cleanup interval (every 5 minutes)
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);

    // Don't pre-warm browser - create on demand
    // This prevents crashes if Playwright isn't installed yet
  }

  /**
   * Get or create a browser instance
   */
  private async getOrCreateBrowser(): Promise<Browser> {
    // Find a browser with available context slots
    for (const browser of this.browsers) {
      const contextsForBrowser = Array.from(this.contexts.values())
        .filter(ctx => ctx.context.browser() === browser);

      if (contextsForBrowser.length < this.options.maxContextsPerBrowser) {
        return browser;
      }
    }

    // Need to create a new browser
    if (this.browsers.length >= this.options.maxBrowsers) {
      // Close the oldest unused browser
      const oldestBrowser = this.browsers[0];
      await this.closeBrowser(oldestBrowser);
    }

    const browser = await chromium.launch({
      headless: this.options.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    this.browsers.push(browser);
    return browser;
  }

  /**
   * Create a new browser context with optional cookies
   */
  async createContext(id: string, cookies?: Cookie[]): Promise<BrowserContext> {
    // Check if context already exists
    const existing = this.contexts.get(id);
    if (existing) {
      existing.lastUsed = new Date();
      return existing.context;
    }

    const browser = await this.getOrCreateBrowser();

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
    });

    // Set cookies if provided
    if (cookies && cookies.length > 0) {
      await context.addCookies(cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
      })));
    }

    this.contexts.set(id, {
      id,
      context,
      lastUsed: new Date(),
      inUse: true,
    });

    return context;
  }

  /**
   * Get an existing context
   */
  getContext(id: string): BrowserContext | null {
    const pooled = this.contexts.get(id);
    if (!pooled) return null;

    pooled.lastUsed = new Date();
    return pooled.context;
  }

  /**
   * Create a new page in a context
   */
  async createPage(contextId: string): Promise<Page> {
    const context = this.getContext(contextId);
    if (!context) {
      throw new Error(`Context ${contextId} not found`);
    }
    return context.newPage();
  }

  /**
   * Get cookies from a context
   */
  async getCookies(contextId: string): Promise<Cookie[]> {
    const context = this.getContext(contextId);
    if (!context) {
      throw new Error(`Context ${contextId} not found`);
    }

    const cookies = await context.cookies();
    return cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
    }));
  }

  /**
   * Release a context (mark as not in use)
   */
  releaseContext(id: string): void {
    const pooled = this.contexts.get(id);
    if (pooled) {
      pooled.inUse = false;
      pooled.lastUsed = new Date();
    }
  }

  /**
   * Close a specific context
   */
  async closeContext(id: string): Promise<void> {
    const pooled = this.contexts.get(id);
    if (pooled) {
      await pooled.context.close().catch(() => {});
      this.contexts.delete(id);
    }
  }

  /**
   * Close a browser and all its contexts
   */
  private async closeBrowser(browser: Browser): Promise<void> {
    // Close all contexts for this browser
    for (const [id, pooled] of this.contexts.entries()) {
      if (pooled.context.browser() === browser) {
        await pooled.context.close().catch(() => {});
        this.contexts.delete(id);
      }
    }

    await browser.close().catch(() => {});
    this.browsers = this.browsers.filter(b => b !== browser);
  }

  /**
   * Cleanup unused contexts and browsers
   */
  private async cleanup(): Promise<void> {
    const now = Date.now();
    const maxIdleTime = 30 * 60 * 1000; // 30 minutes

    for (const [id, pooled] of this.contexts.entries()) {
      if (!pooled.inUse && now - pooled.lastUsed.getTime() > maxIdleTime) {
        await this.closeContext(id);
      }
    }
  }

  /**
   * Shutdown the pool
   */
  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all contexts
    for (const id of this.contexts.keys()) {
      await this.closeContext(id);
    }

    // Close all browsers
    for (const browser of this.browsers) {
      await browser.close().catch(() => {});
    }

    this.browsers = [];
    this.contexts.clear();
  }

  /**
   * Get pool statistics
   */
  getStats(): { browsers: number; contexts: number; activeContexts: number } {
    return {
      browsers: this.browsers.length,
      contexts: this.contexts.size,
      activeContexts: Array.from(this.contexts.values()).filter(c => c.inUse).length,
    };
  }
}

// Singleton instance
let poolInstance: BrowserPool | null = null;

export function getBrowserPool(options?: Partial<BrowserPoolOptions>): BrowserPool {
  if (!poolInstance) {
    poolInstance = new BrowserPool(options);
  }
  return poolInstance;
}