/**
 * SIX ITB Scraper Service - Core scraping logic
 */

import { Page, BrowserContext } from 'playwright';
import type {
  StudentProfile,
  Course,
  ScheduleItem,
  DailySchedule,
  FinancialStatus,
  StudyPlan,
  PresenceStatus,
  PresenceResult,
  CourseSlot,
  Cookie,
} from '../models/types.js';

const SIX_BASE_URL = 'https://six.itb.ac.id';

// ============================================
// Semester Detection
// ============================================

/**
 * Detect current semester based on current date
 * Indonesian academic calendar:
 * - Odd semester (Ganjil/1): August - January
 * - Even semester (Genap/2): February - July
 * Format: YYYY-N (e.g., 2025-2)
 */
export function detectCurrentSemester(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12

  // February (2) - July (7) = Even semester (Genap)
  // August (8) - January (1) = Odd semester (Ganjil)
  if (month >= 2 && month <= 7) {
    // Even semester: Academic year started previous year
    return `${year - 1}-2`;
  } else if (month >= 8) {
    // Odd semester: Academic year starts this year
    return `${year}-1`;
  } else {
    // January: Still part of odd semester from previous academic year
    return `${year - 1}-1`;
  }
}

// ============================================
// Profile Scraping
// ============================================

export async function scrapeProfile(page: Page): Promise<StudentProfile> {
  await page.waitForSelector('body');

  const profile = await page.evaluate(() => {
    // Helper to get text by label
    function getTextByLabel(label: string): string {
      const rows = document.querySelectorAll('table tr, .panel table tr');
      for (let i = 0; i < rows.length; i++) {
        const th = rows[i].querySelector('th');
        const td = rows[i].querySelector('td');
        if (th && td && th.textContent && th.textContent.trim() === label) {
          return td.textContent ? td.textContent.trim() : '';
        }
      }
      return '';
    }

    // Extract NIM from URL or page
    const nimMatch = window.location.href.match(/mahasiswa:(\d+)/);
    const nim = nimMatch ? nimMatch[1] : getTextByLabel('NIM');

    const sksText = getTextByLabel('SKS');
    const ipsText = getTextByLabel('IPS');

    // Parse SKS and IPS with null-safe regex
      let creditsPassed = 0;
      let creditsTotal = 0;
      let lastSemesterGpa = 0;
      let lastSemesterCredits = 0;

      if (sksText) {
        const passedMatch = sksText.match(/Lulus\s*(\d+)/);
        if (passedMatch) creditsPassed = parseInt(passedMatch[1]) || 0;
        const totalMatch = sksText.match(/(\d+)\s*SKS/);
        if (totalMatch) creditsTotal = parseInt(totalMatch[1]) || 0;
      }

      if (ipsText) {
        const gpaMatch = ipsText.match(/([\d.]+)/);
        if (gpaMatch) lastSemesterGpa = parseFloat(gpaMatch[1]) || 0;
        const creditsMatch = ipsText.match(/(\d+)\s*SKS/);
        if (creditsMatch) lastSemesterCredits = parseInt(creditsMatch[1]) || 0;
      }

    return {
      nim: nim,
      name: getTextByLabel('Nama'),
      faculty: getTextByLabel('Fakultas'),
      studyProgram: getTextByLabel('Program Studi'),
      studyProgramCode: '',
      class: getTextByLabel('Kelas'),
      entryYear: getTextByLabel('Tahun Masuk'),
      entrySemester: '',
      academicAdvisor: getTextByLabel('Dosen Wali'),
      gpa: parseFloat(getTextByLabel('IPK')) || 0,
      creditsPassed: creditsPassed,
      creditsTotal: creditsTotal,
      lastSemesterGpa: lastSemesterGpa,
      lastSemesterCredits: lastSemesterCredits,
    };
  });

  // Extract study program code
  const programMatch = profile.studyProgram.match(/^(\d+)\s*\//);
  if (programMatch) {
    profile.studyProgramCode = programMatch[1];
  }

  // Extract entry semester
  const entryMatch = profile.entryYear.match(/(\d+)\s*semester\s*(\d+)/i);
  if (entryMatch) {
    profile.entryYear = entryMatch[1];
    profile.entrySemester = entryMatch[2];
  }

  return profile;
}

// ============================================
// Course Scraping
// ============================================

export async function scrapeCurrentCourses(page: Page): Promise<Course[]> {
  await page.waitForSelector('table');

  return page.evaluate(() => {
    const courses: Course[] = [];
    const tables = document.querySelectorAll('table.table-striped, table.table');

    for (let t = 0; t < tables.length; t++) {
      const table = tables[t];
      const panel = table.closest('.panel');
      const titleEl = panel ? panel.querySelector('.panel-title, h3') : null;
      const title = titleEl && titleEl.textContent ? titleEl.textContent : '';
      if (!title.includes('Daftar Kuliah') && !title.includes('Mata Kuliah')) continue;

      const rows = table.querySelectorAll('tbody tr');
      for (let r = 0; r < rows.length; r++) {
        const cells = rows[r].querySelectorAll('td');
        if (cells.length < 3) continue;

        const code = (cells[0] && cells[0].textContent && cells[0].textContent.trim()) || '';
        const name = (cells[1] && cells[1].textContent && cells[1].textContent.trim()) || '';
        const classNum = (cells[2] && cells[2].textContent && cells[2].textContent.trim()) || '';
        const creditsText = (cells[3] && cells[3].textContent && cells[3].textContent.trim()) || '0';
        const credits = parseInt(creditsText);
        const attendanceText = (cells[4] && cells[4].textContent && cells[4].textContent.trim()) || '';
        const attendance = parseFloat(attendanceText) || undefined;
        const gradeText = (cells[5] && cells[5].textContent && cells[5].textContent.trim()) || undefined;
        const grade = gradeText || undefined;

        // Validate course code pattern
        if (/^[A-Z]{2}\d{4}$/.test(code)) {
          courses.push({ code, name, classNumber: classNum, credits, attendance, grade });
        }
      }
    }

    return courses;
  });
}

export async function scrapeCourseSlots(page: Page): Promise<CourseSlot[]> {
  await page.waitForSelector('.list-group-item');

  return page.evaluate(() => {
    const slots: CourseSlot[] = [];
    const items = document.querySelectorAll('.list-group-item');

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const text = ((item as HTMLElement).innerText || item.textContent || '').replace(/\s+/g, ' ').trim();

      // Extract class number
      const classMatch = text.match(/^(\d{2})\b/);
      if (!classMatch) continue;

      // Extract quota and enrolled
      const kuotaMatch = text.match(/Kuota\s*(\d+)/i);
      const pendaftarMatch = text.match(/Pendaftar\s*(\d+)/i);

      const quota = kuotaMatch ? parseInt(kuotaMatch[1]) : 0;
      const enrolled = pendaftarMatch ? parseInt(pendaftarMatch[1]) : 0;

      // Extract schedule (time and day)
      const scheduleMatch = text.match(/(Senin|Selasa|Rabu|Kamis|Jumat)\s*(\d{2}:\d{2}\s*-\s*\d{2}:\d{2})/i);
      const schedule = scheduleMatch ? `${scheduleMatch[1]} ${scheduleMatch[2]}` : '';

      // Extract room
      const roomMatch = text.match(/Ruang\s*:?\s*([^\n]+)/i);
      const room = roomMatch ? roomMatch[1].trim() : '';

      // Extract lecturers
      const lecturers: string[] = [];
      const lecturerElements = item.querySelectorAll('small, .text-muted');
      for (let l = 0; l < lecturerElements.length; l++) {
        const txt = (lecturerElements[l].textContent && lecturerElements[l].textContent.trim()) || '';
        if (txt.includes(',') || txt.split(' ').length >= 2) {
          lecturers.push(txt);
        }
      }

      slots.push({
        classNumber: classMatch[1],
        quota,
        enrolled,
        available: enrolled < quota,
        lecturers,
        schedule,
        room,
      });
    }

    return slots;
  });
}

// ============================================
// Schedule Scraping
// ============================================

export async function scrapeSchedule(page: Page): Promise<ScheduleItem[]> {
  await page.waitForSelector('body');

  return page.evaluate(() => {
    const items: ScheduleItem[] = [];
    const links = document.querySelectorAll('a[href*="kelas"]');

    for (let i = 0; i < links.length; i++) {
      const text = (links[i].textContent && links[i].textContent.trim()) || '';

      // Match pattern: "07:00-09:00 II3220 Tata Kelola... (Kuliah 7601)"
      const timeMatch = text.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
      const codeMatch = text.match(/([A-Z]{2}\d{4})/);
      const typeMatch = text.match(/\((Kuliah|Praktikum)/i);

      if (!timeMatch || !codeMatch) continue;

      const nameMatch = text.match(/\d{4}\s+(.+?)\s*\(/);
      const name = nameMatch ? nameMatch[1].trim() : '';
      const type = (typeMatch && typeMatch[1] === 'Praktikum') ? 'Praktikum' : 'Kuliah';

      items.push({
        courseCode: codeMatch[1],
        courseName: name,
        type: type,
        time: timeMatch[1] + ' - ' + timeMatch[2],
        date: '', // Will be filled by caller
        lecturer: '',
        room: '',
      });
    }

    return items;
  });
}

export async function scrapeTodaySchedule(page: Page): Promise<ScheduleItem[]> {
  const today = new Date();
  const dateNum = today.getDate();

  await page.waitForSelector('body');

  return page.evaluate((targetDate) => {
    const items: any[] = [];
    const allCells = document.querySelectorAll('td');

    for (let c = 0; c < allCells.length; c++) {
      const cell = allCells[c];
      const cellText = (cell.textContent && cell.textContent.trim()) || '';

      // Check if this cell is for today
      const startsWithToday =
        cellText.startsWith(String(targetDate) + ' ') ||
        cellText.startsWith(String(targetDate) + '\n') ||
        new RegExp('^' + targetDate + '\\s').test(cellText);

      if (!startsWithToday) continue;

      // Find all course links in this cell
      const links = cell.querySelectorAll('a');
      for (let l = 0; l < links.length; l++) {
        const text = (links[l].textContent || '').replace(/\s+/g, ' ').trim();

        const timeMatch = text.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
        const codeMatch = text.match(/([A-Z]{2}\d{4})/);
        const typeMatch = text.match(/\((Kuliah|Praktikum)/i);

        if (!timeMatch || !codeMatch) continue;

        const nameMatch = text.match(/\d{4}\s+(.+?)\s*\(/);
        const name = nameMatch ? nameMatch[1].trim() : '';
        const type = (typeMatch && typeMatch[1] === 'Praktikum') ? 'Praktikum' : 'Kuliah';

        items.push({
          courseCode: codeMatch[1],
          courseName: name,
          type: type,
          time: timeMatch[1] + ' - ' + timeMatch[2],
          date: new Date().toLocaleDateString('id-ID'),
          lecturer: '',
          room: '',
        });
      }
    }

    return items;
  }, dateNum);
}

// ============================================
// Course Detail Scraping (Modal)
// ============================================

export async function scrapeCourseModal(page: Page): Promise<{
  courseCode: string;
  courseName: string;
  type: string;
  date: string;
  time: string;
  lecturer: string;
  topic?: string;
  notes?: string;
  edunexUrl?: string;
  teamsUrl?: string;
  canMarkPresence?: boolean;
  presenceWindow?: { start: string; end: string };
} | null> {
  await page.waitForSelector('.jconfirm-box, .jconfirm', { timeout: 5000 }).catch(() => null);

  return page.evaluate(() => {
    const modal = document.querySelector('.jconfirm-box, .jconfirm');
    if (!modal) return null;

    // Course name from title
    const titleEl = modal.querySelector('.jconfirm-title, h4');
    const courseName = (titleEl && titleEl.textContent && titleEl.textContent.trim()) || '';

    // Type and date/time from first dd.small
    const firstDd = modal.querySelector('dl dd.small, dd');
    const typeText = (firstDd && firstDd.textContent && firstDd.textContent.trim()) || '';

    const typeMatch = typeText.match(/^(Kuliah|Praktikum)/i);
    const dateMatch = typeText.match(/(\w+)\s*\/\s*(\d+\s+\w+\s+\d+)\s*\/\s*(\d{2}:\d{2}\s*-\s*\d{2}:\d{2})/);

    // Helper to find dt by text and get next sibling's text
    function getDtNextSiblingText(modalEl: Element, searchText: string): string {
      const dts = modalEl.querySelectorAll('dt');
      for (let i = 0; i < dts.length; i++) {
        if (dts[i].textContent && dts[i].textContent.includes(searchText)) {
          const next = dts[i].nextElementSibling;
          return (next && next.textContent && next.textContent.trim()) || '';
        }
      }
      return '';
    }

    const lecturer = getDtNextSiblingText(modal, 'Dosen');
    const topic = getDtNextSiblingText(modal, 'Topik');
    const notes = getDtNextSiblingText(modal, 'Catatan');

    // Links
    const edunexLink = modal.querySelector('a[href*="edunex"]');
    const teamsLink = modal.querySelector('a[href*="teams"]');

    // Presence info
    const presenceText = modal.textContent || '';
    const presenceMatch = presenceText.match(/Presensi mandiri dapat dilakukan pada\s*(\d+\s+\w+\s+\d+)\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/i);

    // Check if Tandai Hadir button exists
    const tandaiHadirBtn = modal.querySelector('#form_hadir, button[name="form[hadir]"]');
    const canMarkPresence = !!tandaiHadirBtn;

    // Extract course code from course name
    const codeMatch = courseName.match(/([A-Z]{2}\d{4})/);

    return {
      courseCode: (codeMatch && codeMatch[1]) || '',
      courseName: courseName,
      type: (typeMatch && typeMatch[1]) || 'Kuliah',
      date: (dateMatch && dateMatch[2]) || '',
      time: (dateMatch && dateMatch[3]) || '',
      lecturer: lecturer,
      topic: topic || undefined,
      notes: notes || undefined,
      edunexUrl: (edunexLink && edunexLink.getAttribute('href')) || undefined,
      teamsUrl: (teamsLink && teamsLink.getAttribute('href')) || undefined,
      canMarkPresence: canMarkPresence,
      presenceWindow: presenceMatch ? {
        start: presenceMatch[2],
        end: presenceMatch[3],
      } : undefined,
    };
  });
}

// ============================================
// Presence Operations
// ============================================

export async function checkPresenceAvailability(page: Page): Promise<PresenceStatus> {
  // Navigate to schedule page
  await page.waitForSelector('body');

  // Get today's schedule
  const todayCourses = await scrapeTodaySchedule(page);

  if (todayCourses.length === 0) {
    return { available: false, message: 'No classes scheduled for today' };
  }

  const now = new Date();
  const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

  // Check each course
  for (const course of todayCourses) {
    const [startH, startM] = course.time.split(' - ')[0].split(':').map(Number);
    const [endH, endM] = course.time.split(' - ')[1].split(':').map(Number);

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    // Buffer: 15 min before start, 30 min after end
    if (currentTimeMinutes >= startMinutes - 15 && currentTimeMinutes <= endMinutes + 30) {
      // Click on the course to open modal
      const courseLinks = await page.$$('a');
      for (const link of courseLinks) {
        const text = await link.textContent();
        if (text?.includes(course.courseCode)) {
          await link.click();
          await page.waitForTimeout(1000);

          const modalInfo = await scrapeCourseModal(page);
          if (modalInfo?.canMarkPresence) {
            return {
              available: true,
              course: `${course.courseCode} - ${course.courseName}`,
              timeWindow: modalInfo.presenceWindow,
              message: 'Presence can be marked now',
            };
          }
        }
      }
    }
  }

  return { available: false, message: 'No active presence window at this time' };
}

export async function markPresence(page: Page): Promise<PresenceResult> {
  try {
    // Look for Tandai Hadir button
    const button = await page.$('#form_hadir, button[name="form[hadir]"]');

    if (!button) {
      // Try by text
      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await btn.textContent();
        if (text?.includes('Tandai Hadir')) {
          await btn.click();
          await page.waitForTimeout(1500);
          return { success: true };
        }
      }

      return { success: false, error: 'Tandai Hadir button not found' };
    }

    // Get course info before clicking
    const modalInfo = await scrapeCourseModal(page);

    await button.click();
    await page.waitForTimeout(1500);

    return {
      success: true,
      course: modalInfo ? `${modalInfo.courseCode} - ${modalInfo.courseName}` : undefined,
      date: modalInfo?.date,
      time: new Date().toISOString(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================
// Financial Scraping
// ============================================

export async function scrapeFinancialStatus(page: Page): Promise<FinancialStatus> {
  await page.waitForSelector('table');

  const studentInfo = await scrapeProfile(page);
  const records = await page.evaluate(() => {
    const records: any[] = [];
    const tables = document.querySelectorAll('table');

    for (let t = 0; t < tables.length; t++) {
      const rows = tables[t].querySelectorAll('tr');
      let currentYear = '';

      for (let r = 0; r < rows.length; r++) {
        const cells = rows[r].querySelectorAll('td, th');

        // Check for year header
        if (cells.length === 1 && cells[0] && cells[0].textContent && cells[0].textContent.includes('Tahun')) {
          const yearMatch = cells[0].textContent.match(/Tahun\s*(\d+)\s*\/\s*(\d+)/);
          if (yearMatch) {
            currentYear = yearMatch[1] + '/' + yearMatch[2];
          }
        }

        // Parse payment row
        if (cells.length >= 4 && currentYear) {
          const semesterText = (cells[0] && cells[0].textContent && cells[0].textContent.trim()) || '';
          const invoiceText = (cells[1] && cells[1].textContent && cells[1].textContent.trim()) || '';
          const paidText = (cells[2] && cells[2].textContent && cells[2].textContent.trim()) || '';
          const deadlineText = (cells[3] && cells[3].textContent && cells[3].textContent.trim()) || '';

          if (semesterText.includes('Ganjil') || semesterText.includes('Genap') || semesterText.includes('Pendek')) {
            records.push({
              academicYear: currentYear,
              semester: semesterText.includes('Ganjil') ? 'Ganjil' :
                       semesterText.includes('Genap') ? 'Genap' : 'Pendek',
              invoiceAmount: parseFloat(invoiceText.replace(/[^\d]/g, '')) || 0,
              paidAmount: parseFloat(paidText.replace(/[^\d]/g, '')) || 0,
              deadline: deadlineText || undefined,
            });
          }
        }
      }
    }

    return records;
  });

  return {
    student: {
      nim: studentInfo.nim,
      name: studentInfo.name,
      faculty: studentInfo.faculty,
      studyProgram: studentInfo.studyProgram,
      class: studentInfo.class,
    },
    records,
  };
}

// ============================================
// Study Plan Scraping
// ============================================

export async function scrapeStudyPlan(page: Page): Promise<StudyPlan> {
  await page.waitForSelector('body');

  return page.evaluate(() => {
    // Get semester from heading
    const heading = document.querySelector('h1, .page-header h1');
    const headingText = heading && heading.textContent ? heading.textContent : '';
    const semesterMatch = headingText.match(/Semester\s*(\d+)\s*\((\w+)\)\s*-\s*(\d+\/\d+)/);

    // Get student info
    function getTextByLabel(label: string): string {
      const rows = document.querySelectorAll('table tr, .panel table tr');
      for (let i = 0; i < rows.length; i++) {
        const th = rows[i].querySelector('th');
        const td = rows[i].querySelector('td');
        if (th && td && th.textContent && th.textContent.trim() === label) {
          return td.textContent ? td.textContent.trim() : '';
        }
      }
      return '';
    }

    // Get status
    const bodyText = document.body.innerText;
    const status = {
      submittedAt: (bodyText.match(/Pengiriman Rencana Studi\s*(\d+\s+\w+\s+\d+[\s\d:.]*)/) || [])[1],
      advisorApprovedAt: (bodyText.match(/Persetujuan Dosen Wali\s*(\d+\s+\w+\s+\d+[\s\d:.]*)/) || [])[1],
      paymentAmount: undefined as number | undefined,
      validatedAt: (bodyText.match(/Pengesahan KSM\s*(\d+\s+\w+\s+\d+[\s\d:.]*)/) || [])[1],
      prsSubmittedAt: (bodyText.match(/Pengiriman Rencana Studi.*?PRS.*?(\d+\s+\w+\s+\d+[\s\d:.]*)/s) || [])[1],
      prsAdvisorApprovedAt: (bodyText.match(/Persetujuan Dosen Wali.*?PRS.*?(\d+\s+\w+\s+\d+[\s\d:.]*)/s) || [])[1],
      prsValidatedAt: (bodyText.match(/Pengesahan KSM Pengganti\s*(\d+\s+\w+\s+\d+[\s\d:.]*)/) || [])[1],
    };

    const paymentMatch = bodyText.match(/Pembayaran UKT\s*Rp\s*([\d.]+)/);
    status.paymentAmount = paymentMatch ? parseFloat(paymentMatch[1].replace(/\./g, '')) : undefined;

    // Get courses
    const courses: any[] = [];
    const courseTables = document.querySelectorAll('table');
    for (let t = 0; t < courseTables.length; t++) {
      const panel = courseTables[t].closest('.panel');
      const titleEl = panel ? panel.querySelector('h3, .panel-title') : null;
      const title = titleEl && titleEl.textContent ? titleEl.textContent : '';
      if (!title.includes('Daftar Mata Kuliah')) continue;

      const rows = courseTables[t].querySelectorAll('tbody tr');
      for (let r = 0; r < rows.length; r++) {
        const cells = rows[r].querySelectorAll('td');
        if (cells.length < 4) continue;

        const code = (cells[0] && cells[0].textContent && cells[0].textContent.trim()) || '';
        const name = (cells[1] && cells[1].textContent && cells[1].textContent.trim()) || '';
        const classNum = (cells[2] && cells[2].textContent && cells[2].textContent.trim()) || '';
        const creditsText = (cells[3] && cells[3].textContent && cells[3].textContent.trim()) || '0';
        const credits = parseInt(creditsText);
        const approvedText = cells[4] && cells[4].textContent ? cells[4].textContent : '';
        const approved = approvedText.includes('✓') || approvedText.includes('Ya');

        if (/^[A-Z]{2}\d{4}$/.test(code)) {
          courses.push({ code, name, classNumber: classNum, credits, approved });
        }
      }
    }

    const totalCredits = courses.reduce(function(sum, c) { return sum + c.credits; }, 0);
    const maxCreditsText = getTextByLabel('Maksimal Beban');
    const maxCredits = parseInt(maxCreditsText) || 24;

    const sksText = getTextByLabel('SKS');
    const ipsText = getTextByLabel('IPS');
    const sksMatch = sksText.match(/Lulus\s*(\d+)/);
    const ipsMatch = ipsText.match(/([\d.]+)/);

    return {
      semester: semesterMatch ? (semesterMatch[1] + '-' + semesterMatch[3]) : '',
      student: {
        nim: getTextByLabel('NIM'),
        name: getTextByLabel('Nama'),
        faculty: getTextByLabel('Fakultas'),
        studyProgram: getTextByLabel('Program Studi'),
        class: getTextByLabel('Kelas'),
        gpa: parseFloat(getTextByLabel('IPK')) || 0,
        creditsPassed: sksMatch ? parseInt(sksMatch[1]) : 0,
        lastSemesterGpa: ipsMatch ? parseFloat(ipsMatch[1]) : 0,
      },
      maxCredits: maxCredits,
      status: status,
      courses: courses,
      totalCredits: totalCredits,
    };
  });
}

// ============================================
// Navigation Helpers
// ============================================

export async function navigateToProfile(page: Page, nim: string): Promise<void> {
  await page.goto(`${SIX_BASE_URL}/app/mahasiswa:${nim}/statusmhs`, {
    waitUntil: 'networkidle',
  });
}

export async function navigateToSchedule(page: Page, nim: string, semester: string): Promise<void> {
  await page.goto(`${SIX_BASE_URL}/app/mahasiswa:${nim}+${semester}/kelas/jadwal/mahasiswa`, {
    waitUntil: 'networkidle',
  });
}

export async function navigateToFinancial(page: Page, nim: string): Promise<void> {
  await page.goto(`${SIX_BASE_URL}/app/mahasiswa:${nim}/keuangan`, {
    waitUntil: 'networkidle',
  });
}

export async function navigateToStudyPlan(page: Page, nim: string, semester: string, studentId: string): Promise<void> {
  await page.goto(`${SIX_BASE_URL}/app/mahasiswa:${nim}+${semester}/registrasi/rencanastudi/${studentId}`, {
    waitUntil: 'networkidle',
  });
}

export async function navigateToCourse(page: Page, courseUrl: string): Promise<void> {
  await page.goto(courseUrl, {
    waitUntil: 'networkidle',
  });
}

export async function checkSessionValid(page: Page): Promise<boolean> {
  const url = page.url();
  return !url.includes('login') && !url.includes('microsoftonline');
}

export async function waitForLogin(page: Page, timeout: number = 300000): Promise<boolean> {
  try {
    await page.waitForURL('**/six.itb.ac.id/**', { timeout });
    return true;
  } catch {
    return false;
  }
}