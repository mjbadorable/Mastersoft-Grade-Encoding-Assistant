// OBE attainment (docs/05, docs/06 Prompt A): direct CO/LO attainment, VPAA sheet, PO roll-up.
import { describe, expect, it } from 'vitest';
import {
  computeObe,
  OBE_PRESETS,
  OBE_SCOPES,
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
    const { config: hm5 } = OBE_PRESETS.HM5_HOSPITALITY;
    const sheet = vpaaSheet(hm5, [{ id: 'a', finalGrade: 75 }]);
    expect(sheet.weights.map((w) => w.loCount)).toEqual([36, 36, 36]);
    expect(Object.values(sheet.students[0]!.contributions!)).toEqual([25, 25, 25]);
  });
});

describe('OBE_PRESETS', () => {
  it.each(Object.entries(OBE_PRESETS))('%s links only to outcomes it defines', (_key, { config: preset }) => {
    const coIds = new Set(preset.cos.map((c) => c.id));
    const poCodes = new Set(preset.pos.map((p) => p.code));
    expect(new Set(preset.los.map((l) => l.id)).size).toBe(preset.los.length);
    expect(new Set(preset.los.map((l) => l.code)).size).toBe(preset.los.length);
    for (const l of preset.los) {
      expect(l.coIds.length).toBeGreaterThan(0);
      l.coIds.forEach((id) => expect(coIds.has(id)).toBe(true));
    }
    for (const c of preset.cos) c.poCodes.forEach((code) => expect(poCodes.has(code)).toBe(true));
  });

  it('follows the syllabi outline', () => {
    const { DEFAULT_3CO, HM5_HOSPITALITY, CPE122_DISCRETE_MATH } = OBE_PRESETS;
    expect(DEFAULT_3CO.config.cos.map((c) => c.code)).toEqual(['CO1', 'CO2', 'CO3']);
    expect(DEFAULT_3CO.config.pos.map((p) => p.code)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(HM5_HOSPITALITY.config.pos.map((p) => p.code)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    expect(HM5_HOSPITALITY.config.los).toHaveLength(36);
    expect(new Set(HM5_HOSPITALITY.config.los.map((l) => l.moduleCode))).toEqual(new Set(['M1', 'M2', 'M3', 'M4', 'M5', 'M6']));
    expect(CPE122_DISCRETE_MATH.config.cos.map((c) => c.code)).toEqual(['CO1', 'CO2', 'CO3', 'CO4']);
    expect(CPE122_DISCRETE_MATH.config.pos.map((p) => p.code)).toEqual(['a', 'm']);
    expect(new Set(CPE122_DISCRETE_MATH.config.los.map((l) => l.moduleCode)).size).toBe(8);
  });
});
