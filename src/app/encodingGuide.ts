// Encoding Guide (D13): per term, the Assessment Component totals and each student's
// values in Mastersoft's order. Shared by the printable/PDF guide and the .xlsx export.
import * as XLSX from 'xlsx';
import type { Status, Term } from '../engine';
import { assessmentTotals, duplicateStudentIds, formatPoint, reverseOutcome, sameIdAs, termOutcome, termSetupIssues } from './gradebook';
import { subjectTypeLabel, TERM_LABEL } from './labels';
import type { ClassRecord, Student } from './types';

export interface GuideRow {
  no: number;
  studentId: string;
  name: string;
  /** Status shown in place of the marks and grades. */
  status?: Status;
  csMark?: number;
  weMark?: number;
  termGrade?: number;
  point?: string;
  /** Why the row has no values yet (missing or invalid scores). */
  problem?: string;
  /** Amber "unverified" and other notes carried over from the gradebook. */
  notes: string[];
}

export interface Guide {
  title: string;
  classLine: string;
  term: Term;
  csTotal: number | null;
  weTotal: number | null;
  setupIssues: string[];
  rows: GuideRow[];
}

/** Mastersoft's order: imported students in file order, then students added by hand. */
export function mastersoftOrder(students: Student[]): Student[] {
  const imported = students.filter((s) => s.mastersoft).sort((a, b) => a.mastersoft!.order - b.mastersoft!.order);
  return [...imported, ...students.filter((s) => !s.mastersoft)];
}

export function buildGuide(record: ClassRecord, term: Term): Guide {
  const setup = record.terms[term];
  const totals = assessmentTotals(setup);
  const duplicates = duplicateStudentIds(record.students);
  const rows = mastersoftOrder(record.students).map((s, i): GuideRow => {
    const row: GuideRow = { no: i + 1, studentId: s.studentId, name: s.name, notes: [] };
    if (sameIdAs(duplicates, s).length > 0) row.notes.push('Duplicate Student ID');
    if (record.students.some((x) => x.mastersoft) && !s.mastersoft) row.notes.push('Not in the Mastersoft list');
    const o = termOutcome(record, s, term);
    switch (o.kind) {
      case 'status':
        row.status = o.status;
        if (o.carried) row.notes.push(`${o.status} carried forward from an earlier term`);
        break;
      case 'setup':
        row.problem = 'Term setup incomplete';
        break;
      case 'incomplete':
        row.problem = `${o.missing} score(s) missing`;
        break;
      case 'invalid':
        row.problem = 'Invalid scores';
        break;
      case 'ok': {
        const r = o.result;
        Object.assign(row, { csMark: r.cs.raw, weMark: r.we.raw, termGrade: r.termGrade, point: formatPoint(r.termPointGrade.point) });
        for (const [label, c] of [
          ['CS', r.cs],
          ['WE', r.we],
        ] as const) {
          if (c.unverifiedBoundary) row.notes.push(`Unverified: ${label} rounding boundary (D20)`);
          if (c.unverifiedLowPct) row.notes.push(`Unverified: ${label} below 38% (D30)`);
        }
        if (!r.termPointGrade.verified) row.notes.push('Unverified term point grade (D31/D32)');
        if (o.decimalWarning) row.notes.push(`Decimal marks: whole numbers would give ${o.decimalWarning.roundedGrade}`);
      }
    }
    return row;
  });
  return {
    title: `${TERM_LABEL[term]} Encoding Guide`,
    classLine: [record.subjectCode, record.subjectName, record.section, subjectTypeLabel(record.subjectType)].filter(Boolean).join(' · '),
    term,
    csTotal: totals.cs,
    weTotal: totals.we,
    setupIssues: termSetupIssues(setup),
    rows,
  };
}

/** Column values for one row, as printed and exported. */
export function guideCells(row: GuideRow): (string | number)[] {
  const value = (v: string | number | undefined) => row.status ?? v ?? '';
  return [row.no, row.studentId, row.name, value(row.csMark), value(row.weMark), value(row.termGrade), value(row.point), [row.problem, ...row.notes].filter(Boolean).join('; ')];
}

export const guideHeaders = (g: Guide) => [
  '#',
  'Student ID',
  'Student Name',
  `CS Marks / ${g.csTotal ?? '—'}`,
  `WE Marks / ${g.weTotal ?? '—'}`,
  'Term Grade',
  'Point Grade',
  'Notes',
];

export function guideWorkbook(g: Guide): Uint8Array {
  const term = TERM_LABEL[g.term];
  const aoa: (string | number | null)[][] = [
    [g.title],
    [g.classLine],
    [],
    ['Mastersoft Assessment Component'],
    [`${term} – Class Standing`, 'Total Marks', g.csTotal],
    [`${term} – Written Exam`, 'Total Marks', g.weTotal],
    [],
    guideHeaders(g),
    ...g.rows.map(guideCells),
  ];
  if (g.setupIssues.length > 0) aoa.splice(3, 0, [`Setup incomplete: ${g.setupIssues.join(' ')}`]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 5 }, { wch: 16 }, { wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 11 }, { wch: 11 }, { wch: 48 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${term} Guide`);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

export function guideFileName(record: ClassRecord, term: Term, ext: 'xlsx' | 'pdf'): string {
  const name = [record.subjectCode, record.section, TERM_LABEL[term], 'Encoding Guide'].filter(Boolean).join(' ');
  return `${name.replace(/[\\/:*?"<>|]+/g, '-')}.${ext}`;
}

export interface ReverseGuideRow {
  no: number;
  studentId: string;
  name: string;
  /** What the teacher entered: "90" or "Point 1.5". */
  target: string;
  /** The same mark is encoded for both components in all three terms. */
  mark?: number;
  predictedFr?: number;
  point?: string;
  /** Why the row has no marks yet (no target, or a target that can't be reached). */
  problem?: string;
  notes: string[];
}

export interface ReverseGuide {
  title: string;
  classLine: string;
  /** Total Marks to set in Mastersoft for every term and both components. */
  total: number;
  rows: ReverseGuideRow[];
}

const REVERSE_TOTAL = 100;

/** Encoding Guide for Final Rating Only mode: one set of marks that serves all three terms. */
export function buildReverseGuide(record: ClassRecord): ReverseGuide {
  const duplicates = duplicateStudentIds(record.students);
  const rows = mastersoftOrder(record.students).map((s, i): ReverseGuideRow => {
    const t = s.reverse;
    const target = !t ? '' : t.kind === 'transmuted' ? t.grade.trim() : t.point === '' ? '' : `Point ${formatPoint(Number(t.point))}${t.transmuted.trim() ? ` (${t.transmuted.trim()})` : ''}`;
    const row: ReverseGuideRow = { no: i + 1, studentId: s.studentId, name: s.name, target, notes: [] };
    if (sameIdAs(duplicates, s).length > 0) row.notes.push('Duplicate Student ID');
    if (record.students.some((x) => x.mastersoft) && !s.mastersoft) row.notes.push('Not in the Mastersoft list');
    const o = reverseOutcome(record, s);
    if (o.kind === 'empty') row.problem = 'Enter a target';
    else if (o.kind === 'invalid') row.problem = o.message;
    else {
      Object.assign(row, { mark: o.solved.mark, predictedFr: o.rating.grade, point: formatPoint(o.rating.point.point) });
      if (o.rating.grade !== o.solved.transmuted) row.notes.push(`Forward check gives ${o.rating.grade}, not ${o.solved.transmuted}`);
      if (!o.rating.point.verified) row.notes.push('Unverified point grade (D31/D32)');
    }
    return row;
  });
  return {
    title: 'Final Rating Only Encoding Guide',
    classLine: [record.subjectCode, record.subjectName, record.section, subjectTypeLabel(record.subjectType)].filter(Boolean).join(' · '),
    total: REVERSE_TOTAL,
    rows,
  };
}

export const reverseGuideHeaders = (g: ReverseGuide) => [
  '#',
  'Student ID',
  'Student Name',
  'Target FR',
  `CS Marks / ${g.total}`,
  `WE Marks / ${g.total}`,
  'Predicted FR',
  'Point Grade',
  'Notes',
];

/** Column values for one row, as printed and exported. */
export function reverseGuideCells(row: ReverseGuideRow): (string | number)[] {
  return [
    row.no,
    row.studentId,
    row.name,
    row.target,
    row.mark ?? '',
    row.mark ?? '',
    row.predictedFr ?? '',
    row.point ?? '',
    [row.problem, ...row.notes].filter(Boolean).join('; '),
  ];
}

export function reverseGuideWorkbook(g: ReverseGuide): Uint8Array {
  const aoa: (string | number | null)[][] = [
    [g.title],
    [g.classLine],
    [],
    ['Mastersoft Assessment Component'],
    ['Prelim, Midterm and Final – Class Standing', 'Total Marks', g.total],
    ['Prelim, Midterm and Final – Written Exam', 'Total Marks', g.total],
    [],
    reverseGuideHeaders(g),
    ...g.rows.map(reverseGuideCells),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 5 }, { wch: 16 }, { wch: 34 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 11 }, { wch: 48 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Final Rating Guide');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

export function reverseGuideFileName(record: ClassRecord, ext: 'xlsx' | 'pdf'): string {
  const name = [record.subjectCode, record.section, 'Final Rating Only Encoding Guide'].filter(Boolean).join(' ');
  return `${name.replace(/[\\/:*?"<>|]+/g, '-')}.${ext}`;
}
