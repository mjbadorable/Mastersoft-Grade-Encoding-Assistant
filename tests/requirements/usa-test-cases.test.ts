// Test cases from "Grade Encoding System - Requirements and Test Cases" (USA, 2026),
// for the ones that apply to this companion app. Students are made up.
// Cases that fail or don't apply are recorded in docs/04_requirements_test_report.md.
import { describe, expect, it } from 'vitest';
import { buildGuide, guideCells } from '../../src/app/encodingGuide';
import { duplicateStudentIds, finalOutcome, formatPoint, parseScore, termOutcome, termSetupIssues } from '../../src/app/gradebook';
import { classOverview, termProgress } from '../../src/app/progress';
import { mergeMastersoftRows, planExport } from '../../src/app/mastersoftFile';
import type { ClassRecord, MastersoftRow, Student, TermSetup } from '../../src/app/types';
import { computeTerm, finalRating, pointGrade, rules, scale, solveReverse, transmute, type Term } from '../../src/engine';

const termSetup = (p: string, max = 100): TermSetup => ({
  csMode: 'RAW_SUM',
  categories: [],
  columns: [
    { id: `${p}cs`, label: 'Class Standing', maxScore: max, component: 'CS' },
    { id: `${p}we`, label: 'Exam', maxScore: max === 100 ? 100 : 60, component: 'WE' },
  ],
});

const record = (students: Student[], terms?: Partial<ClassRecord['terms']>): ClassRecord => ({
  id: 'c',
  subjectCode: 'TEST 1',
  subjectName: 'Test Subject',
  section: 'A',
  subjectType: 'LEC',
  terms: { PRELIM: termSetup('p'), MIDTERM: termSetup('m'), FINAL: termSetup('f'), ...terms },
  students,
  updatedAt: 0,
});

/** A student whose term grades are exactly the given transmuted grades (marks from the reverse solver). */
const studentWithTermGrades = (id: string, grades: Record<Term, number>): Student => {
  const scores: Record<string, string> = {};
  for (const [t, p] of [['PRELIM', 'p'], ['MIDTERM', 'm'], ['FINAL', 'f']] as const) {
    const { mark } = solveReverse({ kind: 'transmuted', grade: grades[t] });
    scores[`${p}cs`] = String(mark);
    scores[`${p}we`] = String(mark);
  }
  return { id, studentId: id, name: id, scores, statuses: {} };
};

const msRow = (order: number, id: string): MastersoftRow => ({ order, studentId: id, studentName: id, subject: 'Test (lec)', campus: 'USA', section: 'A', semester: 'Y1S1' });

describe('REQ-01 / REQ-22: one computation for every screen and report', () => {
  it('TC-001: the same FR everywhere (PG 85, MG 88, FG 90)', () => {
    const s = studentWithTermGrades('A', { PRELIM: 85, MIDTERM: 88, FINAL: 90 });
    const r = record([s]);
    const grades = (['PRELIM', 'MIDTERM', 'FINAL'] as const).map((t) => {
      const o = termOutcome(r, s, t);
      return o.kind === 'ok' ? o.result.termGrade : NaN;
    });
    expect(grades).toEqual([85, 88, 90]);
    // The Final Rating summary and the breakdown drawer both show finalOutcome.
    expect(finalOutcome(r, s)).toEqual({ kind: 'rating', rating: finalRating(85, 88, 90) });
    expect(finalRating(85, 88, 90)).toEqual({ raw: 88.4, grade: 88, point: { point: 2.0, verified: true } });
  });

  it('TC-002: FR matches the documented formula (PG 80, MG 84, FG 86)', () => {
    // 0.2·80 + 0.3·84 + 0.5·86 = 84.2 → 84 → 2.3
    expect(finalRating(80, 84, 86)).toEqual({ raw: 84.2, grade: 84, point: { point: 2.3, verified: true } });
  });

  it('TC-034: the Encoding Guide shows the same values as the grid', () => {
    const students = [70, 75, 82, 91, 100].map((g, i) => studentWithTermGrades(`S${i}`, { PRELIM: g, MIDTERM: g, FINAL: g }));
    const r = record(students);
    const guide = buildGuide(r, 'PRELIM');
    students.forEach((s, i) => {
      const o = termOutcome(r, s, 'PRELIM');
      if (o.kind !== 'ok') throw new Error(o.kind);
      expect(guideCells(guide.rows[i]!).slice(3, 7)).toEqual([o.result.cs.raw, o.result.we.raw, o.result.termGrade, formatPoint(o.result.termPointGrade.point)]);
    });
  });
});

describe('REQ-03: rounding defined once', () => {
  it('TC-004: 74.995% rounds half-up to 75.00, then 75', () => {
    expect(scale(14999, 20000)).toEqual({ scaledHundredths: 7500, roundedPct: 75, unverifiedBoundary: false });
  });
});

describe('REQ-04: transmutation accepts every score from 0 to the maximum', () => {
  const we = (raw: number) => computeTerm({ subjectType: 'LEC', cs: { raw: 50, total: 100 }, we: { raw, total: 60 } }).we;

  it('TC-005: 0/60 gives the lowest table value, with no error', () => {
    expect(we(0)).toMatchObject({ scaledHundredths: 0, roundedPct: 0, transmuted: 60, unverifiedLowPct: true });
  });

  it('TC-006: 1/60 and 5/60 follow the table rows for 2% and 8%', () => {
    expect(we(1)).toMatchObject({ scaledHundredths: 167, roundedPct: 2, transmuted: transmute(2) });
    expect(we(5)).toMatchObject({ scaledHundredths: 833, roundedPct: 8, transmuted: transmute(8) });
    for (let raw = 0; raw <= 60; raw++) expect(() => we(raw)).not.toThrow();
  });

  it('TC-007: 60/60 gives the top value (100, point 1.0)', () => {
    expect(we(60).transmuted).toBe(100);
    expect(pointGrade(100, 'term').point).toBe(1.0);
  });
});

describe('REQ-05: pass/fail from the final grade only', () => {
  it('TC-008: exactly 75 passes with 3.0', () => {
    expect(finalRating(75, 75, 75)).toMatchObject({ grade: 75, point: { point: 3.0 } });
    expect(pointGrade(75, 'term').point).toBe(3.0);
  });

  it('TC-010: every passing FR point grade (1.0 to 3.0) comes from a grade of 75 or more', () => {
    for (const row of rules.transcriptPointGrades) {
      expect(row.grade).toBeGreaterThanOrEqual(rules.passingGrade);
      expect(row.point).toBeLessThanOrEqual(3.0);
    }
    expect(pointGrade(74, 'transcript').point).toBe(5.0);
  });
});

describe('REQ-07 / REQ-08: zero, blank and invalid scores', () => {
  const r = record([]);
  const a: Student = { id: 'A', studentId: 'A', name: 'A', scores: { pcs: '80' }, statuses: {} }; // exam blank
  const b: Student = { id: 'B', studentId: 'B', name: 'B', scores: { pcs: '80', pwe: '0' }, statuses: {} };

  it('TC-012 / TC-013: blank is "not encoded" and not computed; 0 is computed', () => {
    expect(parseScore('', 100)).toEqual({ kind: 'empty' });
    expect(parseScore('0', 100)).toEqual({ kind: 'ok', value: 0 });
    expect(termOutcome(r, a, 'PRELIM')).toEqual({ kind: 'incomplete', missing: 1 });
    const o = termOutcome(r, b, 'PRELIM');
    expect(o.kind === 'ok' && [o.result.we.raw, o.result.we.transmuted]).toEqual([0, 60]);
  });

  it('TC-014 / TC-015: above max, negative and non-numeric scores get a message and are never computed', () => {
    expect(parseScore('65', 60)).toEqual({ kind: 'invalid', message: 'Score is above the maximum of 60' });
    expect(parseScore('-5', 60)).toEqual({ kind: 'invalid', message: 'Score cannot be negative' });
    expect(parseScore('abc', 60)).toEqual({ kind: 'invalid', message: '"abc" is not a number' });
    const bad: Student = { id: 'X', studentId: 'X', name: 'X', scores: { pcs: '80', pwe: '165' }, statuses: {} };
    expect(termOutcome(r, bad, 'PRELIM').kind).toBe('invalid');
  });
});

describe('REQ-09: weightages total 100%', () => {
  it('TC-016: CS/WE weightages are fixed and total 100%; CS categories of 60% + 30% block grades', () => {
    for (const w of Object.values(rules.weightBp)) expect(w.cs + w.we).toBe(10000);
    const setup: TermSetup = {
      csMode: 'WEIGHTED_CATEGORIES',
      categories: [
        { id: 'q', name: 'Quiz', weightPct: 60 },
        { id: 'a', name: 'Activity', weightPct: 30 },
      ],
      columns: [
        { id: 'q1', label: 'Quiz', maxScore: 10, component: 'CS', categoryId: 'q' },
        { id: 'a1', label: 'Activity', maxScore: 10, component: 'CS', categoryId: 'a' },
        { id: 'e', label: 'Exam', maxScore: 60, component: 'WE' },
      ],
    };
    expect(termSetupIssues(setup)).toContain('Category weights add up to 90%, not 100%.');
    const s: Student = { id: 'A', studentId: 'A', name: 'A', scores: { q1: '5', a1: '5', e: '30' }, statuses: {} };
    expect(termOutcome(record([s], { PRELIM: setup }), s, 'PRELIM').kind).toBe('setup');
  });

  it('TC-017: no grades or export without a complete setup', () => {
    const empty: TermSetup = { csMode: 'RAW_SUM', categories: [], columns: [] };
    const s: Student = { id: 'A', studentId: 'A', name: 'A', scores: {}, statuses: {}, mastersoft: msRow(0, 'A') };
    const r = record([s], { PRELIM: empty });
    expect(termOutcome(r, s, 'PRELIM').kind).toBe('setup');
    expect(planExport(r, 'PRELIM', 'CS').blockers).toEqual(['Add at least one Class Standing column.', 'Add at least one Written Exam column.']);
  });
});

describe('REQ-10 / REQ-11 / REQ-12: class list', () => {
  const full = (id: string, order: number): Student => ({ ...studentWithTermGrades(id, { PRELIM: 85, MIDTERM: 85, FINAL: 85 }), mastersoft: msRow(order, id) });

  it('TC-018 / TC-019: a late-added student appears and blocks the export until scored', () => {
    const r = record([full('A', 0), full('B', 1), { id: 'C', studentId: 'C', name: 'Juan Dela Cruz', scores: {}, statuses: {}, mastersoft: msRow(2, 'C') }]);
    expect(buildGuide(r, 'PRELIM').rows.map((row) => row.name)).toContain('Juan Dela Cruz');
    expect(planExport(r, 'PRELIM', 'CS').blockers).toEqual(['Scores missing for: Juan Dela Cruz.']);
  });

  it('TC-020: a duplicate Student ID is flagged and blocks the Mastersoft export', () => {
    const typedAgain: Student = { ...full('X', 0), id: 'X2', studentId: ' d-001 ', name: 'Typed again', mastersoft: undefined };
    const r = record([{ ...full('D-001', 0), name: 'Alpha Ann' }, full('B', 1), typedAgain]);
    expect([...duplicateStudentIds(r.students).values()].map((list) => list.map((s) => s.name))).toEqual([['Alpha Ann', 'Typed again']]);
    expect(planExport(r, 'PRELIM', 'CS').blockers).toEqual([
      'Student ID D-001 is used by more than one student: Alpha Ann, Typed again. Each student can appear only once.',
    ]);
    expect(buildGuide(r, 'PRELIM').rows[0]!.notes).toContain('Duplicate Student ID');
    const p = termProgress(r, 'PRELIM');
    expect(p.duplicateIds).toBe(2);
    expect(p.complete).toBe(false);
    expect(p.problems.filter((x) => x.column === -2).map((x) => x.row)).toEqual([0, 2]);
  });

  it('TC-021: importing the Mastersoft list again never duplicates students', () => {
    const rows = [msRow(0, 'A'), msRow(1, 'B')];
    const make = () => ({ id: crypto.randomUUID(), studentId: '', name: '', scores: {}, statuses: {} });
    const once = mergeMastersoftRows([], rows, make).students;
    const twice = mergeMastersoftRows(once, [...rows, msRow(2, 'C')], make);
    expect(twice.students.map((s) => s.studentId)).toEqual(['A', 'B', 'C']);
    expect(twice.added).toBe(1);
  });
});

describe('REQ-21 / REQ-23: reports', () => {
  it('TC-033: the Encoding Guide generates without optional class details', () => {
    const r = { ...record([studentWithTermGrades('A', { PRELIM: 80, MIDTERM: 80, FINAL: 80 })]), subjectName: '', section: '' };
    const guide = buildGuide(r, 'PRELIM');
    expect(guide.classLine).toBe('TEST 1 · Lecture 50/50');
    expect(guide.rows).toHaveLength(1);
  });

  it('TC-035: point grades always show with a fixed decimal', () => {
    expect(formatPoint(3)).toBe('3.0');
    expect(formatPoint(1.8)).toBe('1.8');
    expect(formatPoint(pointGrade(100, 'transcript').point)).toBe('1.0');
  });
});

describe('Readiness across classes', () => {
  it('TC-032: the overview shows missing setup and progress for every class', () => {
    const ready = record([studentWithTermGrades('A', { PRELIM: 80, MIDTERM: 80, FINAL: 80 })]);
    const noSetup = { ...record([studentWithTermGrades('B', { PRELIM: 80, MIDTERM: 80, FINAL: 80 })]), id: 'd', terms: { ...ready.terms, MIDTERM: { csMode: 'RAW_SUM' as const, categories: [], columns: [] } } };
    const empty = { ...record([]), id: 'e' };
    const [a, b, c] = [ready, noSetup, empty].map((r) => classOverview(r));
    expect(a!.terms.PRELIM.complete).toBe(true);
    expect(b!.terms.MIDTERM.setupIssues.length).toBeGreaterThan(0);
    expect(b!.terms.PRELIM.complete).toBe(true);
    expect(c!.students).toBe(0);
    expect(c!.terms.PRELIM.complete).toBe(false);
  });
});
