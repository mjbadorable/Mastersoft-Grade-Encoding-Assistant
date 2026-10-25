// Outcome-Based Education (OBE) attainment (docs/05, docs/06). Three calculations from the
// same gradebook: direct CO/LO attainment from tagged columns, the VPAA sheet
// (LO-count weight × Final Rating), and the PO roll-up of class CO attainment.
import { transmute } from './compute';
import { add, div, frac, fromDecimal, hundredthsOf, lcm, mul, roundToHundredths, type Fraction } from './fraction';
import { roundHalfUp, roundHalfUpDiv } from './rounding';
import { rules, type Term } from './rules';

export type AgaCode = 'A' | 'B' | 'C';

export interface ProgramOutcome {
  id: string;
  /** E.g. "A".."H" (BSHM) or "a".."n" (BSCpE). */
  code: string;
  description: string;
}

/** A course outcome (CO / CLO) from the syllabus. */
export interface CourseOutcome {
  id: string;
  code: string;
  description: string;
  agaCodes: AgaCode[];
  /** Codes of the program outcomes this CO links to. */
  poCodes: string[];
  /** A student attains the CO at this raw % (60% raw = 75 transmuted). */
  passRawPct: number;
  /** The class meets the CO when this % of graded students attain it (CQI target). */
  targetClassPct: number;
}

export interface LearningOutcome {
  id: string;
  code: string;
  moduleCode: string;
  term: Term;
  /** The syllabi link each module's LOs to one or more COs (e.g. HM5 M1 → CO1, CO2, CO3). */
  coIds: string[];
  description: string;
}

export interface ObeConfig {
  programName?: string;
  collegeName?: string;
  /** The syllabus PDF the setup was read from, and when (the file itself is not kept). */
  syllabusFileName?: string;
  syllabusUploadedAt?: number;
  pos: ProgramOutcome[];
  cos: CourseOutcome[];
  los: LearningOutcome[];
}

export const OBE_PASS_RAW_PCT = 60;
export const OBE_TARGET_CLASS_PCT = 75;

export type ObeScope = Term | 'OVERALL';
export const OBE_SCOPES: ObeScope[] = ['PRELIM', 'MIDTERM', 'FINAL', 'OVERALL'];
const TERMS: Term[] = ['PRELIM', 'MIDTERM', 'FINAL'];

/** The parts of a gradebook column the OBE engine reads. */
export interface ObeColumn {
  id: string;
  label: string;
  maxScore: number;
  coIds?: string[];
  loIds?: string[];
  /** Share of the column's points per CO (points or ratios). Missing: equal split. */
  coWeights?: Record<string, number>;
}

export interface ObeStudent {
  id: string;
  /** Score text by column id; '' = not entered yet. */
  scores: Record<string, string>;
}

export type ObeTerms = Record<Term, { columns: ObeColumn[] }>;

/** One student's result for one CO or LO in one scope. */
export interface OutcomeAttainment {
  rawEarned: number;
  rawMax: number;
  /** Null when the student has no score yet in any column tagged with the outcome. */
  rawPct: number | null;
  transmutedGrade: number | null;
  attained: boolean | null;
  /** Labels of the tagged columns where the student scored below the pass mark. */
  lowColumns: string[];
}

export interface StudentObeScope {
  cos: Record<string, OutcomeAttainment>;
  los: Record<string, OutcomeAttainment>;
  lackingCoCodes: string[];
  lackingLoCodes: string[];
}

export interface StudentObe {
  studentId: string;
  scopes: Record<ObeScope, StudentObeScope>;
}

export interface ClassOutcomeSummary {
  id: string;
  code: string;
  attainedCount: number;
  totalGraded: number;
  attainmentPct: number | null;
  meanRawPct: number | null;
  targetClassPct: number;
  /** Class attainment is below target: needs a CQI action. */
  cqiFlag: boolean;
}

export interface ObeReport {
  students: StudentObe[];
  classCos: Record<ObeScope, ClassOutcomeSummary[]>;
  classLos: Record<ObeScope, ClassOutcomeSummary[]>;
}

/** A number that can be read as an exact fraction: finite and not in exponent form (1e-7). */
const isPlain = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x) && !String(x).includes('e');

/** A score that counts toward attainment: entered, a plain number, and within 0..max. */
function scoreOf(text: string | undefined, max: number): number | null {
  const t = (text ?? '').trim();
  if (t === '') return null;
  const v = Number(t);
  return isPlain(v) && v >= 0 && v <= max ? v : null;
}

/** A CO weight counts only when it is a plain number >= 0; anything else counts as 0. */
const weightOf = (w: number | undefined) => (isPlain(w) && w >= 0 ? w : 0);

/**
 * The lowest shown % (in whole hundredths) that meets the pass mark: 64.15 → 6415, 64.154 → 6416.
 * A pass mark that isn't a plain number uses the default.
 */
function passHundredthsOf(pct: number): number {
  const p = fromDecimal(isPlain(pct) && pct >= 0 ? pct : OBE_PASS_RAW_PCT);
  return Number((p.n * 100n + p.d - 1n) / p.d);
}

/** Splits a column across the tagged outcomes that still exist in the config, exactly. */
function shares(tagged: string[] | undefined, known: Set<string>, weights?: Record<string, number>): Map<string, Fraction> {
  const ids = [...new Set(tagged ?? [])].filter((id) => known.has(id));
  const w = ids.map((id) => fromDecimal(weightOf(weights?.[id])));
  const total = w.reduce(add, frac(0n));
  return new Map(ids.map((id, i) => [id, total.n > 0n ? div(w[i]!, total) : frac(1n, BigInt(ids.length))]));
}

const meanOfHundredths = (values: number[]) =>
  values.length === 0 ? null : roundHalfUpDiv(values.reduce((a, b) => a + b, 0), values.length) / 100;

/** The strictest pass mark and target among an LO's COs. */
function loThresholds(lo: LearningOutcome, cos: CourseOutcome[]) {
  const linked = cos.filter((c) => lo.coIds.includes(c.id));
  if (linked.length === 0) return { passRawPct: OBE_PASS_RAW_PCT, targetClassPct: OBE_TARGET_CLASS_PCT };
  return {
    passRawPct: Math.max(...linked.map((c) => c.passRawPct)),
    targetClassPct: Math.max(...linked.map((c) => c.targetClassPct)),
  };
}

interface Outcome {
  id: string;
  code: string;
  passRawPct: number;
  targetClassPct: number;
}

/** A column's part of one outcome, in units of the scope's common scale (see `prepareScope`). */
interface ColumnShare {
  /** Earned units per scaled point the student scores. */
  perPoint: bigint;
  /** The column's maximum, in units. */
  maxUnits: bigint;
}

interface PreparedScope {
  columns: { col: ObeColumn; max: Fraction; shares: Map<string, ColumnShare> }[];
  /** Units per 1 raw point: earned and max totals are divided by this. */
  unit: bigint;
  /** Every score times this is a whole number. */
  pointScale: bigint;
}

/**
 * Reads a scope's columns once for the whole class and puts every column on one common scale,
 * so each student's totals are exact whole-number sums (no fractions to reduce per student).
 */
function prepareScope(columns: ObeColumn[], split: (c: ObeColumn) => Map<string, Fraction>, students: ObeStudent[]): PreparedScope {
  const usable = columns
    .filter((col) => isPlain(col.maxScore) && col.maxScore > 0)
    .map((col) => ({ col, max: fromDecimal(col.maxScore), split: split(col) }));
  let pointScale = 1n;
  for (const { col } of usable) {
    for (const s of students) {
      const score = scoreOf(s.scores[col.id], col.maxScore);
      if (score !== null) pointScale = lcm(pointScale, fromDecimal(score).d);
    }
  }
  let shareScale = 1n;
  for (const { max, split: shares } of usable) {
    for (const share of shares.values()) shareScale = lcm(lcm(shareScale, share.d), mul(max, share).d);
  }
  const unit = pointScale * shareScale;
  return {
    unit,
    pointScale,
    columns: usable.map(({ col, max, split: shares }) => ({
      col,
      max,
      shares: new Map(
        [...shares].map(([id, share]) => {
          const m = mul(max, share);
          return [id, { perPoint: share.n * (shareScale / share.d), maxUnits: (m.n * unit) / m.d }];
        }),
      ),
    })),
  };
}

/** One student's attainment of each outcome over a prepared scope. */
function attainments(outcomes: Outcome[], scope: PreparedScope, student: ObeStudent): Record<string, OutcomeAttainment> {
  // The student's score in each column, read once for all outcomes.
  const scored = scope.columns.flatMap(({ col, max, shares }) => {
    const score = scoreOf(student.scores[col.id], col.maxScore);
    if (score === null) return [];
    const points = fromDecimal(score);
    return [{ label: col.label, shares, scaled: points.n * (scope.pointScale / points.d), pct: hundredthsOf(points, max) }];
  });
  const result: Record<string, OutcomeAttainment> = {};
  for (const o of outcomes) {
    const passHundredths = passHundredthsOf(o.passRawPct);
    let earned = 0n;
    let max = 0n;
    const lowColumns: string[] = [];
    for (const col of scored) {
      const share = col.shares.get(o.id);
      if (share === undefined) continue;
      earned += col.scaled * share.perPoint;
      max += share.maxUnits;
      if (col.pct < passHundredths) lowColumns.push(col.label);
    }
    const rawHundredths = max > 0n ? hundredthsOf(frac(earned), frac(max)) : null;
    const rawPct = rawHundredths === null ? null : rawHundredths / 100;
    result[o.id] = {
      rawEarned: roundToHundredths(frac(earned, scope.unit)),
      rawMax: roundToHundredths(frac(max, scope.unit)),
      rawPct,
      transmutedGrade: rawPct === null ? null : transmute(roundHalfUp(rawPct)),
      attained: rawHundredths === null ? null : rawHundredths >= passHundredths,
      lowColumns,
    };
  }
  return result;
}

function classSummary(outcomes: Outcome[], perStudent: Record<string, OutcomeAttainment>[]): ClassOutcomeSummary[] {
  return outcomes.map((o) => {
    const graded = perStudent.map((s) => s[o.id]!).filter((a) => a.rawPct !== null);
    const attainedCount = graded.filter((a) => a.attained).length;
    const attainmentPct = graded.length === 0 ? null : roundHalfUpDiv(attainedCount * 10000, graded.length) / 100;
    return {
      id: o.id,
      code: o.code,
      attainedCount,
      totalGraded: graded.length,
      attainmentPct,
      meanRawPct: meanOfHundredths(graded.map((a) => Math.round(a.rawPct! * 100))),
      targetClassPct: o.targetClassPct,
      cqiFlag: attainmentPct !== null && attainmentPct < o.targetClassPct,
    };
  });
}

/** Calculation 1: direct CO and LO attainment per student and class, per term and overall. */
export function computeObe(config: ObeConfig, terms: ObeTerms, students: ObeStudent[]): ObeReport {
  const coIds = new Set(config.cos.map((c) => c.id));
  const loIds = new Set(config.los.map((l) => l.id));
  const coSplit = (c: ObeColumn) => shares(c.coIds, coIds, c.coWeights);
  const loSplit = (c: ObeColumn) => shares(c.loIds, loIds);
  const los: Outcome[] = config.los.map((l) => ({ id: l.id, code: l.code, ...loThresholds(l, config.cos) }));
  const columnsIn = (scope: ObeScope) => (scope === 'OVERALL' ? TERMS.flatMap((t) => terms[t].columns) : terms[scope].columns);

  const prepared = Object.fromEntries(
    OBE_SCOPES.map((scope) => [
      scope,
      { cos: prepareScope(columnsIn(scope), coSplit, students), los: prepareScope(columnsIn(scope), loSplit, students) },
    ]),
  ) as Record<ObeScope, { cos: PreparedScope; los: PreparedScope }>;

  const studentResults: StudentObe[] = students.map((s) => {
    const scopes = {} as Record<ObeScope, StudentObeScope>;
    for (const scope of OBE_SCOPES) {
      const coResults = attainments(config.cos, prepared[scope].cos, s);
      const loResults = attainments(los, prepared[scope].los, s);
      scopes[scope] = {
        cos: coResults,
        los: loResults,
        lackingCoCodes: config.cos.filter((c) => coResults[c.id]!.attained === false).map((c) => c.code),
        lackingLoCodes: los.filter((l) => loResults[l.id]!.attained === false).map((l) => l.code),
      };
    }
    return { studentId: s.id, scopes };
  });

  const classCos = {} as ObeReport['classCos'];
  const classLos = {} as ObeReport['classLos'];
  for (const scope of OBE_SCOPES) {
    classCos[scope] = classSummary(config.cos, studentResults.map((r) => r.scopes[scope].cos));
    classLos[scope] = classSummary(los, studentResults.map((r) => r.scopes[scope].los));
  }
  return { students: studentResults, classCos, classLos };
}

export interface VpaaCoWeight {
  coId: string;
  code: string;
  loCount: number;
  /** loCount / totalLos (equal split when no LOs are mapped). */
  weight: number;
}

/** One row of the VPAA "relationship of lessons/module and the course outcomes" table. */
export interface VpaaModuleRow {
  moduleCode: string;
  term: Term;
  loCodesByCo: Record<string, string[]>;
}

export interface VpaaStudentRow {
  studentId: string;
  finalGrade: number | null;
  /** Final Rating × CO weight, to 2 decimals, by CO id. Null without a Final Rating. */
  contributions: Record<string, number> | null;
  attained: boolean | null;
}

export interface VpaaSheet {
  weights: VpaaCoWeight[];
  totalLos: number;
  modules: VpaaModuleRow[];
  students: VpaaStudentRow[];
  summary: { totalGraded: number; attainedCount: number; attainedPct: number | null; notAttainedCount: number; notAttainedPct: number | null };
}

/** Calculation 2: the VPAA "CO Attainment" sheet. `finalGrade` is the whole-number Final Rating. */
export function vpaaSheet(config: ObeConfig, students: { id: string; finalGrade: number | null }[]): VpaaSheet {
  const loCount = (coId: string) => config.los.filter((l) => l.coIds.includes(coId)).length;
  const counts = config.cos.map((c) => loCount(c.id));
  const totalLos = counts.reduce((a, b) => a + b, 0);
  const n = config.cos.length;
  const weights = config.cos.map((c, i) => ({
    coId: c.id,
    code: c.code,
    loCount: counts[i]!,
    weight: totalLos > 0 ? counts[i]! / totalLos : 1 / n,
  }));

  const modules: VpaaModuleRow[] = [];
  for (const lo of config.los) {
    let row = modules.find((m) => m.moduleCode === lo.moduleCode);
    if (!row) {
      row = { moduleCode: lo.moduleCode, term: lo.term, loCodesByCo: Object.fromEntries(config.cos.map((c) => [c.id, []])) };
      modules.push(row);
    }
    for (const coId of lo.coIds) row.loCodesByCo[coId]?.push(lo.code);
  }

  const rows: VpaaStudentRow[] = students.map(({ id, finalGrade }) => {
    if (finalGrade === null) return { studentId: id, finalGrade, contributions: null, attained: null };
    const contributions = Object.fromEntries(
      weights.map((w) => [
        w.coId,
        (totalLos > 0 ? roundHalfUpDiv(finalGrade * w.loCount * 100, totalLos) : roundHalfUpDiv(finalGrade * 100, n)) / 100,
      ]),
    );
    return { studentId: id, finalGrade, contributions, attained: finalGrade >= rules.passingGrade };
  });

  const graded = rows.filter((r) => r.attained !== null);
  const attainedCount = graded.filter((r) => r.attained).length;
  const pct = (count: number) => (graded.length === 0 ? null : roundHalfUpDiv(count * 10000, graded.length) / 100);
  return {
    weights,
    totalLos,
    modules,
    students: rows,
    summary: {
      totalGraded: graded.length,
      attainedCount,
      attainedPct: pct(attainedCount),
      notAttainedCount: graded.length - attainedCount,
      notAttainedPct: pct(graded.length - attainedCount),
    },
  };
}

export interface PoRollup {
  poId: string;
  code: string;
  /** Course-to-PO mapping row: 1 if any CO links to the PO. */
  mapped: 0 | 1;
  linkedCoCodes: string[];
  /** Average class attainment % of the linked COs that have grades. */
  attainmentPct: number | null;
  meanRawPct: number | null;
}

/** Calculation 3: rolls one scope's class CO summaries up to the program outcomes. */
export function poRollup(config: ObeConfig, classCos: ClassOutcomeSummary[]): PoRollup[] {
  return config.pos.map((po) => {
    const linked = config.cos.filter((c) => c.poCodes.includes(po.code));
    const summaries = linked.map((c) => classCos.find((s) => s.id === c.id)).filter((s) => s !== undefined);
    const avg = (pick: (s: ClassOutcomeSummary) => number | null) =>
      meanOfHundredths(summaries.map(pick).filter((v) => v !== null).map((v) => Math.round(v * 100)));
    return {
      poId: po.id,
      code: po.code,
      mapped: linked.length > 0 ? 1 : 0,
      linkedCoCodes: linked.map((c) => c.code),
      attainmentPct: avg((s) => s.attainmentPct),
      meanRawPct: avg((s) => s.meanRawPct),
    };
  });
}

// ---- Blank default setup ----

const co = (n: number, poCodes: string[]): CourseOutcome => ({
  id: `co${n}`,
  code: `CO${n}`,
  description: '',
  agaCodes: [],
  poCodes,
  passRawPct: OBE_PASS_RAW_PCT,
  targetClassPct: OBE_TARGET_CLASS_PCT,
});
const lo = (code: string, moduleCode: string, term: Term, coId: string): LearningOutcome => ({
  id: `lo-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  code,
  moduleCode,
  term,
  coIds: [coId],
  description: '',
});

/** A blank CO1–CO3 setup (one module per term) for classes without a syllabus to upload. */
export const OBE_DEFAULT_CONFIG: ObeConfig = {
  pos: ['A', 'B', 'C', 'D', 'E'].map((code) => ({ id: `po-${code}`, code, description: '' })),
  cos: [co(1, ['A', 'B']), co(2, ['C', 'D']), co(3, ['E'])],
  los: [
    lo('LO 1.1', 'M1', 'PRELIM', 'co1'),
    lo('LO 1.2', 'M1', 'PRELIM', 'co1'),
    lo('LO 2.1', 'M2', 'MIDTERM', 'co2'),
    lo('LO 2.2', 'M2', 'MIDTERM', 'co2'),
    lo('LO 3.1', 'M3', 'FINAL', 'co3'),
    lo('LO 3.2', 'M3', 'FINAL', 'co3'),
  ],
};
