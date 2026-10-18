// Typed access to the versioned rules file (D14). If Mastersoft changes a table,
// only rules.v1.json changes, never the formulas.
import rulesJson from './rules/rules.v1.json';

export type SubjectType = 'LEC' | 'LAB' | 'COMPOSITE';
export type Term = 'PRELIM' | 'MIDTERM' | 'FINAL';
export type Status = 'INC' | 'ABS' | 'HNA' | 'DRP' | 'WP';

export interface Rules {
  version: string;
  transmutation: { pct: number; transmuted: number }[];
  unverifiedBelowPct: number;
  termPointGrades: { grade: number; point: number; verified: boolean }[];
  transcriptPointGrades: { grade: number; point: number }[];
  transcriptFailingPoint: number;
  passingGrade: number;
  weightBp: Record<SubjectType, { cs: number; we: number }>;
  finalRatingBp: Record<Term, number>;
  statusPriority: Status[];
  carryForwardStatuses: Status[];
}

export const rules = rulesJson as Rules;

/** Weights and splits are stored in basis points: 10000 = 100%. */
export const BP = 10000;
