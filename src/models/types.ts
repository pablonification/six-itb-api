/**
 * SIX API - Type Definitions
 */

// ============================================
// Profile Types
// ============================================
export interface StudentProfile {
  nim: string;
  name: string;
  faculty: string;
  studyProgram: string;
  studyProgramCode: string;
  class: string;
  entryYear: string;
  entrySemester: string;
  academicAdvisor: string;
  gpa: number;
  creditsPassed: number;
  creditsTotal: number;
  lastSemesterGpa: number;
  lastSemesterCredits: number;
  photoUrl?: string;
}

// ============================================
// Course Types
// ============================================
export interface Course {
  code: string;
  name: string;
  classNumber: string;
  credits: number;
  attendance?: number;
  grade?: string;
}

export interface CourseSlot {
  classNumber: string;
  quota: number;
  enrolled: number;
  available: boolean;
  lecturers: string[];
  schedule: string;
  room: string;
}

export interface CourseDetail {
  code: string;
  name: string;
  credits: number;
  semester: string;
  slots: CourseSlot[];
}

// ============================================
// Schedule Types
// ============================================
export interface ScheduleItem {
  courseCode: string;
  courseName: string;
  type: 'Kuliah' | 'Praktikum';
  time: string;
  date: string;
  lecturer: string;
  room: string;
  topic?: string;
  notes?: string;
  edunexUrl?: string;
  teamsUrl?: string;
  canMarkPresence?: boolean;
  presenceWindow?: {
    start: string;
    end: string;
  };
}

export interface DailySchedule {
  date: string;
  dayOfWeek: string;
  items: ScheduleItem[];
}

export interface MonthlySchedule {
  year: number;
  month: number;
  weeks: WeeklySchedule[];
}

export interface WeeklySchedule {
  weekNumber: number;
  days: DailySchedule[];
}

// ============================================
// Financial Types
// ============================================
export interface FinancialRecord {
  academicYear: string;
  semester: 'Ganjil' | 'Genap' | 'Pendek';
  invoiceAmount: number;
  paidAmount: number;
  deadline?: string;
  installments?: {
    amount: number;
    deadline: string;
  }[];
}

export interface FinancialStatus {
  student: Pick<StudentProfile, 'nim' | 'name' | 'faculty' | 'studyProgram' | 'class'>;
  records: FinancialRecord[];
}

// ============================================
// Study Plan Types
// ============================================
export interface StudyPlanCourse {
  code: string;
  name: string;
  classNumber: string;
  credits: number;
  approved: boolean;
}

export interface StudyPlan {
  semester: string;
  student: Pick<StudentProfile, 'nim' | 'name' | 'faculty' | 'studyProgram' | 'class' | 'gpa' | 'creditsPassed' | 'lastSemesterGpa'>;
  maxCredits: number;
  status: {
    submittedAt?: string;
    advisorApprovedAt?: string;
    paymentAmount?: number;
    validatedAt?: string;
    prsSubmittedAt?: string;
    prsAdvisorApprovedAt?: string;
    prsValidatedAt?: string;
  };
  courses: StudyPlanCourse[];
  totalCredits: number;
}

// ============================================
// Presence Types
// ============================================
export interface PresenceStatus {
  available: boolean;
  course?: string;
  timeWindow?: {
    start: string;
    end: string;
  };
  message: string;
}

export interface PresenceResult {
  success: boolean;
  course?: string;
  date?: string;
  time?: string;
  error?: string;
}

// ============================================
// Snipe Types
// ============================================
export type SnipeType = 'krs' | 'prs';

export interface SnipeConfig {
  type: SnipeType;
  courseUrl: string;
  classNumber: string;
  rencanaStudiUrl: string;
  maxChecks: number;
  intervalMs: number;
  dryRun: boolean;
}

export interface SnipeJob {
  id: string;
  userId: string;
  config: SnipeConfig;
  status: 'pending' | 'monitoring' | 'executing' | 'completed' | 'failed' | 'cancelled';
  checks: number;
  lastCheck?: {
    kuota: number;
    pendaftar: number;
    available: boolean;
    timestamp: string;
  };
  result?: {
    success: boolean;
    course?: string;
    error?: string;
  };
  startedAt: string;
  completedAt?: string;
}

// ============================================
// Session Types
// ============================================
export interface Session {
  id: string;
  userId: string;
  nim?: string;
  semester?: string;
  cookies: Cookie[];
  createdAt: string;
  lastAccessedAt: string;
  expiresAt: string;
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
}

// ============================================
// Auth Types
// ============================================
export interface LoginSession {
  id: string;
  loginUrl: string;
  status: 'pending' | 'completed' | 'expired';
  session?: Session;
  createdAt: string;
  expiresAt: string;
}

// ============================================
// API Response Types
// ============================================
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

// ============================================
// WebSocket Types
// ============================================
export interface WsMessage {
  type: 'snipe_update' | 'presence_marked' | 'session_expired' | 'error';
  payload: unknown;
  timestamp: string;
}

export interface WsSnipeUpdate {
  jobId: string;
  status: SnipeJob['status'];
  checks: number;
  lastCheck?: SnipeJob['lastCheck'];
  result?: SnipeJob['result'];
}