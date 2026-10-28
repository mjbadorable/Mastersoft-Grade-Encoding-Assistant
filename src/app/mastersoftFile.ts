// Mastersoft "Upload Grade Encoding" files (D34). Mastersoft builds them with SheetJS:
// one sheet, one header row, 7 columns, one file per term and component. The import keeps
// the student rows exactly as written; the export writes them back with only Marks filled.
import * as XLSX from 'xlsx';
import type { SubjectType, Term } from '../engine';
import { duplicateStudentIds, reverseOutcome, termOutcome, termSetupIssues, assessmentTotals } from './gradebook';
import type { ClassRecord, Component, MastersoftRow, Student } from './types';

export const MASTERSOFT_HEADERS = ['Student Id', 'Student Name', 'Subject', 'Campus', 'Section', 'Semester', 'Marks'] as const;

/** Term names as they appear in Mastersoft's file names. */
const FILE_TERM: Record<Term, string> = { PRELIM: 'Prelim', MIDTERM: 'MidTerm', FINAL: 'Final' };
const FILE_COMPONENT: Record<Component, string> = { CS: 'ClassStanding', WE: 'WrittenExam' };

export class MastersoftFileError extends Error {}

export interface MastersoftFile {
  rows: MastersoftRow[];
  /** From the file name, e.g. "1stSem,2024-2025-Chem1-MLS1-A-Prelim-ClassStanding.xlsx". */
  session?: string;
  subjectCode?: string;
  term?: Term;
  component?: Component;
  /** Marks already in the file (they are not imported; shown in the preview only). */
  hasMarks: boolean;
}

/** A raw SheetJS cell value (raw: true, defval: null). */
type Cell = string | number | boolean | Date | null;
const text = (v: Cell | undefined) => (v === null || v === undefined ? '' : String(v));
const noSpaces = (s: string) => s.replace(/\s+/g, '');

/** Display form of a Mastersoft name or ID: single spaces, trimmed. */
export const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

export function parseMastersoftFile(data: ArrayBuffer | Uint8Array, fileName: string): MastersoftFile {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, { type: 'array' });
  } catch {
    throw new MastersoftFileError('This file could not be read as an Excel workbook.');
  }
  const ws = wb.Sheets[wb.SheetNames[0] ?? ''];
  if (!ws) throw new MastersoftFileError('The workbook has no sheets.');
  const grid = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });

  const header = (grid[0] ?? []).map((h) => tidy(text(h)).toLowerCase());
  const expected = MASTERSOFT_HEADERS.map((h) => h.toLowerCase());
  if (expected.some((h, i) => header[i] !== h)) {
    throw new MastersoftFileError(
      `This doesn't look like a Mastersoft "Upload Grade Encoding" file. The first row should be: ${MASTERSOFT_HEADERS.join(', ')}.`,
    );
  }

  const rows: MastersoftRow[] = [];
  let hasMarks = false;
  for (const cells of grid.slice(1)) {
    const studentId = text(cells[0]);
    if (tidy(studentId) === '') continue;
    if (text(cells[6]).trim() !== '') hasMarks = true;
    rows.push({
      order: rows.length,
      studentId,
      studentName: text(cells[1]),
      subject: text(cells[2]),
      campus: text(cells[3]),
      section: text(cells[4]),
      semester: text(cells[5]),
    });
  }
  if (rows.length === 0) throw new MastersoftFileError('The file has no student rows.');

  const ids = new Set<string>();
  for (const r of rows) {
    const id = tidy(r.studentId);
    if (ids.has(id)) throw new MastersoftFileError(`Student ID ${id} appears more than once in the file.`);
    ids.add(id);
  }

  return { rows, hasMarks, ...parseFileName(fileName, rows[0]!.section) };
}

function parseFileName(fileName: string, section: string): Pick<MastersoftFile, 'session' | 'subjectCode' | 'term' | 'component'> {
  const m = /^(.+?\d{4}-\d{4})-(.+)-(Prelim|Mid ?Term|Final)-(ClassStanding|WrittenExam)(?: ?\(\d+\))?\.xlsx$/i.exec(fileName.trim());
  if (!m) return {};
  const [, session, codeAndSection, term, component] = m as unknown as [string, string, string, string, string];
  const suffix = `-${noSpaces(section)}`;
  return {
    session,
    subjectCode: codeAndSection.endsWith(suffix) ? codeAndSection.slice(0, -suffix.length) : undefined,
    term: /^prelim$/i.test(term) ? 'PRELIM' : /^final$/i.test(term) ? 'FINAL' : 'MIDTERM',
    component: /^class/i.test(component) ? 'CS' : 'WE',
  };
}

/** "Inorganic and Organic Chemistry (lec)" → LEC. */
export function subjectTypeFromSubject(subject: string): SubjectType | undefined {
  if (/\(\s*lec\s*\)/i.test(subject)) return 'LEC';
  if (/\(\s*lab\s*\)/i.test(subject)) return 'LAB';
  return undefined;
}

export interface MergeResult {
  students: Student[];
  added: number;
  matched: number;
  /** Students already in the class who are not in the file (kept, moved to the end). */
  notInFile: Student[];
}

/**
 * Puts the class in the file's row order. Students are matched by Student ID, so scores
 * and statuses already typed are kept.
 */
export function mergeMastersoftRows(students: Student[], rows: MastersoftRow[], newStudent: () => Student): MergeResult {
  const byId = new Map(students.map((s) => [tidy(s.studentId), s]));
  const used = new Set<Student>();
  let added = 0;
  const merged = rows.map((row) => {
    const found = byId.get(tidy(row.studentId));
    const existing = found && !used.has(found) ? found : undefined;
    if (existing) used.add(existing);
    else added++;
    return { ...(existing ?? newStudent()), studentId: tidy(row.studentId), name: tidy(row.studentName), mastersoft: row };
  });
  const notInFile = students.filter((s) => !used.has(s)).map(({ mastersoft: _dropped, ...s }) => s);
  return { students: [...merged, ...notInFile], added, matched: rows.length - added, notInFile };
}

export interface ExportRow {
  row: MastersoftRow;
  /** null = left blank (student has a status in this term). */
  mark: number | null;
}

export interface ExportPlan {
  term: Term;
  component: Component;
  /** The app's Total Marks; Mastersoft's "Marks Out of" must be the same. */
  total: number | null;
  rows: ExportRow[];
  /** Reasons the file can't be made yet. */
  blockers: string[];
  /** Students left blank because of a status. */
  statusStudents: string[];
  /** Students typed in by hand, not in the Mastersoft list; left out of the file. */
  notInFile: string[];
  /** Students whose mark has decimals (Mastersoft may only accept whole numbers, O2). */
  decimalMarks: string[];
}

/** Total Marks in Final Rating Only mode, for both components in every term. */
const REVERSE_TOTAL = 100;

const label = (s: Student) => s.name || s.studentId || 'Unnamed student';

/** Collects the engine's marks for one Mastersoft file. Does no grade math itself. */
export function planExport(record: ClassRecord, term: Term, component: Component): ExportPlan {
  const setup = record.terms[term];
  const totals = assessmentTotals(setup);
  const plan: ExportPlan = {
    term,
    component,
    total: component === 'CS' ? totals.cs : totals.we,
    rows: [],
    blockers: [],
    statusStudents: [],
    notInFile: [],
    decimalMarks: [],
  };
  const imported = record.students.filter((s) => s.mastersoft).sort((a, b) => a.mastersoft!.order - b.mastersoft!.order);
  plan.notInFile = record.students.filter((s) => !s.mastersoft).map(label);
  if (imported.length === 0) {
    plan.blockers.push('Import the student list from a Mastersoft file first.');
    return plan;
  }
  const issues = termSetupIssues(setup);
  if (issues.length > 0) {
    plan.blockers.push(...issues);
    return plan;
  }
  for (const [, list] of duplicateStudentIds(record.students)) {
    plan.blockers.push(`Student ID ${list[0]!.studentId.trim()} is used by more than one student: ${list.map(label).join(', ')}. Each student can appear only once.`);
  }

  const incomplete: string[] = [];
  const invalid: string[] = [];
  for (const s of imported) {
    const o = termOutcome(record, s, term);
    if (o.kind === 'ok') {
      const mark = component === 'CS' ? o.result.cs.raw : o.result.we.raw;
      if (!Number.isInteger(mark)) plan.decimalMarks.push(label(s));
      plan.rows.push({ row: s.mastersoft!, mark });
    } else if (o.kind === 'status') {
      plan.statusStudents.push(`${label(s)} (${o.status})`);
      plan.rows.push({ row: s.mastersoft!, mark: null });
    } else if (o.kind === 'invalid') invalid.push(label(s));
    else incomplete.push(label(s));
  }
  if (invalid.length > 0) plan.blockers.push(`Fix the scores of: ${invalid.join(', ')}.`);
  if (incomplete.length > 0) plan.blockers.push(`Scores missing for: ${incomplete.join(', ')}.`);
  return plan;
}

/** The upload file: same 7 columns and row order as Mastersoft's own download. */
export function buildMastersoftFile(rows: ExportRow[]): Uint8Array {
  const aoa: (string | number | null)[][] = [
    [...MASTERSOFT_HEADERS],
    ...rows.map(({ row, mark }) => [row.studentId, row.studentName, row.subject, row.campus, row.section, row.semester, mark]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  // SheetJS returns an ArrayBuffer here; wrap it so callers get real bytes.
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', bookSST: false }) as ArrayBuffer);
}

/** Same naming as Mastersoft's downloads, e.g. "1stSem,2024-2025-Chem1-MLS1-A-Prelim-ClassStanding.xlsx". */
export function exportFileName(record: ClassRecord, term: Term, component: Component): string {
  const section = record.students.find((s) => s.mastersoft)?.mastersoft?.section ?? record.section;
  const parts = [record.mastersoftSession, noSpaces(record.subjectCode), noSpaces(section), FILE_TERM[term], FILE_COMPONENT[component]];
  return `${parts.filter((p) => p).join('-')}.xlsx`;
}

/**
 * Final Rating Only mode: the same solved mark goes in both components of all three terms,
 * and "Marks Out of" is 100. Collects it for one Mastersoft file; no grade math here.
 */
export function planReverseExport(record: ClassRecord, term: Term, component: Component): ExportPlan {
  const plan: ExportPlan = { term, component, total: REVERSE_TOTAL, rows: [], blockers: [], statusStudents: [], notInFile: [], decimalMarks: [] };
  const imported = record.students.filter((s) => s.mastersoft).sort((a, b) => a.mastersoft!.order - b.mastersoft!.order);
  plan.notInFile = record.students.filter((s) => !s.mastersoft).map(label);
  if (imported.length === 0) {
    plan.blockers.push('Import the student list from a Mastersoft file first.');
    return plan;
  }
  for (const [, list] of duplicateStudentIds(record.students)) {
    plan.blockers.push(`Student ID ${list[0]!.studentId.trim()} is used by more than one student: ${list.map(label).join(', ')}. Each student can appear only once.`);
  }
  const noTarget: string[] = [];
  const unreachable: string[] = [];
  for (const s of imported) {
    const o = reverseOutcome(record, s);
    if (o.kind === 'ok') plan.rows.push({ row: s.mastersoft!, mark: o.solved.mark });
    else if (o.kind === 'invalid') unreachable.push(label(s));
    else noTarget.push(label(s));
  }
  if (unreachable.length > 0) plan.blockers.push(`Fix the target of: ${unreachable.join(', ')}.`);
  if (noTarget.length > 0) plan.blockers.push(`Enter a target Final Rating for: ${noTarget.join(', ')}.`);
  return plan;
}

export interface BatchFile {
  fileName: string;
  data: Uint8Array;
  term: Term;
  component: Component;
}

export interface BatchBlocker {
  term: Term;
  component: Component;
  /** The file that can't be made yet. */
  fileName: string;
  reasons: string[];
}

export interface BatchExportPlan {
  /** Files that can be made now, in Prelim → Final order, CS before WE. */
  files: BatchFile[];
  blocked: BatchBlocker[];
  /** Always 6: Class Standing and Written Exam for each of the three terms. */
  totalFiles: number;
  zipName: string;
}

const EXPORT_TERMS: Term[] = ['PRELIM', 'MIDTERM', 'FINAL'];
const EXPORT_COMPONENTS: Component[] = ['CS', 'WE'];

/** "{subjectCode}-{section}-Mastersoft-Uploads.zip", spaces removed like Mastersoft's file names. */
export function zipFileName(record: ClassRecord): string {
  const section = record.students.find((s) => s.mastersoft)?.mastersoft?.section ?? record.section;
  return `${[noSpaces(record.subjectCode), noSpaces(section), 'Mastersoft-Uploads'].filter((p) => p).join('-')}.zip`;
}

/**
 * Plans all six upload files at once (3 terms × CS/WE). A file is included only when its
 * single-file plan has no blockers; the rest are listed in `blocked` with the reasons.
 * Pass `reverse` for Final Rating Only mode. Does no grade math itself.
 */
export function planAllTermsExport(record: ClassRecord, reverse = false): BatchExportPlan {
  const files: BatchFile[] = [];
  const blocked: BatchBlocker[] = [];
  for (const term of EXPORT_TERMS) {
    for (const component of EXPORT_COMPONENTS) {
      const plan = reverse ? planReverseExport(record, term, component) : planExport(record, term, component);
      const fileName = exportFileName(record, term, component);
      if (plan.blockers.length > 0) blocked.push({ term, component, fileName, reasons: plan.blockers });
      else files.push({ fileName, data: buildMastersoftFile(plan.rows), term, component });
    }
  }
  return { files, blocked, totalFiles: EXPORT_TERMS.length * EXPORT_COMPONENTS.length, zipName: zipFileName(record) };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Packs files into a zip archive with no compression ("stored"). The .xlsx files are
 * already compressed, so this costs almost no size and needs no library.
 */
export function buildZip(files: { fileName: string; data: Uint8Array }[], date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = (Math.max(date.getFullYear() - 1980, 0) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const UTF8_NAMES = 0x0800;

  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const header = (size: number) => {
    const buf = new Uint8Array(size);
    return { buf, view: new DataView(buf.buffer) };
  };

  for (const { fileName, data } of files) {
    const name = enc.encode(fileName);
    const crc = crc32(data);
    const local = header(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, UTF8_NAMES, true);
    local.view.setUint16(10, dosTime, true);
    local.view.setUint16(12, dosDate, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, data.length, true);
    local.view.setUint32(22, data.length, true);
    local.view.setUint16(26, name.length, true);
    parts.push(local.buf, name, data);

    const entry = header(46);
    entry.view.setUint32(0, 0x02014b50, true);
    entry.view.setUint16(4, 20, true);
    entry.view.setUint16(6, 20, true);
    entry.view.setUint16(8, UTF8_NAMES, true);
    entry.view.setUint16(12, dosTime, true);
    entry.view.setUint16(14, dosDate, true);
    entry.view.setUint32(16, crc, true);
    entry.view.setUint32(20, data.length, true);
    entry.view.setUint32(24, data.length, true);
    entry.view.setUint16(28, name.length, true);
    entry.view.setUint32(42, offset, true);
    central.push(entry.buf, name);
    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, offset, true);

  const all = [...parts, ...central, end.buf];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of all) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** The zip of every file in a batch plan. */
export const buildBatchZip = (plan: BatchExportPlan): Uint8Array => buildZip(plan.files);
