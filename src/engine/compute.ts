// Forward computation: raw marks → term grade → Final Rating (spec §1–§3).
import { BP, rules, type SubjectType, type Term } from './rules';
import { ceilDiv, roundHalfUpDiv, toIntegerPair } from './rounding';

export class GradeInputError extends Error {}

export interface ScaleResult {
  /** Scaled % in hundredths, as Mastersoft shows it (98.00% → 9800). */
  scaledHundredths: number;
  /** Scaled % rounded to a whole number (double rounding, D20). */
  roundedPct: number;
  /** True when rounding once instead of twice would give a different whole % (D20). */
  unverifiedBoundary: boolean;
}

/** Raw marks → scaled %. Mastersoft rejects an empty or zero Total Marks. */
export function scale(raw: number, total: number): ScaleResult {
  if (!Number.isFinite(raw) || !Number.isFinite(total)) throw new GradeInputError('Marks must be numbers');
  if (total <= 0) throw new GradeInputError('Total Marks must be greater than 0');
  if (raw < 0 || raw > total) throw new GradeInputError(`Marks ${raw} must be between 0 and ${total}`);
  const [r, t] = toIntegerPair(raw, total);
  const scaledHundredths = roundHalfUpDiv(r * 10000, t);
  const roundedPct = roundHalfUpDiv(scaledHundredths, 100);
  const singleRounded = roundHalfUpDiv(r * 100, t);
  return { scaledHundredths, roundedPct, unverifiedBoundary: singleRounded !== roundedPct };
}

const transmutationByPct = new Map(rules.transmutation.map((row) => [row.pct, row.transmuted]));

/** Whole % (0–100) → transmuted grade (60–100). */
export function transmute(pct: number): number {
  const t = transmutationByPct.get(pct);
  if (t === undefined) throw new GradeInputError(`No transmuted grade for ${pct}%`);
  return t;
}

export interface PointGrade {
  point: number;
  /** False for term point grades that haven't been confirmed in Mastersoft (D31, D32). */
  verified: boolean;
}

const termPoints = new Map(rules.termPointGrades.map((row) => [row.grade, row]));
const transcriptPoints = new Map(rules.transcriptPointGrades.map((row) => [row.grade, row.point]));

/** Grade (60–100) → point grade, from the term table or the transcript table (D19). */
export function pointGrade(grade: number, table: 'term' | 'transcript'): PointGrade {
  if (table === 'term') {
    const row = termPoints.get(grade);
    if (!row) throw new GradeInputError(`No term point grade for ${grade}`);
    return { point: row.point, verified: row.verified };
  }
  if (grade < rules.passingGrade) return { point: rules.transcriptFailingPoint, verified: true };
  const point = transcriptPoints.get(grade);
  if (point === undefined) throw new GradeInputError(`No transcript point grade for ${grade}`);
  return { point, verified: true };
}

/** Transmuted CS and WE → weighted scores and the rounded term grade. */
export function termGrade(csTransmuted: number, weTransmuted: number, subjectType: SubjectType) {
  const w = rules.weightBp[subjectType];
  const csWeightedBp = csTransmuted * w.cs;
  const weWeightedBp = weTransmuted * w.we;
  return {
    csWeighted: csWeightedBp / BP,
    weWeighted: weWeightedBp / BP,
    grade: roundHalfUpDiv(csWeightedBp + weWeightedBp, BP),
  };
}

export interface ComponentResult extends ScaleResult {
  raw: number;
  total: number;
  transmuted: number;
  weighted: number;
  /** Scaled % below 38: whole-number transmutation range not yet verified (D30). */
  unverifiedLowPct: boolean;
}

export interface TermResult {
  subjectType: SubjectType;
  cs: ComponentResult;
  we: ComponentResult;
  termGrade: number;
  termPointGrade: PointGrade;
  /** Human-readable step trace for the breakdown drawer. */
  trace: string[];
}

export interface TermInput {
  subjectType: SubjectType;
  cs: { raw: number; total: number };
  we: { raw: number; total: number };
}

const fmt2 = (x: number) => x.toFixed(2);

/** One student, one term: the full pipeline with a step trace. */
export function computeTerm(input: TermInput): TermResult {
  const csScale = scale(input.cs.raw, input.cs.total);
  const weScale = scale(input.we.raw, input.we.total);
  const csT = transmute(csScale.roundedPct);
  const weT = transmute(weScale.roundedPct);
  const tg = termGrade(csT, weT, input.subjectType);
  const w = rules.weightBp[input.subjectType];

  const component = (s: ScaleResult, io: { raw: number; total: number }, t: number, weighted: number): ComponentResult => ({
    ...s,
    raw: io.raw,
    total: io.total,
    transmuted: t,
    weighted,
    unverifiedLowPct: s.roundedPct < rules.unverifiedBelowPct,
  });
  const cs = component(csScale, input.cs, csT, tg.csWeighted);
  const we = component(weScale, input.we, weT, tg.weWeighted);
  const step = (label: string, c: ComponentResult, wBp: number) =>
    `${label}: ${c.raw} / ${c.total} → ${fmt2(c.scaledHundredths / 100)}% → ${c.roundedPct} → T ${c.transmuted} → × ${fmt2(wBp / BP)} = ${fmt2(c.weighted)}`;
  const point = pointGrade(tg.grade, 'term');

  return {
    subjectType: input.subjectType,
    cs,
    we,
    termGrade: tg.grade,
    termPointGrade: point,
    trace: [
      step('Class Standing', cs, w.cs),
      step('Written Exam', we, w.we),
      `Term grade: ${fmt2(cs.weighted)} + ${fmt2(we.weighted)} = ${fmt2(cs.weighted + we.weighted)} → ${tg.grade} → ${point.point.toFixed(1)}`,
    ],
  };
}

export interface FinalRatingResult {
  /** Exact weighted sum before rounding, e.g. 84.6. */
  raw: number;
  grade: number;
  point: PointGrade;
}

/** 20% Prelim + 30% Midterm + 50% Final of the rounded term grades, rounded half-up (D2). */
export function finalRating(prelim: number, midterm: number, final: number): FinalRatingResult {
  const s = rules.finalRatingBp;
  const sumBp = prelim * s.PRELIM + midterm * s.MIDTERM + final * s.FINAL;
  const grade = roundHalfUpDiv(sumBp, BP);
  return { raw: sumBp / BP, grade, point: pointGrade(grade, 'transcript') };
}

export type MinFinalNeeded =
  | { kind: 'impossible' }
  | { kind: 'any' }
  | { kind: 'value'; grade: number };

/** Lowest Final term grade that still gives a Final Rating of 75 (D26). */
export function minFinalNeeded(prelim: number, midterm: number): MinFinalNeeded {
  const s = rules.finalRatingBp;
  // FR rounds half-up, so the weighted sum must reach passingGrade - 0.5.
  const targetBp = (rules.passingGrade * 2 - 1) * (BP / 2);
  const needed = ceilDiv(targetBp - prelim * s.PRELIM - midterm * s.MIDTERM, s.FINAL);
  if (needed > 100) return { kind: 'impossible' };
  if (needed < 60) return { kind: 'any' };
  return { kind: 'value', grade: needed };
}

export const TERMS: Term[] = ['PRELIM', 'MIDTERM', 'FINAL'];
