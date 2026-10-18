// Exact half-up rounding (D21). Every rounding step in the engine goes through
// these helpers, so an exact .5 is never stored as .4999… and rounded down.

/** Number of decimal places in a finite number's shortest representation. */
function decimalsOf(x: number): number {
  const s = String(x);
  if (s.includes('e')) throw new RangeError(`Number out of supported range: ${x}`);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * Turns `a` and `b` into integers with the same scale factor, so a / b is exact.
 * E.g. (49.5, 50) → [495, 500].
 */
export function toIntegerPair(a: number, b: number): [number, number] {
  const f = 10 ** Math.max(decimalsOf(a), decimalsOf(b));
  return [Math.round(a * f), Math.round(b * f)];
}

/** round(n / d) with .5 going up. `n` ≥ 0 and `d` > 0 must be integers. */
export function roundHalfUpDiv(n: number, d: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(d) || n < 0 || d <= 0) {
    throw new RangeError(`roundHalfUpDiv expects integers n >= 0, d > 0 (got ${n}, ${d})`);
  }
  return Math.floor((2 * n + d) / (2 * d));
}

/** Rounds a non-negative decimal number half-up to `dp` decimal places. */
export function roundHalfUp(value: number, dp = 0): number {
  if (value < 0) throw new RangeError(`roundHalfUp expects a non-negative value (got ${value})`);
  const [n, d] = toIntegerPair(value, 1);
  return roundHalfUpDiv(n * 10 ** dp, d) / 10 ** dp;
}

/** ceil(n / d) for integers, any sign of n, d > 0. */
export function ceilDiv(n: number, d: number): number {
  return Math.ceil(n / d);
}

/**
 * Exact sum of marks (e.g. the CS columns of a term), so 0.1 + 0.2 gives 0.3 and not
 * 0.30000000000000004, which would break the integer scaling in `scale`.
 */
export function sumMarks(marks: number[]): number {
  const f = 10 ** Math.max(0, ...marks.map(decimalsOf));
  return marks.reduce((sum, m) => sum + Math.round(m * f), 0) / f;
}
