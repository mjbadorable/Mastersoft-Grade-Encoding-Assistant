// Smart Excel import (D7): read a teacher's own class record, map its columns to
// Class Standing / Written Exam, validate, and merge the scores into one term.
import * as XLSX from 'xlsx';
import type { Term } from '../engine';
import { tidy } from './mastersoftFile';
import type { ClassRecord, Column, Component, Student } from './types';

export type Cell = string | number | boolean | null;
export type Grid = Cell[][];

export class ExcelImportError extends Error {}

export interface Workbook {
  sheetNames: string[];
  grid(sheetName: string): Grid;
}

export function readWorkbook(data: ArrayBuffer | Uint8Array): Workbook {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, { type: 'array' });
  } catch {
    throw new ExcelImportError('This file could not be read as an Excel workbook.');
  }
  if (wb.SheetNames.length === 0) throw new ExcelImportError('The workbook has no sheets.');
  return {
    sheetNames: wb.SheetNames,
    // blankrows keeps grid rows aligned with Excel's row numbers.
    grid: (name) => XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name]!, { header: 1, raw: true, defval: null, blankrows: true }),
  };
}

export const columnLetter = (col: number) => XLSX.utils.encode_col(col);
export const cellText = (v: Cell | undefined) => (v === null || v === undefined ? '' : tidy(String(v)));

export interface ColumnMap {
  col: number;
  /** Header text in the file; templates find the column by it. */
  header: string;
  component: Component;
  maxScore: number;
}

export interface ImportMapping {
  /** 0-based grid row with the column headers. */
  headerRow: number;
  /** Row with the highest possible scores (HPS), if the sheet has one. */
  maxRow: number | null;
  idCol: number | null;
  nameCol: number | null;
  columns: ColumnMap[];
}

const NAME = /name/i;
const ID = /\b(id|i\.d\.|student\s*(no|number|#))\b/i;
const MAX_ROW = /\b(hps|highest\s*possible|max(imum)?|perfect|total\s*items|items)\b/i;
const EXAM = /exam|prelim|midterm|mid\s*term|final|written|\bwe\b/i;
/** Columns a teacher computes from other columns; not raw scores. */
const COMPUTED = /total|%|percent|grade|average|\bave\b|equivalent|transmut|rating|remarks|rank/i;

/** Row-number columns ("No.", "#"). */
const ROW_NO = /^(no\.?|#|nos?\.?|count|seq\.?)$/i;

const isNumber =(v: Cell | undefined) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));

/** "Quiz 1 (20)", "Quiz 1 /20" → 20. */
function maxFromHeader(header: string): number | undefined {
  const m = /(?:\/\s*|\(\s*)(\d+(?:\.\d+)?)\s*\)?\s*$/.exec(header);
  return m ? Number(m[1]) : undefined;
}

/** Best guess at the header row, ID/name columns, HPS row and score columns. */
export function suggestMapping(grid: Grid): ImportMapping {
  const headerRow = Math.max(0, grid.slice(0, 20).findIndex((row) => row.some((c) => NAME.test(cellText(c)))));
  const header = grid[headerRow] ?? [];
  const headers = header.map(cellText);
  const nameIdx = headers.findIndex((h) => NAME.test(h));
  const nameCol = nameIdx >= 0 ? nameIdx : null;
  const idIdx = headers.findIndex((h, i) => i !== nameCol && ID.test(h));
  const idCol = idIdx >= 0 ? idIdx : null;

  let maxRow: number | null = null;
  for (let r = headerRow + 1; r < Math.min(grid.length, headerRow + 6); r++) {
    if ((grid[r] ?? []).some((c) => typeof c === 'string' && MAX_ROW.test(c))) {
      maxRow = r;
      break;
    }
  }

  const dataRows = grid.slice((maxRow ?? headerRow) + 1).filter((row) => nameCol !== null && cellText(row[nameCol]) !== '');
  const columns: ColumnMap[] = [];
  headers.forEach((h, col) => {
    if (h === '' || col === nameCol || col === idCol || COMPUTED.test(h) || ROW_NO.test(h)) return;
    const values = dataRows.map((row) => row[col]).filter((v) => cellText(v) !== '');
    if (values.length === 0 || values.filter(isNumber).length < values.length / 2) return;
    const fromRow = maxRow !== null ? grid[maxRow]?.[col] : undefined;
    columns.push({
      col,
      header: h,
      component: EXAM.test(h) ? 'WE' : 'CS',
      maxScore: isNumber(fromRow) ? Number(fromRow) : (maxFromHeader(h) ?? 0),
    });
  });
  return { headerRow, maxRow, idCol, nameCol, columns };
}

export type IssueKind = 'blank' | 'notNumber' | 'negative' | 'aboveMax';

export interface CellIssue {
  /** 0-based grid row and column. */
  row: number;
  col: number;
  kind: IssueKind;
  message: string;
}

export interface ImportedRow {
  /** 0-based grid row. */
  row: number;
  studentId: string;
  name: string;
  /** Score text per mapped column, in mapping.columns order; '' = blank. */
  scores: string[];
}

export interface ImportResult {
  rows: ImportedRow[];
  issues: CellIssue[];
  /** Problems with the mapping itself; the import can't run until they're fixed. */
  setupIssues: string[];
}

/** Applies a mapping and validates every mapped cell (blank, not a number, above max). */
export function applyMapping(grid: Grid, mapping: ImportMapping): ImportResult {
  const setupIssues: string[] = [];
  if (mapping.nameCol === null) setupIssues.push('Choose the column with the student names.');
  if (mapping.columns.length === 0) setupIssues.push('Map at least one score column to Class Standing or Written Exam.');
  for (const c of mapping.columns) {
    if (!Number.isFinite(c.maxScore) || c.maxScore <= 0) setupIssues.push(`Enter a maximum score above 0 for "${c.header}" (Mastersoft rejects a Total Marks of 0).`);
  }
  if (setupIssues.length > 0 || mapping.nameCol === null) return { rows: [], issues: [], setupIssues };

  const rows: ImportedRow[] = [];
  const issues: CellIssue[] = [];
  const start = Math.max(mapping.headerRow, mapping.maxRow ?? -1) + 1;
  for (let r = start; r < grid.length; r++) {
    const cells = grid[r] ?? [];
    const name = cellText(cells[mapping.nameCol]);
    if (name === '') continue;
    const scores = mapping.columns.map((c) => {
      const raw = cells[c.col];
      const t = cellText(raw);
      const issue = (kind: IssueKind, message: string) => issues.push({ row: r, col: c.col, kind, message });
      if (t === '') issue('blank', `${c.header}: blank`);
      else if (!isNumber(raw)) issue('notNumber', `${c.header}: "${t}" is not a number`);
      else if (Number(t) < 0) issue('negative', `${c.header}: negative score`);
      else if (Number(t) > c.maxScore) issue('aboveMax', `${c.header}: ${t} is above the maximum of ${c.maxScore}`);
      return t;
    });
    rows.push({ row: r, studentId: mapping.idCol === null ? '' : cellText(cells[mapping.idCol]), name, scores });
  }
  if (rows.length === 0) setupIssues.push('No student rows were found below the header.');
  return { rows, issues, setupIssues };
}

/** A saved mapping, reusable on another file with the same headers (D7). */
export interface ImportTemplate {
  name: string;
  headerRow: number;
  maxRow: number | null;
  idHeader: string | null;
  nameHeader: string;
  columns: { header: string; component: Component; maxScore: number }[];
}

export function toTemplate(name: string, grid: Grid, mapping: ImportMapping): ImportTemplate {
  const headers = (grid[mapping.headerRow] ?? []).map(cellText);
  return {
    name,
    headerRow: mapping.headerRow,
    maxRow: mapping.maxRow,
    idHeader: mapping.idCol === null ? null : (headers[mapping.idCol] ?? null),
    nameHeader: mapping.nameCol === null ? '' : (headers[mapping.nameCol] ?? ''),
    columns: mapping.columns.map(({ header, component, maxScore }) => ({ header, component, maxScore })),
  };
}

/** Finds the template's columns by header text; lists the ones it can't find. */
export function fromTemplate(grid: Grid, t: ImportTemplate): { mapping: ImportMapping; missing: string[] } {
  const headers = (grid[t.headerRow] ?? []).map((h) => cellText(h).toLowerCase());
  const find = (h: string) => headers.indexOf(h.toLowerCase());
  const missing: string[] = [];
  const at = (h: string) => {
    const i = find(h);
    if (i < 0) missing.push(h);
    return i < 0 ? null : i;
  };
  const columns: ColumnMap[] = [];
  for (const c of t.columns) {
    const col = at(c.header);
    if (col !== null) columns.push({ ...c, col });
  }
  return {
    mapping: { headerRow: t.headerRow, maxRow: t.maxRow, idCol: t.idHeader ? at(t.idHeader) : null, nameCol: at(t.nameHeader), columns },
    missing,
  };
}

/** "Aguilar, Chenna T." and "AGUILAR  CHENNA T" match. */
const nameKey = (s: string) => tidy(s.toUpperCase().replace(/[.,]/g, ' '));

export interface MergeScoresResult {
  record: ClassRecord;
  added: number;
  matched: number;
  columnsAdded: number;
}

/**
 * Puts imported scores into one term. Students are matched by Student ID, then by name;
 * the rest are added. A mapped column reuses the term's column with the same name and
 * component (taking the file's max score), or becomes a new column.
 */
export function mergeImportedScores(
  record: ClassRecord,
  term: Term,
  mapping: ImportMapping,
  rows: ImportedRow[],
  make: { student: () => Student; id: () => string },
): MergeScoresResult {
  const setup = record.terms[term];
  const columns = [...setup.columns];
  let columnsAdded = 0;
  const columnIds = mapping.columns.map((m) => {
    const i = columns.findIndex((c) => c.component === m.component && tidy(c.label).toLowerCase() === m.header.toLowerCase());
    if (i >= 0) {
      columns[i] = { ...columns[i]!, maxScore: m.maxScore };
      return columns[i]!.id;
    }
    const column: Column = { id: make.id(), label: m.header, maxScore: m.maxScore, component: m.component };
    columns.push(column);
    columnsAdded++;
    return column.id;
  });

  const students = [...record.students];
  const byId = new Map(students.filter((s) => tidy(s.studentId)).map((s) => [tidy(s.studentId), s]));
  const byName = new Map(students.map((s) => [nameKey(s.name), s]));
  let added = 0;
  let matched = 0;
  for (const row of rows) {
    const found = (row.studentId && byId.get(row.studentId)) || byName.get(nameKey(row.name));
    const scores = Object.fromEntries(columnIds.map((id, i) => [id, row.scores[i] ?? '']));
    if (found) {
      matched++;
      const i = students.indexOf(found);
      const updated = { ...found, studentId: found.studentId || row.studentId, scores: { ...found.scores, ...scores } };
      students[i] = updated;
      byName.set(nameKey(row.name), updated);
      if (row.studentId) byId.set(row.studentId, updated);
    } else {
      added++;
      const s: Student = { ...make.student(), studentId: row.studentId, name: row.name, scores };
      students.push(s);
      byName.set(nameKey(row.name), s);
      if (row.studentId) byId.set(row.studentId, s);
    }
  }
  return {
    record: { ...record, terms: { ...record.terms, [term]: { ...setup, columns } }, students },
    added,
    matched,
    columnsAdded,
  };
}
