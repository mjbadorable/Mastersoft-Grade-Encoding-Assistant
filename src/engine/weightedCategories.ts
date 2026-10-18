// Weighted categories inside Class Standing (D5, D24, D25).
import { GradeInputError } from './compute';
import { roundHalfUpDiv, toIntegerPair } from './rounding';

export interface CategoryScore {
  /** Category weight within Class Standing, in % (all categories add up to 100). */
  weightPct: number;
  raw: number;
  total: number;
}

/**
 * Converts weighted category scores into one CS mark out of 100. Mastersoft rounds
 * CS to a whole % anyway, so encoding round(weighted %) / 100 gives the same grade.
 */
export function weightedCategoriesMark(categories: CategoryScore[]): { mark: number; total: 100 } {
  if (categories.length === 0) throw new GradeInputError('Add at least one category');
  const weightSum = categories.reduce((sum, c) => sum + c.weightPct, 0);
  if (Math.abs(weightSum - 100) > 1e-9) throw new GradeInputError(`Category weights add up to ${weightSum}%, not 100%`);

  // Exact sum of weightPct × raw / total as one fraction (BigInt avoids overflow).
  let num = 0n;
  let den = 1n;
  for (const c of categories) {
    if (c.total <= 0) throw new GradeInputError('Total Marks must be greater than 0');
    if (c.raw < 0 || c.raw > c.total) throw new GradeInputError(`Marks ${c.raw} must be between 0 and ${c.total}`);
    const [r, t] = toIntegerPair(c.raw, c.total);
    const [w, one] = toIntegerPair(c.weightPct, 1);
    const n = BigInt(w) * BigInt(r);
    const d = BigInt(one) * BigInt(t);
    num = num * d + n * den;
    den = den * d;
  }
  const g = gcd(num, den);
  return { mark: roundHalfUpDiv(Number(num / g), Number(den / g)), total: 100 };
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}
