# Engineering Baseline & OBE Precision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Commit the reviewed OBE work as a milestone, add ESLint + `ARCHITECTURE.md`, then make every OBE percentage exact (no floating-point rounding).

**Architecture:** The app stays local-only (Dexie/IndexedDB, no auth, Firebase Hosting only). OBE stays a pure, read-only layer over the gradebook in `src/engine/obe.ts`; the Mastersoft grade engine (`compute.ts`, `rounding.ts`, `rules.v1.json`) is not touched. The precision fix adds a small exact-fraction module (`src/engine/fraction.ts`, BigInt numerator/denominator) and routes all OBE splitting, summing and rounding through it.

**Tech Stack:** React 19, TypeScript, Vite 8, Vitest 5, Zustand, Dexie 4; adds ESLint 10 + typescript-eslint 8.

**Spec:** Marvin's decisions of 2026-10-25 (copied into Global Constraints below). OBE background: `docs/05_obe_integration_blueprint.md`, `docs/06_claude_codebase_obe_prompts.md`. Grade rounding rule: decision D21 in `docs/02_project_blueprint.md`.

## Global Constraints

- Local-only: "Do NOT add Firebase Auth or Firestore. Respect decisions D9 and D16 and RA 10173." No new network calls, no new CSP sources in `firebase.json`.
- Do not change grade engine behaviour: `tests/engine/engine.test.ts`, `tests/engine/fixtures.test.ts` and `tests/requirements/usa-test-cases.test.ts` must pass unmodified.
- Rounding is half-up (D21), on exact values. No `Math.round` on a float product/quotient anywhere in OBE math.
- OBE semantics kept as today: a student attains an outcome when the **2-decimal raw %** (the value shown) is ≥ the pass mark; class `meanRawPct` is the mean of the shown 2-decimal values; VPAA and PO roll-up formulas unchanged.
- TDD for all calculation logic: failing test first, run it, see it fail for the stated reason, then implement.
- Pin dependency versions exactly (the repo already pins `typescript` and `vitest`).
- Work on branch `obe-engine`; never commit to `main`.
- Every task ends with: `npm test`, `npm run build`, and (from Task 2 on) `npm run lint`, all passing.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decision needed before Task 2 (blocking)

typescript-eslint 8.72.0 (latest) requires `typescript >=4.8.4 <6.1.0`; the repo uses `typescript@7.0.2`, which no longer ships the JavaScript compiler API that typescript-eslint loads. A side-by-side TS 6 install is not possible (it is a peer dependency; npm refuses the install). Verified on 2026-10-25: the project type-checks cleanly with `typescript@6.0.3` (exit 0, ~3.8 s vs ~1.1 s on 7.0.2).

- **Option A (recommended): pin `typescript` to `6.0.3`.** Keeps "ESLint with typescript-eslint" as requested, including type-aware rules such as `no-floating-promises` (catches unawaited saves). Move back to 7 when typescript-eslint supports it.
- **Option B: keep TS 7 and use oxlint instead of ESLint.** Faster and TS-7 native, but not what was asked for and a different rule set.

Task 2 below is written for Option A.

## Review Focus

1. A score typed in exponent form or with many decimals (`0.0000001`, `1e-7`) must be skipped like any invalid score. The exact-fraction parser must not crash the OBE dashboard. → test in Task 5.
2. A two-decimal pass mark (e.g. 64.15%) where the student scores exactly 64.15% must count as attained, and the column must not be listed as low (`64.15 * 100` is `6415.000000000001` in JS). → test in Task 5.
3. CO weights that are missing, zero, negative or `NaN` must not crash and must follow one rule: invalid counts as 0, all-zero means an equal split. → test in Task 5.
4. Weights entered as ratios (`0.03 / 0.97`) and as points (`3 / 97`) must give identical results. → test in Task 5.
5. A large class record (120 columns, each split across 7 COs with uneven weights) must stay exact. BigInt denominators must not blow up. → test in Task 5, plus normalisation tests in Task 4.

---

### Task 1: Review and commit the uncommitted OBE work (milestone)

**Files:**
- Review: `src/app/obe.ts`, `src/app/syllabusReader.ts`, `src/components/ObeDashboard.tsx`, and the modified `src/App.tsx`, `src/components/{BreakdownDrawer,ColumnDialogs,GradebookGrid,Sidebar,TermGradebook}.tsx`, `src/engine/obe.ts` (`syllabusFileName`, `syllabusUploadedAt`), `package.json` and `package-lock.json` (adds `pdfjs-dist@6.4.299`), `docs/07_client_side_pdf_syllabus_prompt.md`
- Tests: `tests/app/obe.test.ts`, `tests/app/syllabusReader.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: one commit containing all the files above. Later tasks build on that commit.

- [ ] **Step 1: Run the `code-review` skill (level `medium`) on the uncommitted working tree.**
- [ ] **Step 2: Triage the findings.** Fix confirmed correctness bugs that take under ~20 lines, each with a regression test when it is logic in `src/app` or `src/engine`. List anything larger for Marvin instead of fixing it.
- [ ] **Step 3: Privacy check.** `grep` the new test files and `docs/07` for real student names or IDs from `docs/source/` (that folder is gitignored under D29). Expected: none.
- [ ] **Step 4: Browser check of the production build.** Run `npm run build` and `npm run preview`; `preview` sends the same CSP as Firebase. With Playwright:
  - open the app;
  - create a class and add one column;
  - open the OBE view and apply the `DEFAULT_3CO` preset;
  - tag the column with CO1 and enter a score.

  Expected: the dashboard shows CO1 attainment, and the console has no errors, including no CSP violations from the pdf.js worker.
- [ ] **Step 5: Verify.** Run `npm test` and `npm run build`. Expected: all tests pass (≥197) and the build succeeds.
- [ ] **Step 6: Commit.**

```bash
git add src/app/obe.ts src/app/syllabusReader.ts src/components/ObeDashboard.tsx src/App.tsx \
  src/components/BreakdownDrawer.tsx src/components/ColumnDialogs.tsx src/components/GradebookGrid.tsx \
  src/components/Sidebar.tsx src/components/TermGradebook.tsx src/engine/obe.ts package.json package-lock.json \
  tests/app/obe.test.ts tests/app/syllabusReader.test.ts docs/07_client_side_pdf_syllabus_prompt.md
git commit -m "Add OBE dashboard, syllabus PDF reader and CO tagging"
```

### Task 2: ESLint with typescript-eslint

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json` (devDependencies, `scripts.lint`, `scripts.deploy`), `package-lock.json`
- Modify: any source file with a genuine lint finding

**Interfaces:**
- Produces: `npm run lint`, which exits 0 with zero errors. Every later task runs it.

- [ ] **Step 1: Install exact versions.**

```bash
npm.cmd install --save-exact -D typescript@6.0.3 eslint@10.13.0 @eslint/js@10.0.1 typescript-eslint@8.72.0 eslint-plugin-react-hooks@7.1.1 globals@17.13.0
```

- [ ] **Step 2: Write `eslint.config.js`** (flat config, ESM) with these settings:
  - **Ignores:** `dist/`, `node_modules/`, `docs/`, `.playwright-mcp/`.
  - **All files:** `@eslint/js` `recommended`.
  - **`**/*.{ts,tsx}`:** `tseslint.configs.recommendedTypeChecked`, with `parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }`.
  - **`src/**`:** `globals.browser`.
  - **`tests/**` and `vite.config.ts`:** `globals.node`.
  - **`src/sw.js`:** `globals.serviceworker`, plus `tseslint.configs.disableTypeChecked`.
  - **`src/**/*.tsx`:** the `react-hooks` plugin, registered manually, with only `react-hooks/rules-of-hooks: 'error'` and `react-hooks/exhaustive-deps: 'warn'`. Not the plugin's full preset: the v7 preset adds React Compiler rules this project doesn't use.
- [ ] **Step 3: Add scripts.** Set `"lint": "eslint ."`, and change `deploy` to `"npm test && npm run lint && npm run build && npx --yes firebase-tools@15 deploy --only hosting"`.
- [ ] **Step 4: Run `npm run lint` and record the counts per rule.** If there are more than 40 errors, stop and send Marvin the per-rule counts before fixing anything.
- [ ] **Step 5: Fix the findings.**
  - Fix real issues in code: an unawaited promise gets `await` or `void` plus handling; remove unused variables.
  - Turn a rule off only where the pattern is deliberate. Do it in `eslint.config.js`, with a one-line comment saying why. Never use blanket `eslint-disable` file headers.
- [ ] **Step 6: Verify.** `npm run lint` shows 0 errors (warnings allowed but listed in the commit message). `npm run typecheck`, `npm test` and `npm run build` all pass.
- [ ] **Step 7: Commit.** Message: `Add ESLint with typescript-eslint; pin TypeScript 6.0.3 for lint support`.

### Task 3: ARCHITECTURE.md

**Files:**
- Create: `ARCHITECTURE.md` (repo root)
- Modify: `README.md` (add one line linking to it)

**Interfaces:**
- Produces: the section headings that Task 5 and future changes update, exactly as listed: `## Overview`, `## Layers`, `## Storage schema`, `## Data flows`, `### Flow 1: Editing a score`, `### Flow 2: Computing grades`, `### Flow 3: OBE attainment`, `## Precision rules`, `## Tooling`.

- [ ] **Step 1: Write `## Overview` and `## Layers`.**
  - State that the app is local-only, citing D9, D16 and RA 10173.
  - Layers: UI (`src/components`) → state (`src/app/store.ts`) → persistence (`src/app/saveQueue.ts`, `src/app/db.ts`) → pure engine (`src/engine`) → file I/O (`mastersoftFile.ts`, `excelImport.ts`, `encodingGuide.ts`, `syllabusReader.ts`, `backup.ts`).
- [ ] **Step 2: Write `## Storage schema`.** Cover:
  - Dexie database `mastersoft-grade-encoding`, version 1, with tables `classes: 'id, updatedAt'` and `meta: 'key'`;
  - the `ClassRecord` shape from `src/app/types.ts`;
  - that computed grades are never stored.
- [ ] **Step 3: Write each of the three flows.** Each one gets a Mermaid diagram and exactly four bullets: User Action → Component → Service (Dexie / engine) → State Update.
  - **Flow 1, editing a score:** `GradebookGrid` → `setScore` → `SaveQueue` → `classStorage.apply` (one transaction) → BroadcastChannel.
  - **Flow 2, computing grades:** a render reads the record → `src/engine/compute.ts` → `TermGradebook` / `FinalRatingSummary`.
  - **Flow 3, OBE attainment:**
    - syllabus PDF → `syllabusReader.ts` → `setObeConfig`;
    - column CO tags → `src/app/obe.ts` `obeReport` / `vpaaForRecord` → `engine/obe.ts` `computeObe` / `vpaaSheet` / `poRollup` → `ObeDashboard`.
- [ ] **Step 4: Write `## Precision rules` and `## Tooling`.**
  - **Precision rules:** describe the current state (grade engine exact, OBE uses floats). Task 5 rewrites this section.
  - **Tooling:** list the commands `dev`, `test`, `lint`, `typecheck`, `build`, `deploy`, and the TypeScript 6.0.3 pin with the reason for it.
- [ ] **Step 5: Verify.** Diagrams render: check with the Mermaid live editor or GitHub preview. Every file path mentioned exists (`ls` each one).
- [ ] **Step 6: Commit.** Message: `Add ARCHITECTURE.md`.

### Task 4: Exact fraction module

**Files:**
- Create: `src/engine/fraction.ts`
- Test: `tests/engine/fraction.test.ts`

**Interfaces:**
- Consumes: `toIntegerPair(a, b)` from `src/engine/rounding.ts`, unchanged. `toIntegerPair(x, 1)` returns `[numerator, 10^decimals]`.
- Produces (all exported from `src/engine/fraction.ts`; not re-exported from `src/engine/index.ts`):
  - `interface Fraction { readonly n: bigint; readonly d: bigint }`: always normalised, meaning `gcd(|n|, d) = 1` and `d > 0n`.
  - `frac(n: bigint, d?: bigint): Fraction`: `d` defaults to `1n`; throws `RangeError` when `d === 0n`.
  - `fromDecimal(x: number): Fraction`: exact value of the number's shortest decimal form; throws `RangeError` for non-finite values or exponent form.
  - `add(a, b)`, `mul(a, b)`, `div(a, b)`, each `(Fraction, Fraction) => Fraction`. `div` throws `RangeError` when dividing by zero.
  - `hundredthsOf(part: Fraction, whole: Fraction): number`: `part / whole × 10000`, rounded half-up to an integer. Throws `RangeError` if `part < 0` or `whole <= 0`.
  - `roundToHundredths(f: Fraction): number`: `f` rounded half-up to 2 decimals, as a number. Requires `f >= 0`.

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, expect, it } from 'vitest';
import { add, div, frac, fromDecimal, hundredthsOf, mul, roundToHundredths } from '../../src/engine/fraction';

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
  it('rounds to 2 decimals half-up', () => {
    expect(roundToHundredths(frac(13n, 3n))).toBe(4.33);
    expect(roundToHundredths(frac(1n, 200n))).toBe(0.01);
    expect(roundToHundredths(frac(32n, 3n))).toBe(10.67);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/engine/fraction.test.ts`. Expected: FAIL, because `src/engine/fraction.ts` can't be resolved yet.
- [ ] **Step 3: Implement `src/engine/fraction.ts`.**
  - Normalise in `frac` with a BigInt `gcd`.
  - `fromDecimal(x)` checks `Number.isFinite`, then uses `const [n, d] = toIntegerPair(x, 1)` and returns `frac(BigInt(n), BigInt(d))`. `toIntegerPair` already throws `RangeError` for exponent form.
  - `hundredthsOf` returns `Number((2n * p.n * w.d * 10000n + q) / (2n * q))`, where `q = p.d * w.n`. That is floor((2x + 1) / 2) = half-up for x ≥ 0.
- [ ] **Step 4: Run** `npx vitest run tests/engine/fraction.test.ts`. Expected: PASS.
- [ ] **Step 5: Verify and commit.** Run `npm test`, `npm run lint`, `npm run build`. Commit message: `Add exact fraction helpers for OBE math`.

### Task 5: Exact OBE attainment math

**Files:**
- Modify: `src/engine/obe.ts`, specifically `scoreOf` (≈L121), `shares` (≈L129), `hundredths` (≈L137, to be removed), and `attainments` (≈L159–189)
- Test: `tests/engine/obe.test.ts` (add one `describe('computeObe — exact arithmetic')` block; existing tests unchanged)
- Modify: `ARCHITECTURE.md` (`## Precision rules`)

**Interfaces:**
- Consumes: Task 4's `Fraction`, `frac`, `fromDecimal`, `add`, `mul`, `div`, `hundredthsOf`, `roundToHundredths`.
- Produces: the exported types and signatures in `src/engine/obe.ts` stay unchanged (`computeObe`, `vpaaSheet`, `poRollup`, `OutcomeAttainment`, …). `rawPct`, `rawEarned` and `rawMax` remain plain `number`s with 2 decimals.

- [ ] **Step 1: Write the failing tests.** Add them to `tests/engine/obe.test.ts`, reusing the file's `co(n, poCodes)` helper.

```ts
describe('computeObe — exact arithmetic', () => {
  const cfg = (cos: CourseOutcome[]): ObeConfig => ({ pos: [], cos, los: [] });
  const prelim = (columns: ObeTerms['PRELIM']['columns']): ObeTerms => ({
    PRELIM: { columns }, MIDTERM: { columns: [] }, FINAL: { columns: [] },
  });
  const co1 = (r: ReturnType<typeof computeObe>, scope: ObeScope = 'PRELIM', id = 'co1') => r.students[0]!.scopes[scope].cos[id]!;

  it.each([
    ['1', '4', 40.63], // 13/32 = 40.625%
    ['2', '1', 15.63], // 5/32  = 15.625%
  ])('rounds a 1/3 split half-up (a=%s, b=%s → %s%%)', (a, b, pct) => {
    const r = computeObe(cfg([co(1, []), co(2, []), co(3, [])]),
      prelim([{ id: 'a', label: 'A', maxScore: 2, coIds: ['co1', 'co2', 'co3'] }, { id: 'b', label: 'B', maxScore: 10, coIds: ['co1'] }]),
      [{ id: 's', scores: { a, b } }]);
    expect(co1(r).rawPct).toBe(pct);
  });

  it('rounds a 3/97 weighted split half-up, the same for points and ratios', () => {
    for (const coWeights of [{ co1: 3, co2: 97 }, { co1: 0.03, co2: 0.97 }]) {
      const r = computeObe(cfg([co(1, []), co(2, [])]),
        prelim([{ id: 'x', label: 'X', maxScore: 32, coIds: ['co1', 'co2'], coWeights }]),
        [{ id: 's', scores: { x: '11' } }]);
      expect(co1(r).rawPct).toBe(34.38); // 11/32 = 34.375%
    }
  });

  it('attains a two-decimal pass mark scored exactly, without flagging the column', () => {
    const r = computeObe(cfg([{ ...co(1, []), passRawPct: 64.15 }]),
      prelim([{ id: 'x', label: 'X', maxScore: 2000, coIds: ['co1'] }]),
      [{ id: 's', scores: { x: '1283' } }]);
    expect(co1(r)).toMatchObject({ rawPct: 64.15, attained: true, lowColumns: [] });
  });

  it('skips scores that are not plain decimals instead of crashing', () => {
    const r = computeObe(cfg([co(1, [])]),
      prelim([{ id: 'x', label: 'X', maxScore: 10, coIds: ['co1'] }, { id: 'y', label: 'Y', maxScore: 10, coIds: ['co1'] }]),
      [{ id: 's', scores: { x: '0.0000001', y: '5' } }]);
    expect(co1(r)).toMatchObject({ rawPct: 50, rawMax: 10 });
  });

  it.each([
    [{ co1: 0, co2: 0 }, 33.33], // all zero → equal split: 5 / 15
    [{ co1: Number.NaN, co2: 1 }, 0], // invalid → 0: co1 gets nothing from A
    [{ co1: -5, co2: 1 }, 0],
  ])('treats invalid weights as 0 and all-zero as an equal split (%o)', (coWeights, pct) => {
    const r = computeObe(cfg([co(1, []), co(2, [])]),
      prelim([{ id: 'a', label: 'A', maxScore: 10, coIds: ['co1', 'co2'], coWeights }, { id: 'b', label: 'B', maxScore: 10, coIds: ['co1'] }]),
      [{ id: 's', scores: { a: '10', b: '0' } }]);
    expect(co1(r).rawPct).toBe(pct);
  });

  it('stays exact over 120 columns split across 7 COs', () => {
    const cos = [1, 2, 3, 4, 5, 6, 7].map((n) => co(n, []));
    const coWeights = Object.fromEntries(cos.map((c, i) => [c.id, i + 4])); // 4..10, total 49
    const cols = (t: string) => Array.from({ length: 40 }, (_, i) => ({ id: `${t}${i}`, label: `${t}${i}`, maxScore: 7, coIds: cos.map((c) => c.id), coWeights }));
    const terms: ObeTerms = { PRELIM: { columns: cols('p') }, MIDTERM: { columns: cols('m') }, FINAL: { columns: cols('f') } };
    const scores = Object.fromEntries(['p', 'm', 'f'].flatMap((t) => cols(t).map((c) => [c.id, '7'])));
    const r = computeObe(cfg(cos), terms, [{ id: 's', scores }]);
    for (const c of cos) expect(co1(r, 'OVERALL', c.id)).toMatchObject({ rawPct: 100, attained: true });
    expect(co1(r, 'OVERALL').rawMax).toBe(68.57); // 840 × 4/49 = 68.571…
  });
});
```

  The test imports `ObeScope` from `../../src/engine`; add it to the existing import list.
- [ ] **Step 2: Run** `npx vitest run tests/engine/obe.test.ts`. Expected: the existing tests pass and these new ones FAIL:
  - both 1/3 cases (40.62 and 15.62 instead of 40.63 and 15.63);
  - the 3/97 case (34.37 instead of 34.38);
  - the 64.15 case (`lowColumns` is `['X']`);
  - the `1e-7` case (throws `RangeError`, or counts the score, depending on where it breaks).

  Record which ones fail. Any new test that already passes is a guard; note it, but don't change it to force a failure.
- [ ] **Step 3: Implement the changes in `src/engine/obe.ts`.**
  - **`scoreOf`:** also return `null` when `String(v)` contains `'e'`, so it never feeds `fromDecimal` something it rejects.
  - **`shares(...)`:** return `Map<string, Fraction>`. A weight counts as 0 unless it is a finite number ≥ 0. If the total is 0, every tagged id gets `frac(1n, BigInt(ids.length))`; otherwise each id gets `div(fromDecimal(w), total)`.
  - **`attainments`:**
    - accumulate `earned` and `max` as `Fraction`s, starting at `frac(0n)`;
    - set `rawHundredths = hundredthsOf(earned, max)` when `max.n > 0n`, and `rawPct = rawHundredths / 100`;
    - set `passHundredths = hundredthsOf(fromDecimal(o.passRawPct), frac(100n))`;
    - `attained` becomes `rawHundredths >= passHundredths`;
    - a column is low when `hundredthsOf(fromDecimal(score), fromDecimal(col.maxScore)) < passHundredths`;
    - `rawEarned` and `rawMax` use `roundToHundredths`.
  - **Remove** the old `hundredths` helper.

  Leave `meanOfHundredths`, `classSummary`, `vpaaSheet` and `poRollup` as they are. They already use integer math or recover exact k/100 values.
- [ ] **Step 4: Run** `npx vitest run tests/engine/obe.test.ts tests/app/obe.test.ts`. Expected: all PASS, including every pre-existing OBE test unchanged.
- [ ] **Step 5: Update `ARCHITECTURE.md` `## Precision rules`.**
  - Grade engine: integer-scaled half-up rounding (D21).
  - OBE: exact BigInt fractions (`src/engine/fraction.ts`). Only the final display values are rounded half-up to 2 decimals.
  - Attainment compares the shown 2-decimal %.
  - Invalid weights count as 0; all-zero weights mean an equal split; scores in exponent form are skipped.
- [ ] **Step 6: Verify (verification-before-completion).** Run `npm test`, `npm run lint`, `npm run build`. Expected:
  - all pass;
  - the grade engine, fixture and USA requirement test files are unmodified (`git diff --stat main -- tests/engine/engine.test.ts tests/engine/fixtures.test.ts tests/requirements` shows nothing).

  Then repeat Task 1 Step 4's browser check and confirm the OBE dashboard still renders.
- [ ] **Step 7: Commit.** Message: `Make OBE attainment exact: fraction-based splits and half-up rounding`.
