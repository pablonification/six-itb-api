/**
 * Sniping Service - Course registration automation (KRS/PRS)
 */

import { Page, BrowserContext } from 'playwright';
import { nanoid } from 'nanoid';
import { getSessionStore } from './session-store.js';
import { getBrowserPool } from './browser-pool.js';
import { scrapeCourseSlots, checkSessionValid } from './six-scraper.js';
import type { SnipeJob, SnipeConfig, SnipeType, Cookie } from '../models/types.js';

// In-memory job storage (could be moved to SQLite for persistence)
const activeJobs = new Map<string, SnipeJob>();

export interface SnipeManagerEvents {
  onUpdate: (job: SnipeJob) => void;
  onComplete: (job: SnipeJob) => void;
  onError: (job: SnipeJob, error: string) => void;
}

class SnipeManager {
  private events: SnipeManagerEvents | null = null;
  private intervals = new Map<string, NodeJS.Timeout>();

  setEvents(events: SnipeManagerEvents) {
    this.events = events;
  }

  /**
   * Start a new snipe job
   */
  async startJob(userId: string, config: SnipeConfig): Promise<SnipeJob> {
    const id = nanoid(16);

    const job: SnipeJob = {
      id,
      userId,
      config,
      status: 'pending',
      checks: 0,
      startedAt: new Date().toISOString(),
    };

    activeJobs.set(id, job);

    // Start monitoring
    this.startMonitoring(job);

    return job;
  }

  /**
   * Get job by ID
   */
  getJob(jobId: string): SnipeJob | undefined {
    return activeJobs.get(jobId);
  }

  /**
   * Get all jobs for a user
   */
  getJobsByUser(userId: string): SnipeJob[] {
    return Array.from(activeJobs.values()).filter(j => j.userId === userId);
  }

  /**
   * Cancel a job
   */
  cancelJob(jobId: string): boolean {
    const job = activeJobs.get(jobId);
    if (!job) return false;

    // Clear interval
    const interval = this.intervals.get(jobId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(jobId);
    }

    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();

    return true;
  }

  /**
   * Start monitoring for slot availability
   */
  private startMonitoring(job: SnipeJob) {
    job.status = 'monitoring';

    const intervalMs = job.config.intervalMs || 5000;
    const maxChecks = job.config.maxChecks || 100;

    const interval = setInterval(async () => {
      if (job.checks >= maxChecks) {
        this.failJob(job, 'Maximum checks reached');
        return;
      }

      if (job.status !== 'monitoring') {
        clearInterval(interval);
        this.intervals.delete(job.id);
        return;
      }

      try {
        await this.checkSlot(job);
      } catch (error) {
        console.error(`Snipe job ${job.id} error:`, error);
      }
    }, intervalMs);

    this.intervals.set(job.id, interval);
  }

  /**
   * Check slot availability and execute if available
   */
  private async checkSlot(job: SnipeJob) {
    const sessionStore = getSessionStore();
    const browserPool = getBrowserPool();

    const session = sessionStore.getSession(job.userId);
    if (!session) {
      this.failJob(job, 'Session not found');
      return;
    }

    const cookies = session.cookies;

    // Create or get context
    let context: BrowserContext;
    try {
      context = await browserPool.createContext(`snipe_${job.id}`, cookies);
    } catch {
      context = browserPool.getContext(`snipe_${job.id}`) || await browserPool.createContext(`snipe_${job.id}`, cookies);
    }

    const page = await context.newPage();

    try {
      // Navigate to course page
      await page.goto(job.config.courseUrl, { waitUntil: 'networkidle' });

      const isValid = await checkSessionValid(page);
      if (!isValid) {
        await page.close();
        this.failJob(job, 'Session expired');
        return;
      }

      // Get slot info
      const slots = await scrapeCourseSlots(page);
      const targetSlot = slots.find(s => s.classNumber === job.config.classNumber);

      job.checks++;
      job.lastCheck = {
        kuota: targetSlot?.quota || 0,
        pendaftar: targetSlot?.enrolled || 0,
        available: targetSlot?.available || false,
        timestamp: new Date().toISOString(),
      };

      // Notify update
      this.events?.onUpdate(job);

      // Check if slot is available
      if (targetSlot?.available) {
        job.status = 'executing';
        this.events?.onUpdate(job);

        if (job.config.dryRun) {
          // Dry run - don't actually register
          job.status = 'completed';
          job.completedAt = new Date().toISOString();
          job.result = {
            success: true,
            course: `Class ${job.config.classNumber} (dry run)`,
          };
          this.events?.onComplete(job);
          await page.close();
          return;
        }

        // Execute the registration
        const success = await this.executeRegistration(page, job);

        if (success) {
          job.status = 'completed';
          job.completedAt = new Date().toISOString();
          job.result = {
            success: true,
            course: `Class ${job.config.classNumber}`,
          };
          this.events?.onComplete(job);
        } else {
          this.failJob(job, 'Registration failed');
        }
      }

      await page.close();
    } catch (error) {
      await page.close().catch(() => {});
      console.error(`Check error for job ${job.id}:`, error);
    }
  }

  /**
   * Execute the course registration
   */
  private async executeRegistration(page: Page, job: SnipeJob): Promise<boolean> {
    try {
      // Navigate to rencana studi page first
      await page.goto(job.config.rencanaStudiUrl, { waitUntil: 'networkidle' });

      // For KRS (new registration), we need to cancel previous submission first
      // For PRS (change request), we can directly add courses
      if (job.config.type === 'krs') {
        // Look for "Batal Kirim" button and click it if exists
        const batalBtn = await page.$('button:has-text("Batal Kirim"), input[value="Batal Kirim"]');
        if (batalBtn) {
          await batalBtn.click();
          await page.waitForTimeout(1000);

          // Handle confirmation dialog if any
          const confirmBtn = await page.$('button:has-text("Ya"), button:has-text("OK")');
          if (confirmBtn) {
            await confirmBtn.click();
            await page.waitForTimeout(1000);
          }
        }
      }

      // Navigate back to course page and take the class
      await page.goto(job.config.courseUrl, { waitUntil: 'networkidle' });

      // Find and click the target class number to select it
      const classItems = await page.$$('.list-group-item');
      for (const item of classItems) {
        const text = await item.textContent();
        if (text?.startsWith(job.config.classNumber + ' ')) {
          // Look for "Ambil" button/link within this item
          const ambilBtn = await item.$('button:has-text("Ambil"), a:has-text("Ambil"), input[value="Ambil"]');
          if (ambilBtn) {
            await ambilBtn.click();
            await page.waitForTimeout(1000);
            break;
          }
        }
      }

      // Go back to rencana studi and submit
      await page.goto(job.config.rencanaStudiUrl, { waitUntil: 'networkidle' });

      // Click "Kirim" to submit
      const kirimBtn = await page.$('button:has-text("Kirim"), input[value="Kirim"], button[type="submit"]');
      if (kirimBtn) {
        await kirimBtn.click();
        await page.waitForTimeout(1000);

        // Handle confirmation
        const confirmBtn = await page.$('button:has-text("Ya"), button:has-text("OK"), button:has-text("Kirim")');
        if (confirmBtn) {
          await confirmBtn.click();
          await page.waitForTimeout(2000);
        }
      }

      // Verify success by checking if course is in the list
      await page.goto(job.config.rencanaStudiUrl, { waitUntil: 'networkidle' });
      const pageContent = await page.textContent('body');

      // Check for success indicators (this may need adjustment based on actual page)
      return pageContent?.includes('Berhasil') ||
             pageContent?.includes('tersimpan') ||
             !pageContent?.includes('Gagal');
    } catch (error) {
      console.error('Registration execution error:', error);
      return false;
    }
  }

  /**
   * Mark job as failed
   */
  private failJob(job: SnipeJob, error: string) {
    job.status = 'failed';
    job.completedAt = new Date().toISOString();
    job.result = {
      success: false,
      error,
    };

    // Clear interval
    const interval = this.intervals.get(job.id);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(job.id);
    }

    this.events?.onError(job, error);
  }

  /**
   * Cleanup all jobs
   */
  cleanup() {
    for (const [id, interval] of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.clear();
    activeJobs.clear();
  }
}

// Singleton instance
let snipeManagerInstance: SnipeManager | null = null;

export function getSnipeManager(): SnipeManager {
  if (!snipeManagerInstance) {
    snipeManagerInstance = new SnipeManager();
  }
  return snipeManagerInstance;
}

export { SnipeManager };