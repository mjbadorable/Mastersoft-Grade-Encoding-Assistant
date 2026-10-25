// Exact fractions for OBE math: no floating-point drift in splits, sums or rounding.
import { describe, expect, it } from 'vitest';
import { add, div, frac, fromDecimal, hundredthsOf, lcm, mul, roundToHundredths } from '../../src/engine/fraction';

describe('fraction', () => {
  it('normalises', () => {
    expect(frac(2n, 4n)).toEqual({ n: 1n, d: 2n });
    expect(frac(3n, -6n)).toEqual({ n: -1n, d: 2n });
    expect(() => frac(1n, 0n)).toThrow(RangeError);
  });

  it('reads decimals exactly', () => {
    expect(fromDecimal(0.1)).toEqual({ n: 1n, d: 10n });
    expect(fromDecimal(12)).toEqual({ n: 12n, d: 1n });
    expect(fromDecimal(64.15)).toEqual({ n: 1283n, d: 20n });
    expect(() => fromDecimal(NaN)).toThrow(RangeError);
    expect(() => fromDecimal(1e-7)).toThrow(RangeError);
  });

  it('adds, multiplies and divides exactly', () => {
    expect(add(fromDecimal(0.1), fromDecimal(0.2))).toEqual(fromDecimal(0.3));
    expect(add(frac(1n, 3n), frac(1n, 6n))).toEqual({ n: 1n, d: 2n });
    expect(mul(frac(2n, 3n), frac(3n, 4n))).toEqual({ n: 1n, d: 2n });
    expect(div(frac(1n, 3n), frac(2n, 3n))).toEqual({ n: 1n, d: 2n });
    expect(() => div(frac(1n), frac(0n))).toThrow(RangeError);
  });

  it('rounds percentages half-up in hundredths', () => {
    expect(hundredthsOf(frac(13n), frac(32n))).toBe(4063); // 40.625%
    expect(hundredthsOf(frac(5n), frac(32n))).toBe(1563); // 15.625%
    expect(hundredthsOf(frac(1283n), frac(2000n))).toBe(6415);
    expect(hundredthsOf(frac(1n, 3n), frac(1n))).toBe(3333);
    expect(hundredthsOf(frac(2n, 3n), frac(1n))).toBe(6667);
    expect(() => hundredthsOf(frac(1n), frac(0n))).toThrow(RangeError);
    expect(() => hundredthsOf(frac(-1n), frac(1n))).toThrow(RangeError);
  });

  it('finds the least common multiple', () => {
    expect(lcm(4n, 6n)).toBe(12n);
    expect(lcm(1n, 49n)).toBe(49n);
    expect(lcm(100n, 75n)).toBe(300n);
  });

  it('rounds to 2 decimals half-up', () => {
    expect(roundToHundredths(frac(13n, 3n))).toBe(4.33);
    expect(roundToHundredths(frac(1n, 200n))).toBe(0.01);
    expect(roundToHundredths(frac(32n, 3n))).toBe(10.67);
  });
});
