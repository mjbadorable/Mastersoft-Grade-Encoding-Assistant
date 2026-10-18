// Edge cases from blueprint §11 and the decision log (D19–D33).
import { describe, expect, it } from 'vitest';
import {
  computeTerm,
  finalRating,
  finalRatingStatus,
  GradeInputError,
  minFinalNeeded,
  pointGrade,
  roundHalfUp,
  rules,
  scale,
  solveReverse,
  sumMarks,
  termGrade,
  transmute,
  weightedCategoriesMark,
  withCarryForward,
} from '../../src/engine';

describe('roundHalfUp (D21)', () => {
  it('rounds exact .5 up, including values floats store as .4999…', () => {
    expect(roundHalfUp(84.5)).toBe(85);
    expect(roundHalfUp(72.5)).toBe(73);
    expect(roundHalfUp(1.005, 2)).toBe(1.01); // 1.005 is 1.00499999… as a float
    expect(roundHalfUp(84.49)).toBe(84);
  });
});

describe('sumMarks', () => {
  it('adds decimal marks exactly', () => {
    expect(sumMarks([0.1, 0.2])).toBe(0.3);
    expect(sumMarks([20, 18.5, 9.25])).toBe(47.75);
    expect(sumMarks([])).toBe(0);
  });
});

describe('scale', () => {
  it('matches the Grade Encoding screen (49/50 → 98.00)', () => {
    expect(scale(49, 50)).toEqual({ scaledHundredths: 9800, roundedPct: 98, unverifiedBoundary: false });
  });

  it('reproduces the spec §1 examples', () => {
    // 92.78 → 93 → 96; 90.56 → 91 → 94; 86.67 → 87 → 92
    expect(scale(167, 180).scaledHundredths).toBe(9278);
    expect(transmute(scale(167, 180).roundedPct)).toBe(96);
    expect(scale(163, 180).scaledHundredths).toBe(9056);
    expect(transmute(scale(163, 180).roundedPct)).toBe(94);
    expect(scale(26, 30).scaledHundredths).toBe(8667);
    expect(transmute(scale(26, 30).roundedPct)).toBe(92);
  });

  it('supports Total Marks that are not multiples of 5, and decimal marks', () => {
    expect(scale(41, 47).scaledHundredths).toBe(8723);
    expect(scale(49.5, 50).roundedPct).toBe(99);
  });

  it('flags the double-rounding boundary x.495–x.499 (D20)', () => {
    // 8949.6/10000 → 89.496% → 89.50 → 90 (single rounding would give 89)
    const s = scale(89496, 100000);
    expect(s.roundedPct).toBe(90);
    expect(s.unverifiedBoundary).toBe(true);
    // 89.5% exactly: both roundings give 90
    expect(scale(179, 200).unverifiedBoundary).toBe(false);
  });

  it('rejects invalid input', () => {
    expect(() => scale(10, 0)).toThrow(GradeInputError);
    expect(() => scale(51, 50)).toThrow(GradeInputError);
    expect(() => scale(-1, 50)).toThrow(GradeInputError);
    expect(() => scale(Number.NaN, 50)).toThrow(GradeInputError);
  });

  it('handles 0 and perfect scores', () => {
    expect(transmute(scale(0, 50).roundedPct)).toBe(60);
    expect(transmute(scale(50, 50).roundedPct)).toBe(100);
  });
});

describe('transmutation table', () => {
  it('covers every whole % from 0 to 100', () => {
    for (let pct = 0; pct <= 100; pct++) expect(transmute(pct)).toBeGreaterThanOrEqual(60);
    expect(() => transmute(101)).toThrow(GradeInputError);
  });

  it('uses whole-number ranges below 38% (D30)', () => {
    expect([37, 36, 35, 34].map(transmute)).toEqual([69, 69, 69, 69]);
    expect([1, 0].map(transmute)).toEqual([60, 60]);
  });

  it('never decreases as the % goes up', () => {
    for (let pct = 1; pct <= 100; pct++) expect(transmute(pct)).toBeGreaterThanOrEqual(transmute(pct - 1));
  });
});

describe('point grades (D19, D31, D32)', () => {
  it('uses the term table below 75, with only 70 and 73 verified', () => {
    expect(pointGrade(73, 'term')).toEqual({ point: 3.2, verified: true });
    expect(pointGrade(70, 'term')).toEqual({ point: 3.7, verified: true });
    expect(pointGrade(74, 'term')).toEqual({ point: 3.1, verified: false });
    expect(pointGrade(67, 'term')).toEqual({ point: 4.1, verified: false });
    expect(pointGrade(60, 'term')).toEqual({ point: 5.0, verified: false });
  });

  it('uses 5.0 below 75 on the transcript', () => {
    expect(pointGrade(74, 'transcript').point).toBe(5.0);
    expect(pointGrade(75, 'transcript').point).toBe(3.0);
  });

  it('has a term point grade for every grade from 60 to 100', () => {
    for (let g = 60; g <= 100; g++) expect(() => pointGrade(g, 'term')).not.toThrow();
  });
});

describe('computeTerm', () => {
  it('builds the breakdown trace', () => {
    const r = computeTerm({ subjectType: 'LEC', cs: { raw: 48, total: 50 }, we: { raw: 45, total: 50 } });
    expect(r.trace[0]).toBe('Class Standing: 48 / 50 → 96.00% → 96 → T 98 → × 0.50 = 49.00');
    expect(r.termGrade).toBe(96);
  });

  it('flags CS/WE scores below 38% (D30)', () => {
    const r = computeTerm({ subjectType: 'LAB', cs: { raw: 50, total: 50 }, we: { raw: 7, total: 50 } });
    expect(r.we.unverifiedLowPct).toBe(true);
    expect(r.cs.unverifiedLowPct).toBe(false);
  });

  it('uses composite weights 33.33 / 66.67', () => {
    // 90 × 0.3333 + 80 × 0.6667 = 83.333 → 83
    expect(termGrade(90, 80, 'COMPOSITE').grade).toBe(83);
  });
});

describe('finalRating', () => {
  it('rounds 84.6 up to 85 (EE 231a), not down', () => {
    expect(finalRating(89, 91, 79)).toMatchObject({ grade: 85, point: { point: 2.2 } });
  });

  it('gives 5.0 below 75', () => {
    expect(finalRating(70, 70, 74)).toMatchObject({ grade: 72, point: { point: 5.0 } });
  });
});

describe('minFinalNeeded (D26)', () => {
  it('returns the lowest passing Final term grade', () => {
    // 0.2·70 + 0.3·73 = 35.9 → Final needs (74.5 − 35.9) / 0.5 = 77.2 → 78
    expect(minFinalNeeded(70, 73)).toEqual({ kind: 'value', grade: 78 });
    expect(finalRating(70, 73, 78).grade).toBe(75);
    expect(finalRating(70, 73, 77).grade).toBe(74);
  });

  it('says when passing is already safe', () => {
    expect(minFinalNeeded(100, 100)).toEqual({ kind: 'any' }); // needs 49
  });

  it('never needs more than 100: the lowest term grades (60, 60) still pass with a Final of 89', () => {
    expect(minFinalNeeded(60, 60)).toEqual({ kind: 'value', grade: 89 });
  });
});

describe('solveReverse (D11, D28)', () => {
  it('picks the highest mark for a transmuted target', () => {
    expect(solveReverse({ kind: 'transmuted', grade: 93 })).toEqual({ mark: 89, total: 100, transmuted: 93 });
  });

  it('reproduces the target through forward mode for every grade 60–100', () => {
    for (let g = 60; g <= 100; g++) {
      const { mark } = solveReverse({ kind: 'transmuted', grade: g });
      for (const type of ['LEC', 'LAB', 'COMPOSITE'] as const) {
        const term = computeTerm({ subjectType: type, cs: { raw: mark, total: 100 }, we: { raw: mark, total: 100 } });
        expect(finalRating(term.termGrade, term.termGrade, term.termGrade).grade).toBe(g);
      }
    }
  });

  it('accepts point-grade targets 1.0–3.0, and 5.0 only with a transmuted grade', () => {
    expect(solveReverse({ kind: 'point', point: 1.3 }).transmuted).toBe(97);
    expect(solveReverse({ kind: 'point', point: 3.0 }).transmuted).toBe(75);
    expect(solveReverse({ kind: 'point', point: 5.0, transmuted: 72 }).transmuted).toBe(72);
    expect(() => solveReverse({ kind: 'point', point: 5.0 })).toThrow(GradeInputError);
    expect(() => solveReverse({ kind: 'point', point: 3.5 })).toThrow(GradeInputError);
    expect(() => solveReverse({ kind: 'transmuted', grade: 59 })).toThrow(GradeInputError);
  });
});

describe('statuses (D23)', () => {
  it('carries DRP and WP forward, but not other statuses', () => {
    expect(withCarryForward({ MIDTERM: 'DRP' })).toEqual({ MIDTERM: 'DRP', FINAL: 'DRP' });
    expect(withCarryForward({ PRELIM: 'INC' })).toEqual({ PRELIM: 'INC' });
  });

  it('shows the most serious status on the Final Rating', () => {
    expect(finalRatingStatus({ PRELIM: 'ABS', FINAL: 'INC' })).toBe('INC');
    expect(finalRatingStatus({ PRELIM: 'HNA', MIDTERM: 'WP' })).toBe('WP');
    expect(finalRatingStatus({})).toBeUndefined();
  });

  it('follows the priority order in the rules file', () => {
    expect(rules.statusPriority).toEqual(['DRP', 'WP', 'INC', 'HNA', 'ABS']);
  });
});

describe('weightedCategoriesMark (D24)', () => {
  it('converts weighted categories to a whole mark out of 100', () => {
    // Quiz 40% at 45/50 (90%) + Activity 60% at 70/100 (70%) = 36 + 42 = 78
    expect(weightedCategoriesMark([
      { weightPct: 40, raw: 45, total: 50 },
      { weightPct: 60, raw: 70, total: 100 },
    ])).toEqual({ mark: 78, total: 100 });
  });

  it('rounds .5 up exactly', () => {
    // 50% × 1/4 + 50% × 4/4 = 12.5 + 50 = 62.5 → 63
    expect(weightedCategoriesMark([
      { weightPct: 50, raw: 1, total: 4 },
      { weightPct: 50, raw: 4, total: 4 },
    ]).mark).toBe(63);
  });

  it('rejects weights that do not add up to 100', () => {
    expect(() => weightedCategoriesMark([{ weightPct: 90, raw: 1, total: 1 }])).toThrow(GradeInputError);
  });
});
