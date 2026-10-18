// Reverse mode (D11, D28): target Final Rating → marks to encode.
import { GradeInputError, pointGrade, transmute } from './compute';
import { rules } from './rules';

export type ReverseTarget =
  | { kind: 'transmuted'; grade: number }
  | { kind: 'point'; point: number; transmuted?: number };

export interface ReverseResult {
  /** Mark to encode for CS and WE in all 3 terms. */
  mark: number;
  /** Total Marks for CS and WE (default 100). */
  total: number;
  /** Transmuted grade the mark produces; also every term grade and the Final Rating. */
  transmuted: number;
}

/** Resolves a target to the transmuted Final Rating it means. */
export function targetTransmuted(target: ReverseTarget): number {
  if (target.kind === 'transmuted') {
    if (!Number.isInteger(target.grade) || target.grade < 60 || target.grade > 100) {
      throw new GradeInputError('Target grade must be a whole number from 60 to 100');
    }
    return target.grade;
  }
  if (target.point === rules.transcriptFailingPoint) {
    // 5.0 covers every grade below 75, so it needs an exact transmuted grade.
    const t = target.transmuted;
    if (t === undefined || !Number.isInteger(t) || t < 60 || t >= rules.passingGrade) {
      throw new GradeInputError('A 5.0 target needs an exact transmuted grade from 60 to 74');
    }
    return t;
  }
  // Several grades can share a point grade (e.g. 96 and 97 → 1.3); use the highest.
  for (let grade = 100; grade >= rules.passingGrade; grade--) {
    if (pointGrade(grade, 'transcript').point === target.point) return grade;
  }
  throw new GradeInputError(`Point grade ${target.point} is not a valid target (use 1.0–3.0 or 5.0)`);
}

/**
 * Same mark for CS and WE in every term, so each term grade and the Final Rating all
 * equal the target. When several marks give the target, the highest one is used,
 * as in the MLS Internship sheet.
 */
export function solveReverse(target: ReverseTarget): ReverseResult {
  const t = targetTransmuted(target);
  for (let pct = 100; pct >= 0; pct--) {
    if (transmute(pct) === t) return { mark: pct, total: 100, transmuted: t };
  }
  throw new GradeInputError(`No mark gives a transmuted grade of ${t}`);
}
