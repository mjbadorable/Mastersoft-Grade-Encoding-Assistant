// Golden tests from the two fixture files (blueprint §11). A failure here means
// the engine no longer reproduces real Mastersoft or sheet results.
import { describe, expect, it } from 'vitest';
import reports from '../fixtures/mastersoft-grade-reports.json';
import sheet from '../fixtures/mls-internship-sheet.json';
import { computeTerm, finalRating, pointGrade, solveReverse, termGrade, type SubjectType } from '../../src/engine';

describe('Mastersoft grade reports (GE 6, EE 231a, EE 231)', () => {
  for (const subject of reports.subjects) {
    const type = subject.subjectType as SubjectType;
    describe(subject.subjectCode, () => {
      for (const [termName, t] of Object.entries(subject.terms)) {
        it(`${termName}: weighted scores, term grade and point grade`, () => {
          const result = termGrade(t.csTransmuted, t.weTransmuted, type);
          expect(result.csWeighted).toBeCloseTo(t.csWeighted, 10);
          expect(result.weWeighted).toBeCloseTo(t.weWeighted, 10);
          expect(result.grade).toBe(t.termGrade);
          expect(pointGrade(result.grade, 'term').point).toBe(t.termPointGrade);
        });
      }

      it('Final Rating', () => {
        const { prelim, midterm, final } = subject.terms;
        const fr = finalRating(prelim.termGrade, midterm.termGrade, final.termGrade);
        expect(fr.raw).toBeCloseTo(subject.finalRating.raw, 10);
        expect(fr.grade).toBe(subject.finalRating.grade);
        expect(fr.point.point).toBe(subject.finalRating.pointGrade);
      });
    });
  }
});

describe('MLS Internship sheet', () => {
  for (const [type, subject] of Object.entries(sheet.subjects)) {
    describe(type, () => {
      it('Mastersoft reference row (88/100 → 93 → 1.6)', () => {
        const ref = subject.mastersoftReference;
        const result = computeTerm({
          subjectType: type as SubjectType,
          cs: { raw: ref.csMark, total: ref.csTotal },
          we: { raw: ref.weMark, total: ref.weTotal },
        });
        expect(result.cs.transmuted).toBe(ref.csTransmuted);
        expect(result.we.transmuted).toBe(ref.weTransmuted);
        expect(result.cs.weighted).toBeCloseTo(ref.csWeighted, 10);
        expect(result.we.weighted).toBeCloseTo(ref.weWeighted, 10);
        expect(result.termGrade).toBe(ref.termGrade);
        expect(result.termPointGrade.point).toBe(ref.termPointGrade);
      });

      for (const st of subject.students) {
        it(`${st.id}: forward and reverse (target ${st.targetFR})`, () => {
          const { cs, we, total } = st.markPerTerm;
          const term = computeTerm({ subjectType: type as SubjectType, cs: { raw: cs, total }, we: { raw: we, total } });
          expect(term.cs.transmuted).toBe(st.expected.transmuted);
          expect(term.termGrade).toBe(st.expected.termGrade);
          expect(term.termPointGrade.point).toBe(st.expected.termPointGrade);

          const fr = finalRating(term.termGrade, term.termGrade, term.termGrade);
          expect(fr.grade).toBe(st.expected.finalRating);
          expect(fr.point.point).toBe(st.expected.frPointGrade);

          expect(solveReverse({ kind: 'transmuted', grade: st.targetFR })).toEqual({
            mark: cs,
            total,
            transmuted: st.expected.transmuted,
          });
        });
      }
    });
  }
});
