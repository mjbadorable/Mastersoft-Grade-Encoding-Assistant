// The gradebook adapter must only pass class-record data to the engine and return its results.
import { describe, expect, it } from 'vitest';
import { assessmentTotals, finalOutcome, reverseOutcome, termOutcome, termSetupIssues } from '../../src/app/gradebook';
import type { ClassRecord, Student, TermSetup } from '../../src/app/types';
import { computeTerm, finalRating, minFinalNeeded, weightedCategoriesMark } from '../../src/engine';

const rawTerm = (p: string): TermSetup => ({
  csMode: 'RAW_SUM',
  categories: [],
  columns: [
    { id: `${p}q1`, label: 'Quiz 1', maxScore: 20, component: 'CS' },
    { id: `${p}q2`, label: 'Quiz 2', maxScore: 30, component: 'CS' },
    { id: `${p}act`, label: 'Activity', maxScore: 80, component: 'CS' },
    { id: `${p}ex`, label: 'Exam', maxScore: 60, component: 'WE' },
  ],
});

const student = (scores: Record<string, string>, statuses: Student['statuses'] = {}): Student => ({
  id: 's',
  studentId: 'T-1',
  name: 'Test',
  scores,
  statuses,
});

const record = (students: Student[], terms?: Partial<ClassRecord['terms']>): ClassRecord => ({
  id: 'c',
  subjectCode: 'X',
  subjectName: '',
  section: '',
  subjectType: 'LEC',
  terms: { PRELIM: rawTerm('p'), MIDTERM: rawTerm('m'), FINAL: rawTerm('f'), ...terms },
  students,
  updatedAt: 0,
});

describe('raw-sum term', () => {
  it('sums the columns into Mastersoft totals and matches computeTerm', () => {
    const s = student({ pq1: '18', pq2: '25', pact: '70', pex: '55' });
    const r = record([s]);
    expect(assessmentTotals(r.terms.PRELIM)).toEqual({ cs: 130, we: 60 });
    const o = termOutcome(r, s, 'PRELIM');
    expect(o.kind).toBe('ok');
    if (o.kind !== 'ok') return;
    expect(o.result).toEqual(computeTerm({ subjectType: 'LEC', cs: { raw: 113, total: 130 }, we: { raw: 55, total: 60 } }));
    expect(o.result.termGrade).toBe(94);
  });

  it('adds decimal marks exactly; no D6 warning when whole numbers give the same grade', () => {
    const r = record([]);
    const s = student({ pq1: '0.1', pq2: '0.2', pact: '0', pex: '29.5' });
    const o = termOutcome(r, s, 'PRELIM');
    expect(o.kind === 'ok' && o.result.cs.raw).toBe(0.3);
    const fine = termOutcome(r, student({ pq1: '20', pq2: '30', pact: '80', pex: '59.5' }), 'PRELIM');
    expect(fine.kind === 'ok' && fine.decimalWarning).toBeUndefined();
  });

  it('reports missing and invalid scores instead of a grade', () => {
    const r = record([]);
    expect(termOutcome(r, student({ pq1: '18' }), 'PRELIM')).toEqual({ kind: 'incomplete', missing: 3 });
    const bad = termOutcome(r, student({ pq1: '21', pq2: 'x', pact: '1', pex: '1' }), 'PRELIM');
    expect(bad.kind).toBe('invalid');
  });

  it('blocks a term with no Written Exam column', () => {
    const setup = { ...rawTerm('p'), columns: rawTerm('p').columns.filter((c) => c.component === 'CS') };
    expect(termSetupIssues(setup)).toEqual(['Add at least one Written Exam column.']);
    expect(termOutcome(record([], { PRELIM: setup }), student({}), 'PRELIM')).toEqual({ kind: 'setup' });
  });
});

describe('weighted categories (D5, D24)', () => {
  const setup: TermSetup = {
    csMode: 'WEIGHTED_CATEGORIES',
    categories: [
      { id: 'quiz', name: 'Quiz', weightPct: 40 },
      { id: 'act', name: 'Activity', weightPct: 60 },
    ],
    columns: rawTerm('p').columns.map((c) => (c.component === 'CS' ? { ...c, categoryId: c.id === 'pact' ? 'act' : 'quiz' } : c)),
  };

  it('encodes CS out of 100 using the engine mark, and shows the raw-sum grade too', () => {
    const s = student({ pq1: '18', pq2: '25', pact: '70', pex: '55' });
    const r = record([s], { PRELIM: setup });
    expect(assessmentTotals(setup).cs).toBe(100);
    const o = termOutcome(r, s, 'PRELIM');
    if (o.kind !== 'ok') throw new Error(o.kind);
    const { mark } = weightedCategoriesMark([
      { weightPct: 40, raw: 43, total: 50 },
      { weightPct: 60, raw: 70, total: 80 },
    ]);
    expect(o.result.cs.raw).toBe(mark);
    expect(o.result.cs.total).toBe(100);
    expect(o.rawSumResult?.termGrade).toBe(94);
  });

  it('flags weights that do not add up to 100 and unassigned columns', () => {
    const broken = { ...setup, categories: [{ id: 'quiz', name: 'Quiz', weightPct: 50 }] };
    const issues = termSetupIssues(broken);
    expect(issues).toContain('Category weights add up to 50%, not 100%.');
    expect(issues.some((i) => i.startsWith('Assign a category to: Activity'))).toBe(true);
  });
});

describe('statuses and Final Rating', () => {
  const full = { pq1: '18', pq2: '25', pact: '70', pex: '55', mq1: '20', mq2: '30', mact: '80', mex: '60', fq1: '10', fq2: '15', fact: '40', fex: '30' };

  it('computes the Final Rating from the three term grades', () => {
    const s = student(full);
    const r = record([s]);
    const grades = (['PRELIM', 'MIDTERM', 'FINAL'] as const).map((t) => {
      const o = termOutcome(r, s, t);
      return o.kind === 'ok' ? o.result.termGrade : NaN;
    });
    expect(finalOutcome(r, s)).toEqual({ kind: 'rating', rating: finalRating(grades[0]!, grades[1]!, grades[2]!) });
  });

  it('shows the minimum Final needed when only Prelim and Midterm are done (D26)', () => {
    const { fq1: _a, fq2: _b, fact: _c, fex: _d, ...partial } = full;
    const s = student(partial);
    expect(finalOutcome(record([s]), s)).toEqual({ kind: 'minFinal', needed: minFinalNeeded(94, 100) });
  });

  it('carries DRP forward and shows it as the Final Rating (D23)', () => {
    const s = student(full, { MIDTERM: 'DRP' });
    const r = record([s]);
    expect(termOutcome(r, s, 'PRELIM').kind).toBe('ok');
    expect(termOutcome(r, s, 'FINAL')).toEqual({ kind: 'status', status: 'DRP', carried: true });
    expect(finalOutcome(r, s)).toEqual({ kind: 'status', status: 'DRP' });
  });
});

describe('reverse mode', () => {
  it('solves the marks and confirms them forward', () => {
    const s = { ...student({}), reverse: { kind: 'transmuted' as const, grade: '90' } };
    const o = reverseOutcome(record([s]), s);
    if (o.kind !== 'ok') throw new Error(o.kind);
    expect(o.check.termGrade).toBe(90);
    expect(o.rating.grade).toBe(90);
  });

  it('asks for the exact grade behind a 5.0 target (D28)', () => {
    const s = { ...student({}), reverse: { kind: 'point' as const, point: '5', transmuted: '' } };
    expect(reverseOutcome(record([s]), s).kind).toBe('invalid');
  });
});
