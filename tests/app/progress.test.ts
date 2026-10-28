// Workflow progress per term (made-up students).
import { describe, expect, it } from 'vitest';
import { backupFingerprint } from '../../src/app/backup';
import { classOverview, nextProblem, termProgress } from '../../src/app/progress';
import type { ClassRecord, Student, TermSetup } from '../../src/app/types';

const setup: TermSetup = {
  csMode: 'RAW_SUM',
  categories: [],
  columns: [
    { id: 'q', label: 'Quiz', maxScore: 20, component: 'CS' },
    { id: 'e', label: 'Exam', maxScore: 60, component: 'WE' },
  ],
};
const empty: TermSetup = { csMode: 'RAW_SUM', categories: [], columns: [] };
const s = (id: string, scores: Record<string, string>, statuses: Student['statuses'] = {}): Student => ({ id, studentId: id, name: id, scores, statuses });
const record = (students: Student[], prelim = setup): ClassRecord => ({
  id: 'c',
  subjectCode: 'X',
  subjectName: '',
  section: '',
  subjectType: 'LEC',
  terms: { PRELIM: prelim, MIDTERM: empty, FINAL: empty },
  students,
  updatedAt: 0,
});

describe('termProgress', () => {
  it('counts ready, status, missing and invalid students and lists problem cells in grid order', () => {
    const p = termProgress(
      record([s('a', { q: '18', e: '50' }), s('b', { q: '' , e: '40' }), s('c', { q: '25', e: '' }), s('d', {}, { PRELIM: 'DRP' })]),
      'PRELIM',
    );
    expect(p).toMatchObject({ students: 4, csColumns: 1, weColumns: 1, ready: 1, withStatus: 1, missing: 1, invalid: 1, complete: false });
    expect(p.problems).toEqual([
      { row: 1, column: 0, kind: 'blank' },
      { row: 2, column: 0, kind: 'invalid' },
      { row: 2, column: 1, kind: 'blank' },
    ]);
  });

  it('is complete when every student has a grade or a status', () => {
    expect(termProgress(record([s('a', { q: '18', e: '50' }), s('d', {}, { PRELIM: 'INC' })]), 'PRELIM').complete).toBe(true);
    expect(termProgress(record([]), 'PRELIM').complete).toBe(false);
  });

  it('reports setup issues before any score problems', () => {
    const p = termProgress(record([s('a', {})], empty), 'PRELIM');
    expect(p.setupIssues).toHaveLength(2);
    expect(p.problems).toEqual([]);
    expect(p.complete).toBe(false);
  });
});

describe('nextProblem', () => {
  const problems = [
    { row: 1, column: 0, kind: 'blank' as const },
    { row: 2, column: 1, kind: 'invalid' as const },
  ];
  it('moves forward through the grid and wraps around', () => {
    expect(nextProblem(problems)).toEqual(problems[0]);
    expect(nextProblem(problems, { row: 1, column: 0 })).toEqual(problems[1]);
    expect(nextProblem(problems, { row: 2, column: 1 })).toEqual(problems[0]);
    expect(nextProblem([], { row: 0, column: 0 })).toBeUndefined();
  });
});

describe('classOverview', () => {
  const done = [s('a', { q: '18', e: '50' }), s('b', { q: '15', e: '40' })];

  it('reports students, each term and the duplicate count', () => {
    const r = record([...done, { ...s('c', {}), studentId: 'X1' }, { ...s('d', {}), studentId: 'x1' }]);
    const o = classOverview(r);
    expect(o.students).toBe(4);
    expect(o.duplicateIds).toBe(2);
    expect(o.terms.PRELIM).toEqual(termProgress(r, 'PRELIM'));
    expect(o.terms.MIDTERM.setupIssues.length).toBeGreaterThan(0);
  });

  it('needs a backup until the class matches its last backup', () => {
    const r = record(done);
    expect(classOverview(r).needsBackup).toBe(true);
    expect(classOverview(r, 'stale').needsBackup).toBe(true);
    expect(classOverview(r, backupFingerprint(r)).needsBackup).toBe(false);
    const edited = { ...r, students: [...r.students, s('c', {})] };
    expect(classOverview(edited, backupFingerprint(r)).needsBackup).toBe(true);
  });

  it('does not ask for a backup of a class with no students', () => {
    expect(classOverview(record([])).needsBackup).toBe(false);
  });

  it('does not count a change of updatedAt as a change to back up', () => {
    const r = record(done);
    expect(classOverview({ ...r, updatedAt: 99 }, backupFingerprint(r)).needsBackup).toBe(false);
  });
});
