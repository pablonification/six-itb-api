/**
 * SIX CLI - Command-line interface for SIX API
 */

import { createInterface } from 'readline';
import { spawn } from 'child_process';
import { chromium } from 'playwright';
import { z } from 'zod';

const API_URL = process.env.SIX_API_URL || 'http://localhost:3000';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log();
  log(`════════════════════════════════════════════════════════`, 'cyan');
  log(`  ${title}`, 'bright');
  log(`════════════════════════════════════════════════════════`, 'cyan');
  console.log();
}

// API client
async function apiCall(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `${API_URL}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error((data as any).error?.message || 'API request failed');
  }

  return data;
}

// Browser-based login
async function browserLogin(userId: string): Promise<{ sessionId: string; nim?: string }> {
  log('\nOpening browser for login...', 'yellow');
  log('Please complete the login process in the browser window.\n', 'dim');

  const result = await apiCall('POST', '/auth/browser', { userId }) as any;

  if (result.success) {
    log('✓ Login successful!', 'green');
    log(`  Session ID: ${result.data.sessionId}`, 'dim');
    if (result.data.nim) {
      log(`  NIM: ${result.data.nim}`, 'dim');
    }
    return result.data;
  }

  throw new Error('Login failed');
}

// Check login status
async function checkLoginStatus(loginId: string): Promise<{ completed: boolean; sessionId?: string }> {
  const result = await apiCall('POST', '/auth/callback', { loginId }) as any;

  if (result.data?.status === 'completed') {
    return { completed: true, sessionId: result.data.sessionId };
  }

  return { completed: false };
}

// Poll for login completion
async function pollForLogin(loginId: string, loginUrl: string): Promise<{ sessionId: string }> {
  log('\nWaiting for login...', 'yellow');
  log(`Login URL: ${loginUrl}\n`, 'cyan');

  // Try to open browser
  const openCommand = process.platform === 'darwin' ? 'open' :
                      process.platform === 'win32' ? 'start' : 'xdg-open';

  try {
    spawn(openCommand, [loginUrl], { detached: true });
    log('Browser opened. Please complete login.', 'dim');
  } catch {
    log('Please open the URL above in your browser.', 'yellow');
  }

  // Poll for completion
  const maxAttempts = 60; // 5 minutes with 5s interval
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000));

    const status = await checkLoginStatus(loginId);
    if (status.completed && status.sessionId) {
      log('\n✓ Login completed!', 'green');
      return { sessionId: status.sessionId };
    }

    process.stdout.write('.');
  }

  throw new Error('Login timed out');
}

// Get profile
async function getProfile(sessionId: string) {
  const result = await apiCall('GET', `/data/profile?sessionId=${sessionId}`) as any;
  return result.data;
}

// Set NIM manually
async function setNim(sessionId: string, nim: string) {
  const result = await apiCall('PATCH', '/data/session/nim', { sessionId, nim }) as any;
  return result.data;
}

// Get schedule
async function getSchedule(sessionId: string, semester?: string) {
  const url = semester
    ? `/data/schedule?sessionId=${sessionId}&semester=${semester}`
    : `/data/schedule?sessionId=${sessionId}`;
  const result = await apiCall('GET', url) as any;
  return result.data;
}

// Get today's classes
async function getTodayClasses(sessionId: string, semester?: string) {
  const url = semester
    ? `/presence/today?sessionId=${sessionId}&semester=${semester}`
    : `/presence/today?sessionId=${sessionId}`;
  const result = await apiCall('GET', url) as any;
  return result.data;
}

// Mark presence
async function markPresence(sessionId: string, semester?: string) {
  const result = await apiCall('POST', '/presence/mark', { sessionId, semester }) as any;
  return result.data;
}

// Start snipe job
async function startSnipeJob(config: {
  userId: string;
  type: 'krs' | 'prs';
  courseUrl: string;
  classNumber: string;
  rencanaStudiUrl: string;
  dryRun?: boolean;
}) {
  const result = await apiCall('POST', '/snipe/start', config) as any;
  return result.data;
}

// Get snipe status
async function getSnipeStatus(jobId: string) {
  const result = await apiCall('GET', `/snipe/status/${jobId}`) as any;
  return result.data;
}

// Interactive CLI
async function interactive() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise(resolve => rl.question(prompt, resolve));
  };

  let sessionId: string | null = null;
  let userId: string = 'default';

  logSection('SIX ITB CLI');

  while (true) {
    console.log();
    log('Commands:', 'bright');
    log('  1. Login (browser)');
    log('  2. Profile (auto-discovers NIM)');
    log('  3. Schedule');
    log('  4. Today\'s classes');
    log('  5. Mark presence');
    log('  6. Check course slots');
    log('  7. Start snipe job');
    log('  8. Check snipe status');
    log('  9. Set semester');
    log('  10. Set NIM manually');
    log('  0. Exit');

    const choice = await question('\n> ');

    try {
      switch (choice.trim()) {
        case '1':
          const loginResult = await browserLogin(userId);
          sessionId = loginResult.sessionId;
          break;

        case '2':
          if (!sessionId) {
            log('Please login first (option 1)', 'red');
            break;
          }
          const profile = await getProfile(sessionId);
          logSection('Profile');
          console.log(JSON.stringify(profile, null, 2));
          break;

        case '3':
          if (!sessionId) {
            log('Please login first', 'red');
            break;
          }
          const semester = await question('Semester (e.g., 2024-1, leave empty for current): ');
          const schedule = await getSchedule(sessionId, semester || undefined);
          logSection('Schedule');
          console.log(JSON.stringify(schedule, null, 2));
          break;

        case '4':
          if (!sessionId) {
            log('Please login first', 'red');
            break;
          }
          const today = await getTodayClasses(sessionId);
          logSection('Today\'s Classes');
          console.log(JSON.stringify(today, null, 2));
          break;

        case '5':
          if (!sessionId) {
            log('Please login first', 'red');
            break;
          }
          log('Marking presence...', 'yellow');
          const presenceResult = await markPresence(sessionId);
          if (presenceResult.success) {
            log(`✓ Presence marked for ${presenceResult.course}`, 'green');
          } else {
            log(`✗ ${presenceResult.error}`, 'red');
          }
          break;

        case '6':
          if (!sessionId) {
            log('Please login first', 'red');
            break;
          }
          const courseUrl = await question('Course URL: ');
          const slots = await apiCall('POST', '/snipe/check', {
            sessionId,
            courseUrl,
          }) as any;
          logSection('Course Slots');
          console.log(JSON.stringify(slots.data, null, 2));
          break;

        case '7':
          if (!sessionId) {
            log('Please login first', 'red');
            break;
          }
          logSection('Start Snipe Job');
          const snipeType = await question('Type (krs/prs): ') as 'krs' | 'prs';
          const snipeCourseUrl = await question('Course URL: ');
          const snipeClassNum = await question('Class number: ');
          const snipeRencanaUrl = await question('Rencana Studi URL: ');
          const snipeDryRun = await question('Dry run? (y/n): ');

          const job = await startSnipeJob({
            userId,
            type: snipeType,
            courseUrl: snipeCourseUrl,
            classNumber: snipeClassNum,
            rencanaStudiUrl: snipeRencanaUrl,
            dryRun: snipeDryRun.toLowerCase() === 'y',
          });

          log(`\n✓ Job started: ${job.jobId}`, 'green');
          break;

        case '8':
          const jobId = await question('Job ID: ');
          const status = await getSnipeStatus(jobId);
          logSection('Snipe Status');
          console.log(JSON.stringify(status, null, 2));
          break;

        case '9':
          if (!sessionId) {
            log('Please login first', 'red');
            break;
          }
          const newSemester = await question('Semester (e.g., 2024-1): ');
          await apiCall('PATCH', '/data/session/semester', {
            sessionId,
            semester: newSemester,
          });
          log(`✓ Semester set to ${newSemester}`, 'green');
          break;

        case '10':
          if (!sessionId) {
            log('Please login first', 'red');
            break;
          }
          const newNim = await question('Enter your NIM: ');
          await setNim(sessionId, newNim);
          log(`✓ NIM set to ${newNim}`, 'green');
          break;

        case '0':
        case 'q':
        case 'quit':
        case 'exit':
          log('\nGoodbye!', 'green');
          rl.close();
          process.exit(0);

        default:
          log('Invalid option', 'red');
      }
    } catch (error) {
      log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'red');
    }
  }
}

// CLI entry point
const args = process.argv.slice(2);

if (args.length === 0) {
  interactive();
} else {
  const command = args[0];

  switch (command) {
    case 'login':
      browserLogin('default').then(r => {
        console.log(JSON.stringify(r, null, 2));
        process.exit(0);
      }).catch(e => {
        console.error(e.message);
        process.exit(1);
      });
      break;

    case 'profile':
      if (!args[1]) {
        console.error('Usage: six profile <sessionId>');
        process.exit(1);
      }
      getProfile(args[1]).then(p => {
        console.log(JSON.stringify(p, null, 2));
        process.exit(0);
      }).catch(e => {
        console.error(e.message);
        process.exit(1);
      });
      break;

    case 'schedule':
      if (!args[1]) {
        console.error('Usage: six schedule <sessionId> [semester]');
        process.exit(1);
      }
      getSchedule(args[1], args[2]).then(s => {
        console.log(JSON.stringify(s, null, 2));
        process.exit(0);
      }).catch(e => {
        console.error(e.message);
        process.exit(1);
      });
      break;

    case 'presence':
      if (!args[1]) {
        console.error('Usage: six presence <sessionId>');
        process.exit(1);
      }
      markPresence(args[1]).then(r => {
        console.log(JSON.stringify(r, null, 2));
        process.exit(0);
      }).catch(e => {
        console.error(e.message);
        process.exit(1);
      });
      break;

    case 'help':
    default:
      console.log(`
SIX CLI - Command line interface for SIX ITB API

Usage:
  six                  Interactive mode
  six login            Login via browser
  six profile <sessionId>             Get profile
  six schedule <sessionId> [semester] Get schedule
  six presence <sessionId>            Mark presence
  six help             Show this help

Environment Variables:
  SIX_API_URL          API URL (default: http://localhost:3000)
`);
      process.exit(0);
  }
}