// OBE views of a class record (docs/06 Prompt B): the engine report, the VPAA sheet from
// each student's Final Rating, and the VPAA "CO Attainment" / "PO Attainment" workbook.
import * as XLSX from 'xlsx';
import {
  computeObe,
  OBE_PASS_RAW_PCT,
  OBE_TARGET_CLASS_PCT,
  poRollup,
  TERMS,
  vpaaSheet,
  type AgaCode,
  type CourseOutcome,
  type LearningOutcome,
  type ObeConfig,
  type ObeReport,
  type ProgramOutcome,
  type VpaaSheet,
} from '../engine';
import { finalOutcome } from './gradebook';
import { TERM_LABEL } from './labels';
import type { ClassRecord, Column } from './types';

// ---- Reading saved OBE data safely ----
// Backups and records saved by older versions may lack fields or links. These checks give the
// engine and the OBE views a well-formed setup, so a damaged file can never crash them.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const pctOr = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : fallback);
/** The array's objects that have a string id (an outcome without one can't be linked to). */
const withIds = (v: unknown) => (Array.isArray(v) ? v.filter(isObj).filter((o) => typeof o.id === 'string' && o.id !== '') : []);

/**
 * A saved OBE setup made well-formed: missing lists are empty, missing or invalid pass marks and
 * targets use the defaults, and links to COs that don't exist are dropped. Undefined when there
 * is no readable setup (the class then shows "set up your outcomes").
 */
export function normalizeObeConfig(raw: unknown): ObeConfig | undefined {
  if (!isObj(raw)) return undefined;
  const pos: ProgramOutcome[] = withIds(raw.pos).map((p) => ({ id: p.id as string, code: str(p.code), description: str(p.description) }));
  const cos: CourseOutcome[] = withIds(raw.cos).map((c) => ({
    id: c.id as string,
    code: str(c.code),
    description: str(c.description),
    agaCodes: strings(c.agaCodes).filter((a): a is AgaCode => a === 'A' || a === 'B' || a === 'C'),
    poCodes: strings(c.poCodes),
    passRawPct: pctOr(c.passRawPct, OBE_PASS_RAW_PCT),
    targetClassPct: pctOr(c.targetClassPct, OBE_TARGET_CLASS_PCT),
  }));
  const coIds = new Set(cos.map((c) => c.id));
  const los: LearningOutcome[] = withIds(raw.los).map((l) => ({
    id: l.id as string,
    code: str(l.code),
    moduleCode: str(l.moduleCode),
    term: TERMS.find((t) => t === l.term) ?? 'PRELIM',
    coIds: strings(l.coIds).filter((id) => coIds.has(id)),
    description: str(l.description),
  }));
  const config: ObeConfig = { pos, cos, los };
  for (const key of ['programName', 'collegeName', 'syllabusFileName'] as const) if (typeof raw[key] === 'string') config[key] = raw[key];
  if (typeof raw.syllabusUploadedAt === 'number') config.syllabusUploadedAt = raw.syllabusUploadedAt;
  return config;
}

/** A column's OBE tags kept only when they are lists of ids (and CO weights only as numbers). */
function normalizeColumnTags(col: Column): Column {
  const { coIds, loIds, coWeights, ...rest } = col as Column & Record<'coIds' | 'loIds' | 'coWeights', unknown>;
  const next: Column = rest;
  if (Array.isArray(coIds)) next.coIds = strings(coIds);
  if (Array.isArray(loIds)) next.loIds = strings(loIds);
  if (isObj(coWeights)) next.coWeights = Object.fromEntries(Object.entries(coWeights).filter((e): e is [string, number] => typeof e[1] === 'number'));
  return next;
}

/** The class record with its OBE setup and column tags made well-formed (see `normalizeObeConfig`). */
export function normalizeClassObe(record: ClassRecord): ClassRecord {
  const { obe: rawObe, ...rest } = record;
  const obe = normalizeObeConfig(rawObe);
  const terms = Object.fromEntries(
    TERMS.map((t) => [t, { ...record.terms[t], columns: record.terms[t].columns.map(normalizeColumnTags) }]),
  ) as ClassRecord['terms'];
  return obe ? { ...rest, terms, obe } : { ...rest, terms };
}

/** Direct CO/LO attainment for the class, or null before the syllabus outcomes are set up. */
export function obeReport(record: ClassRecord): ObeReport | null {
  return record.obe ? computeObe(record.obe, record.terms, record.students) : null;
}

/** The VPAA sheet, using the whole-number Final Rating of students who have one. */
export function vpaaForRecord(record: ClassRecord, obe: ObeConfig): VpaaSheet {
  return vpaaSheet(
    obe,
    record.students.map((s) => {
      const fr = finalOutcome(record, s);
      return { id: s.id, finalGrade: fr.kind === 'rating' ? fr.rating.grade : null };
    }),
  );
}

/** CO and LO codes a column is tagged with, in syllabus order (tags of deleted outcomes are skipped). */
export function columnTags(obe: ObeConfig | undefined, column: Column) {
  if (!obe) return { cos: [], los: [] };
  return {
    cos: obe.cos.filter((c) => column.coIds?.includes(c.id)).map((c) => c.code),
    los: obe.los.filter((l) => column.loIds?.includes(l.id)).map((l) => l.code),
  };
}

/** Code for a newly added CO (CO1, CO2, ...) or PO (A..Z, then PO27, ...) that no outcome uses yet. */
export function nextOutcomeCode(kind: 'CO' | 'PO', existing: string[]): string {
  const code = (n: number) => (kind === 'CO' ? `CO${n}` : n <= 26 ? String.fromCharCode(64 + n) : `PO${n}`);
  let n = existing.length + 1;
  while (existing.includes(code(n))) n++;
  return code(n);
}

const pct = (v: number | null) => (v === null ? '' : `${v.toFixed(2)}%`);

export function vpaaWorkbook(record: ClassRecord, obe: ObeConfig): Uint8Array {
  const sheet = vpaaForRecord(record, obe);
  const classLine = [record.subjectCode, record.subjectName, record.section].filter(Boolean).join(' · ');
  const header = [obe.collegeName, obe.programName].filter(Boolean).join(' · ');
  const cos = obe.cos;

  const coAoa: (string | number | null)[][] = [
    ['CO ATTAINMENT'],
    [classLine],
    ...(header ? [[header]] : []),
    [],
    ['RELATIONSHIP OF LESSONS/MODULE AND THE COURSE OUTCOMES'],
    ['Module', 'Term', ...cos.map((c) => c.code)],
    ...sheet.modules.map((m) => [m.moduleCode, TERM_LABEL[m.term], ...cos.map((c) => m.loCodesByCo[c.id]!.join(', '))]),
    ['No. of LOs', '', ...sheet.weights.map((w) => w.loCount)],
    ['CO weight', '', ...sheet.weights.map((w) => pct(w.weight * 100))],
    [],
    ['CO CONTRIBUTION PER STUDENT'],
    ['No.', 'Student ID', 'Student Name', 'Final Grade', ...cos.map((c) => c.code), 'Remarks'],
    ...sheet.students.map((row, i) => {
      const s = record.students[i]!;
      return [
        i + 1,
        s.studentId,
        s.name,
        row.finalGrade,
        ...cos.map((c) => row.contributions?.[c.id] ?? null),
        row.attained === null ? 'No Final Rating yet' : row.attained ? 'Attained' : 'Not Attained',
      ];
    }),
    [],
    ['No. of students attained', sheet.summary.attainedCount],
    ['% students attained CO', pct(sheet.summary.attainedPct)],
    ['No. of students not attained', sheet.summary.notAttainedCount],
    ['% students not attained CO', pct(sheet.summary.notAttainedPct)],
  ];

  const report = computeObe(obe, record.terms, record.students);
  const rollup = poRollup(obe, report.classCos.OVERALL);
  const mapped = rollup.filter((p) => p.mapped).length;
  const poAoa: (string | number | null)[][] = [
    ['PO ATTAINMENT'],
    [classLine],
    ...(header ? [[header]] : []),
    [],
    ['Course Outcome', ...obe.pos.map((p) => p.code)],
    ...cos.map((c) => [c.code, ...obe.pos.map((p) => (c.poCodes.includes(p.code) ? 1 : null))]),
    [record.subjectCode || 'Course', ...rollup.map((p) => p.mapped)],
    ['Total POs mapped', mapped],
    ['% of POs mapped', pct(obe.pos.length === 0 ? null : (mapped / obe.pos.length) * 100)],
    [],
    ['Direct attainment: avg % of students attaining the linked COs (all terms)',...rollup.map((p) => pct(p.attainmentPct))],
    ['Mean raw score % of linked COs', ...rollup.map((p) => pct(p.meanRawPct))],
    [],
    ['Program Outcome', 'Description'],
    ...obe.pos.map((p) => [p.code, p.description]),
  ];

  const wb = XLSX.utils.book_new();
  const co = XLSX.utils.aoa_to_sheet(coAoa);
  co['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 34 }, { wch: 12 }, ...cos.map(() => ({ wch: 12 })), { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, co, 'CO Attainment');
  const po = XLSX.utils.aoa_to_sheet(poAoa);
  po['!cols'] = [{ wch: 30 }, ...obe.pos.map(() => ({ wch: 10 }))];
  XLSX.utils.book_append_sheet(wb, po, 'PO Attainment');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

export function vpaaFileName(record: ClassRecord): string {
  const name = [record.subjectCode, record.section, 'VPAA OBE'].filter(Boolean).join(' ');
  return `${name.replace(/[\\/:*?"<>|]+/g, '-')}.xlsx`;
}
