// OBE attainment (docs/05, docs/06 Prompt A): direct CO/LO attainment, VPAA sheet, PO roll-up.
import { describe, expect, it } from 'vitest';
import {
  computeObe,
  OBE_DEFAULT_CONFIG,
  OBE_SCOPES,
  type ObeScope,
  poRollup,
  vpaaSheet,
  type CourseOutcome,
  type LearningOutcome,
  type ObeConfig,
  type ObeTerms,
} from '../../src/engine';

const co = (n: number, poCodes: string[]): CourseOutcome => ({
  id: `co${n}`,
  code: `CO${n}`,
  description: '',
  agaCodes: [],
  poCodes,
  passRawPct: 60,
  targetClassPct: 75,
});

const config: ObeConfig = {
  pos: [
    { id: 'po-A', code: 'A', description: '' },
    { id: 'po-B', code: 'B', description: '' },
    { id: 'po-C', code: 'C', description: '' },
  ],
  cos: [co(1, ['A', 'B']), co(2, ['B'])],
  los: [
    { id: 'lo11', code: 'LO 1.1', moduleCode: 'M1', term: 'PRELIM', coIds: ['co1'], description: '' },
    { id: 'lo21', code: 'LO 2.1', moduleCode: 'M2', term: 'MIDTERM', coIds: ['co2'], description: '' },
  ],
};

const terms: ObeTerms = {
  PRELIM: {
    columns: [
      { id: 'q1', label: 'Q1', maxScore: 20, coIds: ['co1'], loIds: ['lo11'] },
      // 'gone' is a CO that was deleted from the setup: the column counts fully for CO2.
      { id: 'q2', label: 'Q2', maxScore: 10, coIds: ['co2', 'gone'] },
      { id: 'pe', label: 'Prelim Exam', maxScore: 60, coIds: ['co1', 'co2'] },
    ],
  },
  MIDTERM: {
    columns: [
      { id: 'q3', label: 'Q3', maxScore: 50, coIds: ['co2'], loIds: ['lo21'] },
      { id: 'me', label: 'Midterm Exam', maxScore: 100, coIds: ['co1', 'co2'], coWeights: { co1: 30, co2: 70 } },
    ],
  },
  FINAL: { columns: [] },
};

const students = [
  { id: 's1', scores: { q1: '18', q2: '4', pe: '30', q3: '40', me: '80' } },
  { id: 's2', scores: { q1: '', q2: 'abc', pe: '54', q3: '20', me: '' } },
];

describe('computeObe — direct CO/LO attainment', () => {
  const report = computeObe(config, terms, students);
  const [s1, s2] = report.students;

  it('splits a multi-CO column equally and sums points per term', () => {
    // CO1: 18 + 30/2 = 33 of 20 + 60/2 = 50 → 66%.
    expect(s1!.scopes.PRELIM.cos.co1).toEqual({
      rawEarned: 33,
      rawMax: 50,
      rawPct: 66,
      transmutedGrade: 79,
      attained: true,
      lowColumns: ['Prelim Exam'],
    });
    // CO2: 4 + 15 = 19 of 10 + 30 = 40 → 47.5%, lacking.
    expect(s1!.scopes.PRELIM.cos.co2).toMatchObject({ rawPct: 47.5, transmutedGrade: 72, attained: false, lowColumns: ['Q2', 'Prelim Exam'] });
  });

  it('uses custom CO weights when given', () => {
    // Midterm Exam 80/100 split 30/70: CO1 24/30, CO2 56/70 plus Q3 40/50 → 96/120.
    expect(s1!.scopes.MIDTERM.cos.co1).toMatchObject({ rawEarned: 24, rawMax: 30, rawPct: 80, attained: true });
    expect(s1!.scopes.MIDTERM.cos.co2).toMatchObject({ rawEarned: 96, rawMax: 120, rawPct: 80, attained: true });
  });

  it('combines all three terms for OVERALL', () => {
    expect(s1!.scopes.OVERALL.cos.co1).toMatchObject({ rawEarned: 57, rawMax: 80, rawPct: 71.25, transmutedGrade: 82 });
    // 115 / 160 = 71.875% → 71.88 (half-up), transmuted from 72%.
    expect(s1!.scopes.OVERALL.cos.co2).toMatchObject({ rawEarned: 115, rawMax: 160, rawPct: 71.88, transmutedGrade: 83 });
  });

  it('computes LO attainment from LO-tagged columns', () => {
    expect(s1!.scopes.PRELIM.los.lo11).toMatchObject({ rawPct: 90, attained: true });
    expect(s1!.scopes.PRELIM.los.lo21).toMatchObject({ rawPct: null, transmutedGrade: null, attained: null });
  });

  it('lists the CLOs and LOs a student lacks', () => {
    expect(s1!.scopes.PRELIM.lackingCoCodes).toEqual(['CO2']);
    expect(s1!.scopes.PRELIM.lackingLoCodes).toEqual([]);
    expect(s2!.scopes.MIDTERM.lackingCoCodes).toEqual(['CO2']);
    expect(s2!.scopes.MIDTERM.lackingLoCodes).toEqual(['LO 2.1']);
    expect(s2!.scopes.MIDTERM.cos.co2!.lowColumns).toEqual(['Q3']);
  });

  it('skips blank and invalid scores instead of counting them as zero', () => {
    // s2 has only the Prelim Exam: 27/30 for each CO.
    expect(s2!.scopes.PRELIM.cos.co1).toMatchObject({ rawEarned: 27, rawMax: 30, rawPct: 90 });
    expect(s2!.scopes.PRELIM.cos.co2).toMatchObject({ rawEarned: 27, rawMax: 30, rawPct: 90 });
    expect(s2!.scopes.PRELIM.los.lo11!.rawPct).toBeNull();
    expect(s2!.scopes.MIDTERM.cos.co1!.attained).toBeNull();
  });

  it('leaves a term with no tagged columns ungraded', () => {
    expect(s1!.scopes.FINAL.cos.co1!.rawPct).toBeNull();
    expect(s1!.scopes.FINAL.lackingCoCodes).toEqual([]);
    expect(report.classCos.FINAL[0]).toMatchObject({ totalGraded: 0, attainmentPct: null, meanRawPct: null, cqiFlag: false });
  });

  it('summarises class attainment and flags COs below target for CQI', () => {
    expect(report.classCos.PRELIM).toEqual([
      { id: 'co1', code: 'CO1', attainedCount: 2, totalGraded: 2, attainmentPct: 100, meanRawPct: 78, targetClassPct: 75, cqiFlag: false },
      { id: 'co2', code: 'CO2', attainedCount: 1, totalGraded: 2, attainmentPct: 50, meanRawPct: 68.75, targetClassPct: 75, cqiFlag: true },
    ]);
    expect(report.classCos.MIDTERM[0]).toMatchObject({ attainedCount: 1, totalGraded: 1, attainmentPct: 100 });
    expect(report.classLos.MIDTERM[1]).toMatchObject({ code: 'LO 2.1', attainedCount: 1, totalGraded: 2, attainmentPct: 50, cqiFlag: true });
  });

  it('returns every scope for every student', () => {
    expect(Object.keys(s1!.scopes)).toEqual(OBE_SCOPES);
  });
});

describe('poRollup', () => {
  it('averages the linked COs and builds the course-to-PO mapping row', () => {
    const report = computeObe(config, terms, students);
    expect(poRollup(config, report.classCos.PRELIM)).toEqual([
      { poId: 'po-A', code: 'A', mapped: 1, linkedCoCodes: ['CO1'], attainmentPct: 100, meanRawPct: 78 },
      // (78 + 68.75) / 2 = 73.375 → 73.38
      { poId: 'po-B', code: 'B', mapped: 1, linkedCoCodes: ['CO1', 'CO2'], attainmentPct: 75, meanRawPct: 73.38 },
      { poId: 'po-C', code: 'C', mapped: 0, linkedCoCodes: [], attainmentPct: null, meanRawPct: null },
    ]);
  });
});

describe('vpaaSheet — VPAA CO Attainment formula', () => {
  // The VPAA example: CO1–CO5 with 4, 4, 5, 5 and 1 LOs (19 in all).
  const counts = [4, 4, 5, 5, 1];
  const los: LearningOutcome[] = counts.flatMap((count, i) =>
    Array.from({ length: count }, (_, j) => ({
      id: `lo-${i + 1}-${j + 1}`,
      code: `LO ${i + 1}.${j + 1}`,
      moduleCode: `M${i + 1}`,
      term: 'PRELIM' as const,
      coIds: [`co${i + 1}`],
      description: '',
    })),
  );
  const vpaa: ObeConfig = { pos: [], cos: [1, 2, 3, 4, 5].map((n) => co(n, [])), los };
  const sheet = vpaaSheet(vpaa, [
    { id: 'alice', finalGrade: 75 },
    { id: 'bob', finalGrade: 70 },
    { id: 'carl', finalGrade: null },
  ]);

  it('weights each CO by its share of the LOs', () => {
    expect(sheet.totalLos).toBe(19);
    expect(sheet.weights.map((w) => w.loCount)).toEqual(counts);
    expect(sheet.weights[0]!.weight).toBeCloseTo(4 / 19);
  });

  it('matches the sheet: Alice Guo 75 → 15.79, 15.79, 19.74, 19.74, 3.95', () => {
    const alice = sheet.students[0]!;
    expect(Object.values(alice.contributions!)).toEqual([15.79, 15.79, 19.74, 19.74, 3.95]);
    expect(alice.attained).toBe(true);
    expect(Object.values(sheet.students[1]!.contributions!)).toEqual([14.74, 14.74, 18.42, 18.42, 3.68]);
    expect(sheet.students[1]!.attained).toBe(false);
    expect(sheet.students[2]).toEqual({ studentId: 'carl', finalGrade: null, contributions: null, attained: null });
  });

  it('counts attained and not attained among students with a Final Rating', () => {
    expect(sheet.summary).toEqual({ totalGraded: 2, attainedCount: 1, attainedPct: 50, notAttainedCount: 1, notAttainedPct: 50 });
  });

  it('builds the module × CO relationship table', () => {
    expect(sheet.modules).toHaveLength(5);
    expect(sheet.modules[4]).toEqual({ moduleCode: 'M5', term: 'PRELIM', loCodesByCo: { co1: [], co2: [], co3: [], co4: [], co5: ['LO 5.1'] } });
  });

  it('splits equally when no LOs are mapped', () => {
    const empty = vpaaSheet({ pos: [], cos: [co(1, []), co(2, []), co(3, [])], los: [] }, [{ id: 'a', finalGrade: 80 }]);
    expect(empty.weights.map((w) => w.weight)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(Object.values(empty.students[0]!.contributions!)).toEqual([26.67, 26.67, 26.67]);
  });

  it('counts an LO linked to several COs under each of them', () => {
    const all = ['co1', 'co2', 'co3'];
    const linkedToAll: ObeConfig = {
      pos: [],
      cos: [co(1, []), co(2, []), co(3, [])],
      los: [
        { id: 'l1', code: 'LO 1.1', moduleCode: 'M1', term: 'PRELIM', coIds: all, description: '' },
        { id: 'l2', code: 'LO 1.2', moduleCode: 'M1', term: 'PRELIM', coIds: all, description: '' },
      ],
    };
    const sheet = vpaaSheet(linkedToAll, [{ id: 'a', finalGrade: 75 }]);
    expect(sheet.weights.map((w) => w.loCount)).toEqual([2, 2, 2]);
    expect(Object.values(sheet.students[0]!.contributions!)).toEqual([25, 25, 25]);
  });
});

describe('OBE_DEFAULT_CONFIG', () => {
  it('is a blank CO1–CO3 setup that links only to outcomes it defines', () => {
    const d = OBE_DEFAULT_CONFIG;
    expect(d.cos.map((c) => c.code)).toEqual(['CO1', 'CO2', 'CO3']);
    expect(d.pos.map((p) => p.code)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect([...d.pos, ...d.cos, ...d.los].every((o) => o.description === '')).toBe(true);
    expect(d.programName).toBeUndefined();
    const coIds = new Set(d.cos.map((c) => c.id));
    const poCodes = new Set(d.pos.map((p) => p.code));
    for (const l of d.los) l.coIds.forEach((id) => expect(coIds.has(id)).toBe(true));
    for (const c of d.cos) c.poCodes.forEach((code) => expect(poCodes.has(code)).toBe(true));
  });
});

describe('computeObe — exact arithmetic', () => {
  const cfg = (cos: CourseOutcome[]): ObeConfig => ({ pos: [], cos, los: [] });
  const prelim = (columns: ObeTerms['PRELIM']['columns']): ObeTerms => ({
    PRELIM: { columns },
    MIDTERM: { columns: [] },
    FINAL: { columns: [] },
  });
  const co1 = (r: ReturnType<typeof computeObe>, scope: ObeScope = 'PRELIM', id = 'co1') => r.students[0]!.scopes[scope].cos[id]!;

  it.each([
    ['1', '4', 40.63], // 13/32 = 40.625%
    ['2', '1', 15.63], // 5/32  = 15.625%
  ])('rounds a 1/3 split half-up (a=%s, b=%s → %s)', (a, b, pct) => {
    const r = computeObe(
      cfg([co(1, []), co(2, []), co(3, [])]),
      prelim([
        { id: 'a', label: 'A', maxScore: 2, coIds: ['co1', 'co2', 'co3'] },
        { id: 'b', label: 'B', maxScore: 10, coIds: ['co1'] },
      ]),
      [{ id: 's', scores: { a, b } }],
    );
    expect(co1(r).rawPct).toBe(pct);
  });

  it('rounds a 3/97 weighted split half-up, the same for points and ratios', () => {
    for (const coWeights of [{ co1: 3, co2: 97 }, { co1: 0.03, co2: 0.97 }]) {
      const r = computeObe(
        cfg([co(1, []), co(2, [])]),
        prelim([{ id: 'x', label: 'X', maxScore: 32, coIds: ['co1', 'co2'], coWeights }]),
        [{ id: 's', scores: { x: '11' } }],
      );
      expect(co1(r).rawPct).toBe(34.38); // 11/32 = 34.375%
    }
  });

  it('attains a two-decimal pass mark scored exactly, without flagging the column', () => {
    const r = computeObe(
      cfg([{ ...co(1, []), passRawPct: 64.15 }]),
      prelim([{ id: 'x', label: 'X', maxScore: 2000, coIds: ['co1'] }]),
      [{ id: 's', scores: { x: '1283' } }],
    );
    expect(co1(r)).toMatchObject({ rawPct: 64.15, attained: true, lowColumns: [] });
  });

  it('skips scores that are not plain decimals instead of crashing', () => {
    const r = computeObe(
      cfg([co(1, [])]),
      prelim([
        { id: 'x', label: 'X', maxScore: 10, coIds: ['co1'] },
        { id: 'y', label: 'Y', maxScore: 10, coIds: ['co1'] },
      ]),
      [{ id: 's', scores: { x: '0.0000001', y: '5' } }],
    );
    expect(co1(r)).toMatchObject({ rawPct: 50, rawMax: 10 });
  });

  it('falls back to the default pass mark when the pass mark is not a plain decimal', () => {
    const r = computeObe(
      cfg([{ ...co(1, []), passRawPct: 1e-7 }]),
      prelim([{ id: 'x', label: 'X', maxScore: 10, coIds: ['co1'] }]),
      [{ id: 's', scores: { x: '5' } }],
    );
    expect(co1(r)).toMatchObject({ rawPct: 50, attained: false, lowColumns: ['X'] }); // 50% < default 60%
  });

  it('skips a column whose maximum score is not a plain decimal', () => {
    const r = computeObe(
      cfg([co(1, [])]),
      prelim([
        { id: 'x', label: 'X', maxScore: 1e-7, coIds: ['co1'] },
        { id: 'y', label: 'Y', maxScore: 10, coIds: ['co1'] },
      ]),
      [{ id: 's', scores: { x: '0', y: '7' } }],
    );
    expect(co1(r)).toMatchObject({ rawPct: 70, rawMax: 10 });
  });

  it.each([
    [{ co1: 0, co2: 0 }, 33.33], // all zero → equal split: 5 / 15
    [{ co1: Number.NaN, co2: 1 }, 0], // invalid → 0: co1 gets nothing from A
    [{ co1: -5, co2: 1 }, 0],
  ])('treats invalid weights as 0 and all-zero as an equal split (%o)', (coWeights, pct) => {
    const r = computeObe(
      cfg([co(1, []), co(2, [])]),
      prelim([
        { id: 'a', label: 'A', maxScore: 10, coIds: ['co1', 'co2'], coWeights },
        { id: 'b', label: 'B', maxScore: 10, coIds: ['co1'] },
      ]),
      [{ id: 's', scores: { a: '10', b: '0' } }],
    );
    expect(co1(r).rawPct).toBe(pct);
  });

  it('stays exact over 120 columns split across 7 COs', () => {
    const cos = [1, 2, 3, 4, 5, 6, 7].map((n) => co(n, []));
    const coWeights = Object.fromEntries(cos.map((c, i) => [c.id, i + 4])); // 4..10, total 49
    const cols = (t: string) =>
      Array.from({ length: 40 }, (_, i) => ({ id: `${t}${i}`, label: `${t}${i}`, maxScore: 7, coIds: cos.map((c) => c.id), coWeights }));
    const terms: ObeTerms = { PRELIM: { columns: cols('p') }, MIDTERM: { columns: cols('m') }, FINAL: { columns: cols('f') } };
    const scores = Object.fromEntries(['p', 'm', 'f'].flatMap((t) => cols(t).map((c) => [c.id, '7'])));
    const r = computeObe(cfg(cos), terms, [{ id: 's', scores }]);
    for (const c of cos) expect(co1(r, 'OVERALL', c.id)).toMatchObject({ rawPct: 100, attained: true });
    expect(co1(r, 'OVERALL').rawMax).toBe(68.57); // 840 × 4/49 = 68.571…
  });
});

describe('computeObe — final review fixes', () => {
  const cfg = (cos: CourseOutcome[]): ObeConfig => ({ pos: [], cos, los: [] });

  it('does not attain when the shown % is below a three-decimal pass mark', () => {
    const r = computeObe(
      cfg([{ ...co(1, []), passRawPct: 64.154 }]),
      { PRELIM: { columns: [{ id: 'x', label: 'X', maxScore: 2000, coIds: ['co1'] }] }, MIDTERM: { columns: [] }, FINAL: { columns: [] } },
      [{ id: 's', scores: { x: '1283' } }], // 64.15% < 64.154%
    );
    expect(r.students[0]!.scopes.PRELIM.cos.co1).toMatchObject({ rawPct: 64.15, attained: false, lowColumns: ['X'] });
  });

  it('stays fast when every column has its own CO weights', () => {
    const cos = [co(1, []), co(2, []), co(3, [])];
    const cols = (t: string) =>
      Array.from({ length: 15 }, (_, i) => {
        const k = i + t.charCodeAt(0);
        return { id: `${t}${i}`, label: `${t}${i}`, maxScore: 37.5 + (i % 5) * 2.5, coIds: ['co1', 'co2', 'co3'], coWeights: { co1: 0.21 + (k % 37) / 100, co2: 0.3 + (k % 23) / 100, co3: 0.11 + (k % 19) / 100 } };
      });
    const terms: ObeTerms = { PRELIM: { columns: cols('p') }, MIDTERM: { columns: cols('m') }, FINAL: { columns: cols('f') } };
    const students = Array.from({ length: 50 }, (_, s) => ({
      id: `s${s}`,
      scores: Object.fromEntries(['p', 'm', 'f'].flatMap((t) => cols(t).map((c, i) => [c.id, String(((s * 7 + i * 3) % 75) / 2)]))),
    }));
    const start = performance.now();
    computeObe(cfg(cos), terms, students);
    expect(performance.now() - start).toBeLessThan(250); // ~430 ms when every sum was normalised with a gcd
  });
});
