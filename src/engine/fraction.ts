// Exact fractions (BigInt numerator / denominator) for OBE math, so splitting a column
// across COs (1/3, 3/97, ...) and summing it never drifts, and an exact .xx5 is never
// rounded down. Only the final shown values are rounded, half-up like the grade engine (D21).
import { toIntegerPair } from './rounding';

export interface Fraction {
  readonly n: bigint;
  /** Always > 0, with gcd(|n|, d) = 1. */
  readonly d: bigint;
}

const abs = (x: bigint) => (x < 0n ? -x : x);

function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/** Least common multiple of two positive integers. */
export const lcm = (a: bigint, b: bigint) => (a / gcd(a, b)) * b;

export function frac(n: bigint, d = 1n): Fraction {
  if (d === 0n) throw new RangeError('Fraction denominator must not be 0');
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d);
  return g > 1n ? { n: n / g, d: d / g } : { n, d };
}

/** The exact value of a number's shortest decimal form: 0.1 → 1/10, 64.15 → 1283/20. */
export function fromDecimal(x: number): Fraction {
  if (!Number.isFinite(x)) throw new RangeError(`Not a finite number: ${x}`);
  const [n, d] = toIntegerPair(x, 1); // throws RangeError for exponent form
  return frac(BigInt(n), BigInt(d));
}

export const add = (a: Fraction, b: Fraction) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const mul = (a: Fraction, b: Fraction) => frac(a.n * b.n, a.d * b.d);

export function div(a: Fraction, b: Fraction): Fraction {
  if (b.n === 0n) throw new RangeError('Division by zero');
  return frac(a.n * b.d, a.d * b.n);
}

/** part / whole as a % in hundredths, rounded half-up: 13/32 → 4063 (40.625% → 40.63%). */
export function hundredthsOf(part: Fraction, whole: Fraction): number {
  if (part.n < 0n || whole.n <= 0n) throw new RangeError('hundredthsOf expects part >= 0 and whole > 0');
  const num = part.n * whole.d * 10000n;
  const den = part.d * whole.n;
  return Number((2n * num + den) / (2n * den));
}

/** A non-negative fraction rounded half-up to 2 decimals: 13/3 → 4.33. */
export const roundToHundredths = (f: Fraction) => hundredthsOf(f, frac(100n)) / 100;
