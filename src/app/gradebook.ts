// Turns a class record into engine inputs and returns the engine's results.
// The only work done here is validation and plumbing: every grade, mark and rounding
// step comes from src/engine (blueprint §3: the UI never calculates anything itself).
import {
  computeTerm,
  finalRating,
  finalRatingStatus,
  GradeInputError,
  minFinalNeeded,
  roundHalfUp,
  solveReverse,
  sumMarks,
  TERMS,
  weightedCategoriesMark,
  withCarryForward,
  type FinalRatingResult,
  type MinFinalNeeded,
  type ReverseResult,
  type ReverseTarget,
  type Status,
  type Term,
  type TermResult,
} from '../engine';
import type { ClassRecord, Column, ReverseInput, Student, TermSetup } from './types';

export type ParsedScore = { kind: 'empty' } | { kind: 'invalid'; message: string } | { kind: 'ok'; value: number };

export function parseScore(text: string | undefined, max: number): ParsedScore {
  const t = (text ?? '').trim();
  if (t === '') return { kind: 'empty' };
  const value = Number(t);
  if (!Number.isFinite(value)) return { kind: 'invalid', message: `"${t}" is not a number` };
  if (value < 0) return { kind: 'invalid', message: 'Score cannot be negative' };
  if (value > max) return { kind: 'invalid', message: `Score is above the maximum of ${max}` };
  return { kind: 'ok', value };
}

export const csColumns = (setup: TermSetup) => setup.columns.filter((c) => c.component === 'CS');
export const weColumns = (setup: TermSetup) => setup.columns.filter((c) => c.component === 'WE');

/** Problems with a term's column setup that block every student's grade. */
export function termSetupIssues(setup: TermSetup): string[] {
  const issues: string[] = [];
  const cs = csColumns(setup);
  if (cs.length === 0) issues.push('Add at least one Class Standing column.');
  if (weColumns(setup).length === 0) issues.push('Add at least one Written Exam column.');
  if (setup.csMode === 'WEIGHTED_CATEGORIES') {
    if (setup.categories.length === 0) issues.push('Add the Class Standing categories and their weights.');
    const weightSum = sumMarks(setup.categories.map((c) => c.weightPct));
    if (setup.categories.length > 0 && weightSum !== 100) {
      issues.push(`Category weights add up to ${weightSum}%, not 100%.`);
    }
    const ids = new Set(setup.categories.map((c) => c.id));
    const unassigned = cs.filter((c) => !c.categoryId || !ids.has(c.categoryId));
    if (unassigned.length > 0) issues.push(`Assign a category to: ${unassigned.map((c) => c.label).join(', ')}.`);
    const empty = setup.categories.filter((cat) => !cs.some((c) => c.categoryId === cat.id));
    if (empty.length > 0) issues.push(`Category without columns: ${empty.map((c) => c.name).join(', ')}.`);
  }
  return issues;
}

/** Total Marks to enter in Mastersoft's Assessment Component screen. */
export function assessmentTotals(setup: TermSetup): { cs: number | null; we: number | null } {
  const cs = csColumns(setup);
  const we = weColumns(setup);
  return {
    cs: cs.length === 0 ? null : setup.csMode === 'WEIGHTED_CATEGORIES' ? 100 : sumMarks(cs.map((c) => c.maxScore)),
    we: we.length === 0 ? null : sumMarks(we.map((c) => c.maxScore)),
  };
}

export interface CategoryDetail {
  name: string;
  weightPct: number;
  raw: number;
  total: number;
}

export type TermOutcome =
  | { kind: 'status'; status: Status; carried: boolean }
  | { kind: 'setup' }
  | { kind: 'incomplete'; missing: number }
  | { kind: 'invalid'; messages: string[] }
  | {
      kind: 'ok';
      result: TermResult;
      /** Weighted-categories mode: the category sums behind the CS mark. */
      categories?: CategoryDetail[];
      /** Weighted-categories mode: the grade the plain raw sum would give (D5). */
      rawSumResult?: TermResult;
      /** Decimal marks whose rounding to whole numbers changes the term grade (D6). */
      decimalWarning?: { roundedGrade: number };
    };

function scoresOf(student: Student, columns: Column[]) {
  const values: number[] = [];
  const messages: string[] = [];
  let missing = 0;
  for (const c of columns) {
    const p = parseScore(student.scores[c.id], c.maxScore);
    if (p.kind === 'empty') missing++;
    else if (p.kind === 'invalid') messages.push(`${c.label}: ${p.message}`);
    else values.push(p.value);
  }
  return { values, messages, missing };
}

export function termOutcome(record: ClassRecord, student: Student, term: Term): TermOutcome {
  const statuses = withCarryForward(student.statuses);
  const status = statuses[term];
  if (status) return { kind: 'status', status, carried: student.statuses[term] !== status };

  const setup = record.terms[term];
  if (termSetupIssues(setup).length > 0) return { kind: 'setup' };

  const cs = csColumns(setup);
  const we = weColumns(setup);
  const csScores = scoresOf(student, cs);
  const weScores = scoresOf(student, we);
  const messages = [...csScores.messages, ...weScores.messages];
  if (messages.length > 0) return { kind: 'invalid', messages };
  const missing = csScores.missing + weScores.missing;
  if (missing > 0) return { kind: 'incomplete', missing };

  const totals = assessmentTotals(setup);
  const weInput = { raw: sumMarks(weScores.values), total: totals.we! };
  const rawCs = { raw: sumMarks(csScores.values), total: sumMarks(cs.map((c) => c.maxScore)) };

  try {
    if (setup.csMode === 'WEIGHTED_CATEGORIES') {
      const categories: CategoryDetail[] = setup.categories.map((cat) => {
        const cols = cs.filter((c) => c.categoryId === cat.id);
        return {
          name: cat.name,
          weightPct: cat.weightPct,
          raw: sumMarks(cols.map((c) => Number(student.scores[c.id]))),
          total: sumMarks(cols.map((c) => c.maxScore)),
        };
      });
      const { mark, total } = weightedCategoriesMark(categories);
      const result = computeTerm({ subjectType: record.subjectType, cs: { raw: mark, total }, we: weInput });
      const rawSumResult = computeTerm({ subjectType: record.subjectType, cs: rawCs, we: weInput });
      return { kind: 'ok', result, categories, rawSumResult, decimalWarning: decimalWarning(record, result) };
    }
    const result = computeTerm({ subjectType: record.subjectType, cs: rawCs, we: weInput });
    return { kind: 'ok', result, decimalWarning: decimalWarning(record, result) };
  } catch (e) {
    if (e instanceof GradeInputError) return { kind: 'invalid', messages: [e.message] };
    throw e;
  }
}

/** D6: if a mark has decimals, check whether encoding it as a whole number changes the grade. */
function decimalWarning(record: ClassRecord, result: TermResult) {
  const { cs, we } = result;
  if (Number.isInteger(cs.raw) && Number.isInteger(we.raw)) return undefined;
  const rounded = computeTerm({
    subjectType: record.subjectType,
    cs: { raw: roundHalfUp(cs.raw), total: cs.total },
    we: { raw: roundHalfUp(we.raw), total: we.total },
  });
  return rounded.termGrade === result.termGrade ? undefined : { roundedGrade: rounded.termGrade };
}

export type FinalOutcome =
  | { kind: 'status'; status: Status }
  | { kind: 'rating'; rating: FinalRatingResult }
  | { kind: 'minFinal'; needed: MinFinalNeeded }
  | { kind: 'pending' };

export function finalOutcome(record: ClassRecord, student: Student): FinalOutcome {
  const status = finalRatingStatus(student.statuses);
  if (status) return { kind: 'status', status };
  const [p, m, f] = TERMS.map((t) => termOutcome(record, student, t));
  const grade = (o: TermOutcome | undefined) => (o?.kind === 'ok' ? o.result.termGrade : undefined);
  const [pg, mg, fg] = [grade(p), grade(m), grade(f)];
  if (pg !== undefined && mg !== undefined && fg !== undefined) return { kind: 'rating', rating: finalRating(pg, mg, fg) };
  if (pg !== undefined && mg !== undefined) return { kind: 'minFinal', needed: minFinalNeeded(pg, mg) };
  return { kind: 'pending' };
}

export type ReverseOutcome =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ok'; solved: ReverseResult; check: TermResult; rating: FinalRatingResult };

function toTarget(input: ReverseInput): ReverseTarget | null {
  if (input.kind === 'transmuted') {
    return input.grade.trim() === '' ? null : { kind: 'transmuted', grade: Number(input.grade) };
  }
  if (input.point === '') return null;
  const t = input.transmuted.trim();
  return { kind: 'point', point: Number(input.point), transmuted: t === '' ? undefined : Number(t) };
}

/** Reverse mode: solve the marks, then run them forward to show they give the target. */
export function reverseOutcome(record: ClassRecord, student: Student): ReverseOutcome {
  const target = student.reverse && toTarget(student.reverse);
  if (!target) return { kind: 'empty' };
  try {
    const solved = solveReverse(target);
    const input = { raw: solved.mark, total: solved.total };
    const check = computeTerm({ subjectType: record.subjectType, cs: input, we: input });
    const rating = finalRating(check.termGrade, check.termGrade, check.termGrade);
    return { kind: 'ok', solved, check, rating };
  } catch (e) {
    if (e instanceof GradeInputError) return { kind: 'invalid', message: e.message };
    throw e;
  }
}

export const formatPoint = (p: number) => p.toFixed(1);

/** Student ID as compared for duplicates: spaces and letter case ignored. */
const idKey = (studentId: string) => studentId.replace(/\s+/g, '').toUpperCase();

/**
 * Student IDs used by more than one student in the class (REQ-12, TC-020), mapped to
 * those students in class order. Blank IDs are not counted.
 */
export function duplicateStudentIds(students: Student[]): Map<string, Student[]> {
  const byId = new Map<string, Student[]>();
  for (const s of students) {
    const key = idKey(s.studentId);
    if (key) byId.set(key, [...(byId.get(key) ?? []), s]);
  }
  return new Map([...byId].filter(([, list]) => list.length > 1));
}

/** The other students sharing this student's ID, or [] when it is unique. */
export function sameIdAs(duplicates: Map<string, Student[]>, student: Student): Student[] {
  return (duplicates.get(idKey(student.studentId)) ?? []).filter((s) => s !== student);
}
