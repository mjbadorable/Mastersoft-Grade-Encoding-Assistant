// Class record data model (blueprint §6). Stored as-is in IndexedDB.
import type { ObeConfig, Status, SubjectType, Term } from '../engine';

export type CsMode = 'RAW_SUM' | 'WEIGHTED_CATEGORIES';
export type Component = 'CS' | 'WE';

export interface Category {
  id: string;
  name: string;
  weightPct: number;
}

export interface Column {
  id: string;
  label: string;
  maxScore: number;
  component: Component;
  /** Only used in WEIGHTED_CATEGORIES mode (D25). */
  categoryId?: string;
  /** OBE tags: course outcome and learning outcome ids from `ClassRecord.obe`. */
  coIds?: string[];
  loIds?: string[];
  /** Share of the column's points per CO id; missing means an equal split. */
  coWeights?: Record<string, number>;
}

export interface TermSetup {
  csMode: CsMode;
  categories: Category[];
  columns: Column[];
}

/** Reverse-mode target, kept as typed text until the engine validates it (D11, D28). */
export type ReverseInput =
  | { kind: 'transmuted'; grade: string }
  | { kind: 'point'; point: string; transmuted: string };

export interface Student {
  id: string;
  studentId: string;
  name: string;
  /** Score text by column id; '' = not entered yet. */
  scores: Record<string, string>;
  /** Status per term, as set by the teacher (carry-forward is applied by the engine). */
  statuses: Partial<Record<Term, Status>>;
  reverse?: ReverseInput;
  /** Set when the student came from a Mastersoft "Upload Grade Encoding" file (D34). */
  mastersoft?: MastersoftRow;
}

/**
 * One row of a Mastersoft upload file, with the text exactly as Mastersoft wrote it
 * (names keep their double and trailing spaces), so the export can write it back unchanged.
 */
export interface MastersoftRow {
  /** 0-based row order in the file; the export keeps this order. */
  order: number;
  studentId: string;
  studentName: string;
  subject: string;
  campus: string;
  section: string;
  semester: string;
}

export interface ClassRecord {
  id: string;
  subjectCode: string;
  subjectName: string;
  section: string;
  subjectType: SubjectType;
  terms: Record<Term, TermSetup>;
  students: Student[];
  /** Academic session as written in Mastersoft's file names, e.g. "1stSem,2024-2025" (D34). */
  mastersoftSession?: string;
  /** Syllabus outcomes for OBE attainment; unset until the teacher sets them up. */
  obe?: ObeConfig;
  /** The built-in sample class for exploring the app (see demoClass.ts). */
  demo?: boolean;
  /** Tucked away from the class list; still opens from the overview's Archived tab. */
  archived?: boolean;
  /** Epoch ms when moved to the trash; undefined while the class is active or archived. */
  deletedAt?: number;
  updatedAt: number;
}

export type View = Term | 'OVERVIEW' | 'SUMMARY' | 'OBE' | 'REVERSE' | 'TABLE';
