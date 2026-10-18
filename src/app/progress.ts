// How far a term is along the encoding workflow, for the step guide, the grid's
// status bar and the sidebar. Counts only; grades still come from the engine.
import type { Term } from '../engine';
import { csColumns, duplicateStudentIds, parseScore, sameIdAs, termOutcome, termSetupIssues, weColumns } from './gradebook';
import type { ClassRecord } from './types';

export interface ProblemCell {
  /** Index in record.students (the grid's row). */
  row: number;
  /** Index in the grid's score columns (CS columns, then WE columns); -2 is the Student ID cell. */
  column: number;
  kind: 'blank' | 'invalid' | 'duplicate';
}

export interface TermProgress {
  students: number;
  csColumns: number;
  weColumns: number;
  setupIssues: string[];
  /** Students with a computed grade. */
  ready: number;
  /** Their rows, for the status bar's "graded" button. */
  readyRows: number[];
  /** Students with a status (INC, DRP, …) instead of a grade. */
  withStatus: number;
  /** Their rows, for the status bar's "with status" button. */
  statusRows: number[];
  /** Students with blank scores. */
  missing: number;
  /** Students with invalid scores. */
  invalid: number;
  /** Every blank or invalid score cell and duplicate Student ID, in grid order. */
  problems: ProblemCell[];
  /** Students whose Student ID is also used by another student. */
  duplicateIds: number;
  /** Students, columns and every score are in, with nothing to fix. */
  complete: boolean;
}

export function termProgress(record: ClassRecord, term: Term): TermProgress {
  const p = scoreProgress(record, term);
  // Duplicate Student IDs are problems too; keep everything in grid order.
  const duplicates = duplicateStudentIds(record.students);
  record.students.forEach((s, row) => {
    if (sameIdAs(duplicates, s).length > 0) p.problems.push({ row, column: -2, kind: 'duplicate' });
  });
  p.problems.sort((a, b) => a.row - b.row || a.column - b.column);
  return p;
}

function scoreProgress(record: ClassRecord, term: Term): TermProgress {
  const setup = record.terms[term];
  const columns = [...csColumns(setup), ...weColumns(setup)];
  const setupIssues = termSetupIssues(setup);
  const p: TermProgress = {
    students: record.students.length,
    csColumns: csColumns(setup).length,
    weColumns: weColumns(setup).length,
    setupIssues,
    ready: 0,
    readyRows: [],
    withStatus: 0,
    statusRows: [],
    missing: 0,
    invalid: 0,
    problems: [],
    duplicateIds: [...duplicateStudentIds(record.students).values()].reduce((n, list) => n + list.length, 0),
    complete: false,
  };
  if (setupIssues.length > 0) return p;

  record.students.forEach((s, row) => {
    const o = termOutcome(record, s, term);
    if (o.kind === 'ok') {
      p.ready++;
      p.readyRows.push(row);
    } else if (o.kind === 'status') {
      p.withStatus++;
      p.statusRows.push(row);
    }
    if (o.kind !== 'incomplete' && o.kind !== 'invalid') return;
    if (o.kind === 'incomplete') p.missing++;
    else p.invalid++;
    columns.forEach((c, column) => {
      const parsed = parseScore(s.scores[c.id], c.maxScore);
      if (parsed.kind === 'empty') p.problems.push({ row, column, kind: 'blank' });
      else if (parsed.kind === 'invalid') p.problems.push({ row, column, kind: 'invalid' });
    });
  });
  p.complete = p.students > 0 && p.missing === 0 && p.invalid === 0 && p.duplicateIds === 0;
  return p;
}

/** The next cell after (row, column) in grid order, wrapping around to the first. */
export function nextProblem<T extends { row: number; column: number }>(problems: T[], after?: { row: number; column: number }): T | undefined {
  if (!after) return problems[0];
  return problems.find((p) => p.row > after.row || (p.row === after.row && p.column > after.column)) ?? problems[0];
}
