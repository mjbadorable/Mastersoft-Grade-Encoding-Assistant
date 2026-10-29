// The gradebook adapter must only pass class-record data to the engine and return its results.
import { describe, expect, it } from 'vitest';
import { displayOrder } from '../../src/app/displayOrder';
import { assessmentTotals, clearColumn, copyTermSetup, duplicateStudentIds, fillColumn, parseScore, pasteExtent, duplicateClassSetup, termColumnStats, finalOutcome, reverseOutcome, termOutcome, termSetupIssues } from '../../src/app/gradebook';
import { parseBackup, serializeBackup } from '../../src/app/backup';
import { createDemoClass } from '../../src/app/demoClass';
import { obeReport, vpaaForRecord } from '../../src/app/obe';
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

describe('copyTermSetup', () => {
  const weighted: TermSetup = {
    csMode: 'WEIGHTED_CATEGORIES',
    categories: [
      { id: 'cq', name: 'Quizzes', weightPct: 60 },
      { id: 'ca', name: 'Activities', weightPct: 40 },
    ],
    columns: [
      { id: 'pq1', label: 'Quiz 1', maxScore: 20, component: 'CS', categoryId: 'cq', coIds: ['co1'], loIds: ['lo1'], coWeights: { co1: 100 } },
      { id: 'pa1', label: 'Activity 1', maxScore: 50, component: 'CS', categoryId: 'ca' },
      { id: 'pex', label: 'Major Exam', maxScore: 60, component: 'WE' },
    ],
  };
  const counter = (prefix: string) => {
    let n = 0;
    return () => `${prefix}${++n}`;
  };
  const source = (students: Student[] = []) => record(students, { PRELIM: weighted, MIDTERM: { csMode: 'RAW_SUM', categories: [], columns: [] } });

  it('copies mode, columns and OBE tags under new ids', () => {
    const out = copyTermSetup(source(), 'PRELIM', 'MIDTERM', counter('n'));
    const term = out.terms.MIDTERM;
    expect(term.csMode).toBe('WEIGHTED_CATEGORIES');
    expect(term.columns.map((c) => [c.label, c.maxScore, c.component])).toEqual([['Quiz 1', 20, 'CS'], ['Activity 1', 50, 'CS'], ['Major Exam', 60, 'WE']]);
    expect(term.columns[0]).toMatchObject({ coIds: ['co1'], loIds: ['lo1'], coWeights: { co1: 100 } });
    expect(term.columns.map((c) => c.id)).not.toContain('pq1');
    expect(new Set(term.columns.map((c) => c.id)).size).toBe(3);
  });

  it('gives categories new ids and points the columns at them', () => {
    const out = copyTermSetup(source(), 'PRELIM', 'MIDTERM', counter('n'));
    const { categories, columns } = out.terms.MIDTERM;
    expect(categories.map((c) => [c.name, c.weightPct])).toEqual([['Quizzes', 60], ['Activities', 40]]);
    expect(categories.map((c) => c.id)).not.toContain('cq');
    expect(columns[0]!.categoryId).toBe(categories[0]!.id);
    expect(columns[1]!.categoryId).toBe(categories[1]!.id);
    expect(columns[2]!.categoryId).toBeUndefined();
  });

  it('leaves the source term and its scores alone and copies none', () => {
    const s = student({ pq1: '18', pa1: '40', pex: '55' });
    const out = copyTermSetup(source([s]), 'PRELIM', 'MIDTERM', counter('n'));
    expect(out.terms.PRELIM).toEqual(weighted);
    expect(out.students[0]!.scores).toEqual({ pq1: '18', pa1: '40', pex: '55' });
    const newIds = out.terms.MIDTERM.columns.map((c) => c.id);
    expect(newIds.every((id) => !(id in out.students[0]!.scores))).toBe(true);
  });

  it('removes scores of the columns it replaces but keeps other terms', () => {
    const s = student({ pq1: '18', mq1: '9', fq1: '7' });
    const base = record([s], { PRELIM: weighted });
    const out = copyTermSetup(base, 'PRELIM', 'MIDTERM', counter('n'));
    expect(out.students[0]!.scores).toEqual({ pq1: '18', fq1: '7' });
  });

  it('gives the same ids when replayed with the same id source', () => {
    const a = copyTermSetup(source(), 'PRELIM', 'MIDTERM', counter('n'));
    const b = copyTermSetup(source(), 'PRELIM', 'MIDTERM', counter('n'));
    expect(a.terms.MIDTERM).toEqual(b.terms.MIDTERM);
  });
});

describe('duplicateClassSetup', () => {
  const weighted: TermSetup = {
    csMode: 'WEIGHTED_CATEGORIES',
    categories: [{ id: 'cq', name: 'Quizzes', weightPct: 100 }],
    columns: [
      { id: 'pq1', label: 'Quiz 1', maxScore: 20, component: 'CS', categoryId: 'cq', coIds: ['co1'] },
      { id: 'pex', label: 'Exam', maxScore: 60, component: 'WE' },
    ],
  };
  const obe = { programName: 'P', pos: [], cos: [{ id: 'co1', code: 'CO1', description: '', agaCodes: [], poCodes: [], passRawPct: 60, targetClassPct: 75 }], los: [] };
  const source = (): ClassRecord => ({
    ...record([student({ pq1: '18', mq1: '9' })], { PRELIM: weighted }),
    section: '2-A',
    obe,
    mastersoftSession: '1stSem,2024-2025',
  });
  const counter = () => {
    let n = 0;
    return () => `n${++n}`;
  };

  it('keeps the subject and setup of all three terms but starts with no students', () => {
    const copy = duplicateClassSetup(source(), ' 2-B ', counter());
    expect(copy).toMatchObject({ subjectCode: 'X', subjectType: 'LEC', section: '2-B', students: [], mastersoftSession: '1stSem,2024-2025' });
    expect(copy.id).not.toBe('c');
    expect(copy.terms.PRELIM.csMode).toBe('WEIGHTED_CATEGORIES');
    expect(copy.terms.MIDTERM.columns.map((c) => [c.label, c.maxScore])).toEqual(source().terms.MIDTERM.columns.map((c) => [c.label, c.maxScore]));
  });

  it('gives every column and category a new id and remaps the category of each column', () => {
    const src = source();
    const copy = duplicateClassSetup(src, 'B', counter());
    const oldIds = new Set(['c', 'cq', ...Object.values(src.terms).flatMap((t) => t.columns.map((c) => c.id))]);
    const newIds = [copy.id, ...Object.values(copy.terms).flatMap((t) => [...t.categories.map((c) => c.id), ...t.columns.map((c) => c.id)])];
    expect(newIds.some((id) => oldIds.has(id))).toBe(false);
    expect(new Set(newIds).size).toBe(newIds.length);
    const { categories, columns } = copy.terms.PRELIM;
    expect(columns[0]!.categoryId).toBe(categories[0]!.id);
    expect(columns[0]!.coIds).toEqual(['co1']);
  });

  it('copies the OBE setup instead of sharing it, and leaves the source alone', () => {
    const src = source();
    const copy = duplicateClassSetup(src, 'B', counter());
    expect(copy.obe).toEqual(obe);
    expect(copy.obe).not.toBe(src.obe);
    expect(src.students).toHaveLength(1);
    expect(src.terms.PRELIM).toEqual(weighted);
    expect(duplicateClassSetup({ ...src, obe: undefined }, 'B', counter()).obe).toBeUndefined();
  });
});

describe('displayOrder', () => {
  const named = (studentId: string, name: string): Student => ({ id: studentId || name || 'blank', studentId, name, scores: {}, statuses: {} });
  const list = [named('2024-10', 'Cruz, Ben'), named('2024-2', 'alvarez, Ana'), named('', ''), named('2024-3', 'Bautista, Cy')];

  it('keeps the record order by default and never changes the record', () => {
    const before = structuredClone(list);
    expect(displayOrder(list, '', 'mastersoft')).toEqual([0, 1, 2, 3]);
    displayOrder(list, '', 'name-asc');
    displayOrder(list, 'a', 'id-asc');
    expect(list).toEqual(before);
  });

  it('sorts by name ignoring case, and by Student ID with numbers in order, blanks last', () => {
    expect(displayOrder(list, '', 'name-asc')).toEqual([1, 3, 0, 2]);
    expect(displayOrder(list, '', 'id-asc')).toEqual([1, 3, 0, 2]);
  });

  it('sorts by a score column, low to high or high to low, with blank and non-numeric scores last', () => {
    const scored = ['8', '', '10', 'abc', '2'].map((v, i): Student => ({ ...named(`S${i}`, `S${i}`), scores: v ? { q: v } : {} }));
    expect(displayOrder(scored, '', 'mastersoft', { columnId: 'q', dir: 'asc' })).toEqual([4, 0, 2, 1, 3]);
    expect(displayOrder(scored, '', 'mastersoft', { columnId: 'q', dir: 'desc' })).toEqual([2, 0, 4, 1, 3]);
  });

  it('filters by ID or name, ignoring case and spaces around the query, in the chosen order', () => {
    expect(displayOrder(list, ' CRUZ ', 'mastersoft')).toEqual([0]);
    expect(displayOrder(list, '2024-', 'name-asc')).toEqual([1, 3, 0]);
    expect(displayOrder(list, 'nobody', 'mastersoft')).toEqual([]);
  });

  it('leaves the Mastersoft export order alone whatever the display order', () => {
    const ms = (order: number, id: string): Student => ({
      ...named(id, id),
      mastersoft: { order, studentId: id, studentName: id, subject: '', campus: '', section: '', semester: '' },
    });
    const students = [ms(0, 'Z'), ms(1, 'A')];
    const sorted = displayOrder(students, '', 'name-asc').map((i) => students[i]!);
    expect(sorted.map((s) => s.studentId)).toEqual(['A', 'Z']);
    expect(students.map((s) => s.mastersoft!.order)).toEqual([0, 1]);
  });
});

describe('termColumnStats', () => {
  const s = (id: string, scores: Record<string, string>, statuses: Student['statuses'] = {}): Student => ({ ...student(scores, statuses), id });

  it('averages each column over the students who have a valid score, and as a % of the maximum', () => {
    const r = record([s('a', { pq1: '18', pq2: '25', pact: '70', pex: '55' }), s('b', { pq1: '15', pex: '40' }), s('c', { pq1: '', pex: 'abc' })]);
    const { columns } = termColumnStats(r, 'PRELIM');
    expect(columns.pq1).toEqual({ count: 2, sum: 33, average: 16.5, averagePct: 82.5 });
    expect(columns.pq2).toEqual({ count: 1, sum: 25, average: 25, averagePct: 83.3 });
    expect(columns.pex).toEqual({ count: 2, sum: 95, average: 47.5, averagePct: 79.2 });
  });

  it('rounds half-up to 2 decimals and adds decimals exactly', () => {
    const r = record([s('a', { pq1: '0.1' }), s('b', { pq1: '0.2' }), s('c', { pq1: '0.2' })]);
    expect(termColumnStats(r, 'PRELIM').columns.pq1).toMatchObject({ sum: 0.5, average: 0.17 });
    const tie = record([s('a', { pq1: '1' }), s('b', { pq1: '2' }), s('c', { pq1: '2' }), s('d', { pq1: '2' }), s('e', { pq1: '2' }), s('f', { pq1: '3' }), s('g', { pq1: '2' }), s('h', { pq1: '2' })]);
    expect(termColumnStats(tie, 'PRELIM').columns.pq1?.average).toBe(2);
  });

  it('shows no average for a column nobody has a score in, or for an empty class', () => {
    expect(termColumnStats(record([s('a', {})]), 'PRELIM').columns.pq1).toEqual({ count: 0, sum: 0, average: null, averagePct: null });
    expect(termColumnStats(record([]), 'PRELIM')).toMatchObject({ graded: 0, passedPct: null, meanTermGrade: null });
  });

  it('counts passed and failed from the engine term grades, ignoring ungraded students', () => {
    const high = s('hi', { pq1: '20', pq2: '30', pact: '80', pex: '60' }); // 100
    const low = s('lo', { pq1: '5', pq2: '5', pact: '10', pex: '10' });
    const partial = s('pa', { pq1: '20' });
    const dropped = s('dr', {}, { PRELIM: 'DRP' });
    const r = record([high, low, partial, dropped]);
    const stats = termColumnStats(r, 'PRELIM');
    const grades = [high, low].map((x) => {
      const o = termOutcome(r, x, 'PRELIM');
      return o.kind === 'ok' ? o.result.termGrade : NaN;
    });
    expect(grades[0]).toBe(100);
    expect(grades[1]).toBeLessThan(75);
    expect(stats).toMatchObject({ graded: 2, passedCount: 1, failedCount: 1, passedPct: 50 });
    expect(stats.meanTermGrade).toBe((grades[0]! + grades[1]!) / 2);
  });
});

describe('fillColumn / clearColumn', () => {
  const stu = (id: string, scores: Record<string, string>, statuses: Student['statuses'] = {}): Student => ({ id, studentId: id, name: id, scores, statuses });
  const cls = (students: Student[]): ClassRecord => ({
    id: 'c',
    subjectCode: 'X',
    subjectName: '',
    section: '',
    subjectType: 'LEC',
    terms: { PRELIM: rawTerm('p'), MIDTERM: rawTerm('m'), FINAL: rawTerm('f') },
    students,
    updatedAt: 0,
  });

  it('skips every student with a status in that term, whatever the status', () => {
    const students = (['INC', 'ABS', 'HNA', 'DRP', 'WP'] as const).map((st, i) => stu(`s${i}`, {}, { PRELIM: st })).concat(stu('ok', {}));
    for (const mode of ['blanks-only', 'all'] as const) {
      const out = fillColumn(cls(students), 'PRELIM', 'pq1', '20', mode);
      expect(out.students.slice(0, 5).every((s) => !('pq1' in s.scores))).toBe(true);
      expect(out.students[5]!.scores.pq1).toBe('20');
    }
  });

  it('only a status in the same term counts', () => {
    const out = fillColumn(cls([stu('a', {}, { MIDTERM: 'ABS' })]), 'PRELIM', 'pq1', '15', 'all');
    expect(out.students[0]!.scores.pq1).toBe('15');
  });

  it('blanks-only keeps typed scores (including 0); all replaces them', () => {
    const r = cls([stu('a', { pq1: '7' }), stu('b', {}), stu('c', { pq1: '0' }), stu('d', { pq1: '  ' })]);
    expect(fillColumn(r, 'PRELIM', 'pq1', '20', 'blanks-only').students.map((s) => s.scores.pq1)).toEqual(['7', '20', '0', '20']);
    expect(fillColumn(r, 'PRELIM', 'pq1', '20', 'all').students.map((s) => s.scores.pq1)).toEqual(['20', '20', '20', '20']);
  });

  it('rejects values outside 0..max, non-numbers and unknown columns', () => {
    const r = cls([stu('a', {})]);
    for (const v of ['21', '-1', 'abc', '']) expect(fillColumn(r, 'PRELIM', 'pq1', v, 'all')).toBe(r);
    expect(fillColumn(r, 'PRELIM', 'nope', '5', 'all')).toBe(r);
    expect(fillColumn(r, 'MIDTERM', 'pq1', '5', 'all')).toBe(r);
    expect(fillColumn(r, 'PRELIM', 'pq1', '0', 'all').students[0]!.scores.pq1).toBe('0');
    expect(fillColumn(r, 'PRELIM', 'pq1', '20', 'all').students[0]!.scores.pq1).toBe('20');
  });

  it('does not touch other columns or mutate the input', () => {
    const r = cls([stu('a', { pq2: '9' })]);
    const out = fillColumn(r, 'PRELIM', 'pq1', '5', 'all');
    expect(out.students[0]!.scores).toEqual({ pq2: '9', pq1: '5' });
    expect(r.students[0]!.scores).toEqual({ pq2: '9' });
  });

  it('returns the same record when nothing changes', () => {
    const r = cls([stu('a', { pq1: '20' }), stu('b', {}, { PRELIM: 'DRP' })]);
    expect(fillColumn(r, 'PRELIM', 'pq1', '20', 'all')).toBe(r);
  });

  it('clears one column for every student, statuses included', () => {
    const r = cls([stu('a', { pq1: '5', pq2: '6' }), stu('b', { pq1: '8' }, { PRELIM: 'INC' }), stu('c', {})]);
    const out = clearColumn(r, 'pq1');
    expect(out.students.map((s) => s.scores)).toEqual([{ pq2: '6' }, {}, {}]);
    expect(out.students[1]!.statuses).toEqual({ PRELIM: 'INC' });
    expect(clearColumn(out, 'pq1')).toBe(out);
  });
});

describe('pasteExtent', () => {
  const block = (rows: number, cols: number) => Array.from({ length: rows }, () => Array.from({ length: cols }, () => '1'));

  it('fits when the block is no wider than the room to the right', () => {
    // Student ID, Name and 2 score columns = 4 editable cells; focus on the first score (index 2).
    expect(pasteExtent(block(3, 2), 4, 2)).toEqual({ pastedColumns: 2, availableColumns: 2, overflow: 0, written: 2 });
    expect(pasteExtent(block(3, 1), 4, 2)).toMatchObject({ overflow: 0, written: 1 });
  });

  it('counts the extra columns that have nowhere to go', () => {
    expect(pasteExtent(block(5, 4), 4, 2)).toEqual({ pastedColumns: 4, availableColumns: 2, overflow: 2, written: 2 });
    expect(pasteExtent(block(2, 3), 4, 3)).toMatchObject({ availableColumns: 1, overflow: 2, written: 1 });
  });

  it('uses the widest row of a ragged block', () => {
    expect(pasteExtent([['1'], ['1', '2', '3'], ['1', '2']], 4, 2)).toMatchObject({ pastedColumns: 3, overflow: 1 });
  });
});

describe('createDemoClass', () => {
  const demo = createDemoClass();
  const TERMS_ALL = ['PRELIM', 'MIDTERM', 'FINAL'] as const;

  it('is the GE 6 – Art Appreciation sample, marked as a demo, with a fresh id each time', () => {
    expect(demo).toMatchObject({ subjectCode: 'GE 6', subjectName: 'Art Appreciation', section: '1-A', subjectType: 'LEC', demo: true });
    expect(createDemoClass().id).not.toBe(demo.id);
    expect(demo.students).toHaveLength(5);
  });

  it('has Quiz /50, Activity /50 and Exam /100 in every term, with no setup problems', () => {
    for (const t of TERMS_ALL) {
      expect(termSetupIssues(demo.terms[t])).toEqual([]);
      expect(demo.terms[t].columns.map((c) => [c.label, c.maxScore, c.component])).toEqual([
        ['Quiz', 50, 'CS'],
        ['Activity', 50, 'CS'],
        ['Exam', 100, 'WE'],
      ]);
      expect(assessmentTotals(demo.terms[t])).toMatchObject({ cs: 100, we: 100 });
    }
    const ids = TERMS_ALL.flatMap((t) => demo.terms[t].columns.map((c) => c.id));
    expect(new Set(ids).size).toBe(9);
  });

  it('has unique, anonymized students and only valid scores', () => {
    expect(new Set(demo.students.map((s) => s.id)).size).toBe(5);
    expect(new Set(demo.students.map((s) => s.studentId)).size).toBe(5);
    expect(demo.students.every((s) => /^DEMO-\d{3}$/.test(s.studentId) && s.name.startsWith('Sample Student'))).toBe(true);
    for (const s of demo.students) {
      for (const t of TERMS_ALL) {
        for (const c of demo.terms[t].columns) {
          const text = s.scores[c.id];
          if (text !== undefined) expect(parseScore(text, c.maxScore).kind).toBe('ok');
        }
      }
    }
  });

  it('runs through the engine to 1.0, 2.1, 3.0, 5.0 and an INC', () => {
    expect(duplicateStudentIds(demo.students).size).toBe(0);
    const out = demo.students.map((s) => finalOutcome(demo, s));
    const points = out.map((o) => (o.kind === 'rating' ? [o.rating.grade, o.rating.point.point] : [o.kind === 'status' ? o.status : o.kind]));
    expect(points).toEqual([[100, 1.0], [86, 2.1], [75, 3.0], [73, 5.0], ['INC']]);
    // Every term of the four graded students computes; the INC student's Final is not graded.
    for (const s of demo.students.slice(0, 4)) for (const t of TERMS_ALL) expect(termOutcome(demo, s, t).kind).toBe('ok');
  });

  it('has CO1–CO3 and tags every column with an outcome that exists', () => {
    const obe = demo.obe!;
    expect(obe.cos.map((c) => c.code)).toEqual(['CO1', 'CO2', 'CO3']);
    expect(obe.cos.every((c) => c.description !== '')).toBe(true);
    expect(obe.los.every((l) => l.description !== '' && l.coIds.every((id) => obe.cos.some((c) => c.id === id)))).toBe(true);
    for (const t of TERMS_ALL) {
      for (const c of demo.terms[t].columns) {
        expect(c.coIds!.length).toBeGreaterThan(0);
        expect(c.coIds!.every((id) => obe.cos.some((co) => co.id === id))).toBe(true);
        expect(c.loIds!.every((id) => obe.los.some((l) => l.id === id && l.term === t))).toBe(true);
      }
    }
    const report = obeReport(demo)!;
    expect(report).not.toBeNull();
    expect(() => vpaaForRecord(demo, obe)).not.toThrow();
  });

  it('survives a backup round trip unchanged', () => {
    const parsed = parseBackup(serializeBackup(demo));
    expect(parsed.type === 'single' && parsed.classRecord).toEqual(demo);
  });
});
