// Outcome-Based Education (OBE) attainment (docs/05, docs/06). Three calculations from the
// same gradebook: direct CO/LO attainment from tagged columns, the VPAA sheet
// (LO-count weight × Final Rating), and the PO roll-up of class CO attainment.
import { transmute } from './compute';
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

/** A score that counts toward attainment: entered, a number, and within 0..max. */
function scoreOf(text: string | undefined, max: number): number | null {
  const t = (text ?? '').trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 && v <= max ? v : null;
}

/** Splits a column across the tagged outcomes that still exist in the config. */
function shares(tagged: string[] | undefined, known: Set<string>, weights?: Record<string, number>): Map<string, number> {
  const ids = [...new Set(tagged ?? [])].filter((id) => known.has(id));
  const w = ids.map((id) => Math.max(0, weights?.[id] ?? 0));
  const total = w.reduce((a, b) => a + b, 0);
  return new Map(ids.map((id, i) => [id, total > 0 ? w[i]! / total : 1 / ids.length]));
}

/** % in hundredths, as a whole number (62.5% → 6250). */
const hundredths = (part: number, whole: number) => Math.round((part * 10000) / whole);
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

/** One student's attainment of each outcome over the given columns. */
function attainments(
  outcomes: Outcome[],
  columns: ObeColumn[],
  split: (c: ObeColumn) => Map<string, number>,
  student: ObeStudent,
): Record<string, OutcomeAttainment> {
  const result: Record<string, OutcomeAttainment> = {};
  for (const o of outcomes) {
    let earned = 0;
    let max = 0;
    const lowColumns: string[] = [];
    for (const col of columns) {
      const share = split(col).get(o.id);
      const score = scoreOf(student.scores[col.id], col.maxScore);
      if (share === undefined || score === null || col.maxScore <= 0) continue;
      earned += score * share;
      max += col.maxScore * share;
      if (hundredths(score, col.maxScore) < o.passRawPct * 100) lowColumns.push(col.label);
    }
    const rawPct = max > 0 ? hundredths(earned, max) / 100 : null;
    result[o.id] = {
      rawEarned: Math.round(earned * 100) / 100,
      rawMax: Math.round(max * 100) / 100,
      rawPct,
      transmutedGrade: rawPct === null ? null : transmute(roundHalfUp(rawPct)),
      attained: rawPct === null ? null : rawPct >= o.passRawPct,
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

  const studentResults: StudentObe[] = students.map((s) => {
    const scopes = {} as Record<ObeScope, StudentObeScope>;
    for (const scope of OBE_SCOPES) {
      const cols = columnsIn(scope);
      const coResults = attainments(config.cos, cols, coSplit, s);
      const loResults = attainments(los, cols, loSplit, s);
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

// ---- Syllabus presets ----

const co = (n: number, description: string, agaCodes: AgaCode[], poCodes: string[]): CourseOutcome => ({
  id: `co${n}`,
  code: `CO${n}`,
  description,
  agaCodes,
  poCodes,
  passRawPct: OBE_PASS_RAW_PCT,
  targetClassPct: OBE_TARGET_CLASS_PCT,
});
const po = (code: string, description: string): ProgramOutcome => ({ id: `po-${code}`, code, description });
const lo = (code: string, moduleCode: string, term: Term, coIds: string[], description: string): LearningOutcome => ({
  id: `lo-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`,
  code,
  moduleCode,
  term,
  coIds,
  description,
});

const HM5_COS = ['co1', 'co2', 'co3'];
const hm5 = (code: string, moduleCode: string, term: Term, description: string) => lo(code, moduleCode, term, HM5_COS, description);

/** CpE 122 numbers LOs per module (LO1, LO2, ...), so codes carry the module: "M1-LO1". */
const cpe = (moduleCode: string, term: Term, coIds: string[], descriptions: string[]) =>
  descriptions.map((d, i) => lo(`${moduleCode}-LO${i + 1}`, moduleCode, term, coIds, d));

export type ObePresetKey = 'DEFAULT_3CO' | 'HM5_HOSPITALITY' | 'CPE122_DISCRETE_MATH';

export const OBE_PRESETS: Record<ObePresetKey, { name: string; config: ObeConfig }> = {
  DEFAULT_3CO: {
    name: 'Default CO1–CO3',
    config: {
      pos: ['A', 'B', 'C', 'D', 'E'].map((c) => po(c, '')),
      cos: [co(1, '', [], ['A', 'B']), co(2, '', [], ['C', 'D']), co(3, '', [], ['E'])],
      los: [
        lo('LO 1.1', 'M1', 'PRELIM', ['co1'], ''),
        lo('LO 1.2', 'M1', 'PRELIM', ['co1'], ''),
        lo('LO 2.1', 'M2', 'MIDTERM', ['co2'], ''),
        lo('LO 2.2', 'M2', 'MIDTERM', ['co2'], ''),
        lo('LO 3.1', 'M3', 'FINAL', ['co3'], ''),
        lo('LO 3.2', 'M3', 'FINAL', ['co3'], ''),
      ],
    },
  },
  // HM 5 / HM 5A Applied Business Tools & Technologies in Hospitality, 1st Sem AY 2025-2026.
  // Every module in the syllabus links to CO1, CO2 and CO3.
  HM5_HOSPITALITY: {
    name: 'HM5 Hospitality',
    config: {
      programName: 'Bachelor of Science in Hospitality Management',
      collegeName: 'College of Business',
      pos: [
        po('A', 'Demonstrate knowledge of tourism industry, local tourism products and services'),
        po('B', 'Interpret and apply relevant laws related to tourism industry'),
        po('C', 'Observe and perform risk mitigation activities'),
        po('D', 'Utilize information technology applications for tourism and hospitality'),
        po('E', 'Manage and market a service-oriented business organization'),
        po('F', 'Demonstrate administrative and managerial skills in a service-oriented business organization'),
        po('G', 'Prepare and monitor industry specific financial transactions and reports'),
        po('H', 'Perform human capital development functions of a tourism oriented organization'),
      ],
      cos: [
        co(1, 'Apply technological tools and systems relevant to the hospitality industry', ['B', 'C'], ['A', 'D', 'E']),
        co(2, 'Produce hospitality-related documents and reports using digital tools, adhering to professional formats, and ethical practices', ['A', 'B', 'C'], ['B', 'D', 'G']),
        co(3, 'Evaluate the integration of current technological innovations', ['A', 'B', 'C'], ['C', 'F', 'H']),
      ],
      los: [
        hm5('LO 1.1', 'M1', 'PRELIM', 'Examine how technology enhances tourism operations and the functions of front office systems.'),
        hm5('LO 1.2', 'M1', 'PRELIM', 'Analyze the effectiveness of various productivity tools in improving hospitality-related tasks and processes.'),
        hm5('LO 1.3', 'M1', 'PRELIM', 'Critique different platforms for their role in enhancing processes and guest relations in hospitality.'),
        hm5('LO 1.4', 'M1', 'PRELIM', 'Demonstrate the use of basic front office and reservation system tools in simulated tourism scenarios.'),
        hm5('LO 1.5', 'M1', 'PRELIM', 'Apply productivity software to complete tourism management tasks.'),
        hm5('LO 1.6', 'M1', 'PRELIM', 'Utilize selected digital communication tools to simulate real-world tourism communication.'),
        hm5('LO 2.1', 'M2', 'PRELIM', 'Examine the role of automation in streamlining hospitality operations and enhancing customer service.'),
        hm5('LO 2.2', 'M2', 'PRELIM', "Critique the effectiveness of automated booking and scheduling platforms in the hospitality industry's service delivery."),
        hm5('LO 2.3', 'M2', 'PRELIM', 'Defend the use of automated email systems as a strategic communication solution in hospitality industry operations.'),
        // The syllabus numbers the first lab LO of M2 "LO 2.3" as well.
        hm5('LO 2.3 (Lab)', 'M2', 'PRELIM', 'Simulate a basic automated workflow for a common hospitality business task using online tools.'),
        hm5('LO 2.4', 'M2', 'PRELIM', 'Construct a sample booking or scheduling process using an automation platform.'),
        hm5('LO 2.5', 'M2', 'PRELIM', 'Design a basic automated email campaign for a hospitality service using online tools.'),
        hm5('LO 3.1', 'M3', 'MIDTERM', 'Examine the components and structure of effective hotel proposals tailored to various client needs.'),
        hm5('LO 3.2', 'M3', 'MIDTERM', 'Evaluate different promotional strategies and their effectiveness in attracting target markets in hospitality industry.'),
        hm5('LO 3.3', 'M3', 'MIDTERM', 'Assess how websites enhance the visibility, accessibility, and credibility of tourism businesses.'),
        hm5('LO 3.4', 'M3', 'MIDTERM', 'Design a customized hotel proposal using digital tools, ensuring accuracy and professional formatting.'),
        hm5('LO 3.5', 'M3', 'MIDTERM', 'Create promotional materials using digital platforms to support a hotel campaign.'),
        hm5('LO 3.6', 'M3', 'MIDTERM', 'Develop a basic, content-rich hotel website using a web-based platform, integrating multimedia and contact elements.'),
        hm5('LO 4.1', 'M4', 'MIDTERM', 'Explain and examine how GDS works and how it helps hospitality companies connect with customers.'),
        hm5('LO 4.2', 'M4', 'MIDTERM', 'Describe the interface and basic commands used in GDS.'),
        hm5('LO 4.3', 'M4', 'MIDTERM', 'Analyze the structure of GDS commands for Flight Availability and PNR.'),
        hm5('LO 4.4', 'M4', 'MIDTERM', 'Identify GDS platforms used in tourism and describe their basic functions.'),
        hm5('LO 4.5', 'M4', 'MIDTERM', 'Use basic GDS commands to search for flights and information.'),
        hm5('LO 4.6', 'M4', 'MIDTERM', 'Create a PNR and check flight availability using GDS commands.'),
        hm5('LO 5.1', 'M5', 'FINAL', 'Compare different ways to change bookings.'),
        hm5('LO 5.2', 'M5', 'FINAL', 'Judge why adding special requests or details to a booking matters for good service.'),
        hm5('LO 5.3', 'M5', 'FINAL', 'Examine how GDS displays prices and what factors affect fare changes.'),
        hm5('LO 5.4', 'M5', 'FINAL', 'Perform booking changes correctly using GDS.'),
        hm5('LO 5.5', 'M5', 'FINAL', 'Use GDS to add requests and find bookings.'),
        hm5('LO 5.6', 'M5', 'FINAL', 'Check fares using GDS commands.'),
        hm5('LO 6.1', 'M6', 'FINAL', 'Examine the role of emerging technology systems in enhancing customer experiences.'),
        hm5('LO 6.2', 'M6', 'FINAL', 'Analyze how software reshapes hospitality business processes and customer management.'),
        hm5('LO 6.3', 'M6', 'FINAL', 'Evaluate the effectiveness of smart hospitality and sustainability technologies in promoting responsible hospitality management.'),
        hm5('LO 6.4', 'M6', 'FINAL', 'Demonstrate how to operate or simulate the use of emerging hospitality technologies through available digital tools or platforms.'),
        hm5('LO 6.5', 'M6', 'FINAL', 'Apply digital systems to simulated hospitality operational scenarios.'),
        hm5('LO 6.6', 'M6', 'FINAL', 'Create a proposal using digital tools that demonstrates the application of smart or sustainable hospitality technologies.'),
      ],
    },
  },
  // CpE 122 Discrete Mathematics, 2nd Sem AY 2023-2024. All COs link to POs a and m.
  CPE122_DISCRETE_MATH: {
    name: 'CpE122 Discrete Math',
    config: {
      programName: 'Bachelor of Science in Computer Engineering',
      collegeName: 'College of Technology',
      pos: [
        po('a', 'Apply knowledge of mathematics and sciences to solve computer engineering problems'),
        po('m', 'Understand at least one specialized field of computer engineering practice'),
      ],
      cos: [
        co(1, 'Demonstrate knowledge of the basic concepts of discrete mathematics', [], ['a', 'm']),
        co(2, 'Solve problems in discrete math fundamental topics', [], ['a', 'm']),
        co(3, 'Use logic and proofs techniques to prove theorems and problems', [], ['a', 'm']),
        co(4, 'Use counting techniques, trees and graphs theory to solve problems', [], ['a', 'm']),
      ],
      los: [
        ...cpe('M1', 'PRELIM', ['co1', 'co2'], [
          'Solve problems on sets',
          'Solve problems on computer representation of sets',
          'Solve problems on functions',
          'Solve problems on sequences and sums',
        ]),
        ...cpe('M2', 'PRELIM', ['co1', 'co2', 'co3'], [
          'Identify the principles of logic',
          'Solve problems on propositional equivalence',
          'Solve problems on predicate and quantifiers',
          'Prove the rule of inference problems',
          'Use proof techniques to solve problems',
        ]),
        ...cpe('M3', 'PRELIM', ['co1', 'co2'], [
          'Solve problems on growth of function',
          'Identify the notation for complexity of algorithms',
          'Solve problems on integers and division',
          'Solve problems on integers and algorithms',
          'Solve problems on number theory',
          'Solve problems on matrices',
        ]),
        ...cpe('M4', 'MIDTERM', ['co1', 'co4'], [
          'Solve problems on counting',
          'Solve problems on pigeon principles',
          'Solve problems on permutations and combinations',
        ]),
        ...cpe('M5', 'MIDTERM', ['co1', 'co2'], [
          'Identify properties of relations',
          'Identify the application of relations',
          'Solve problems on relations',
          'Solve problems on cryptography',
        ]),
        ...cpe('M6', 'MIDTERM', ['co1', 'co4'], [
          'Identify types of graphs and its models',
          'Familiarize graph terminology and special graphs',
          'Solve problems on graphs representation and isomorphism',
          'Solve problems on graphs connectivity',
          'Solve problems on paths and circuits',
          'Solve problems on shortest path',
        ]),
        ...cpe('M7', 'FINAL', ['co1', 'co4'], [
          'Describe concept of trees',
          'Solve problems on application of trees',
          'Solve problems on tree traversals',
          'Solve problems on spanning trees',
          'Solve problems on minimum spanning trees',
          'Solve problems on networks',
        ]),
        ...cpe('M8', 'FINAL', ['co1', 'co2'], ['Solve problems on Boolean algebra', 'Solve problems on finite state machines']),
      ],
    },
  },
};
