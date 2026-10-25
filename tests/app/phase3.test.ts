// Phase 3 I/O: smart Excel import (D7), Encoding Guide (D13), backup/restore (D9).
// All students here are made up.
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { BackupError, backupFingerprint, parseBackup, serializeBackup } from '../../src/app/backup';
import { buildGuide, guideCells, guideWorkbook, mastersoftOrder } from '../../src/app/encodingGuide';
import { applyMapping, fromTemplate, mergeImportedScores, readWorkbook, suggestMapping, toTemplate, type Grid } from '../../src/app/excelImport';
import { termOutcome } from '../../src/app/gradebook';
import { obeReport, vpaaForRecord } from '../../src/app/obe';
import type { ClassRecord, Student, TermSetup } from '../../src/app/types';

const xlsx = (sheets: Record<string, unknown[][]>) => {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
};

// A typical teacher class record: title rows, header, HPS row, computed columns.
const CLASS_RECORD = [
  ['CHEM 1 – Class Record'],
  ['Prelim'],
  ['No.', 'Student ID', 'Name of Student', 'Quiz 1', 'Quiz 2', 'Activity', 'CS Total', 'Prelim Exam', 'Term Grade'],
  [null, null, 'HPS', 20, 30, 80, 130, 60, null],
  [1, 'T-001', 'Alpha, Ann B.', 18, 25, 70, 113, 55, 94],
  [2, 'T-002', 'Bravo, Ben', 20, 31, 80, 131, 60, 100],
  [3, 'T-003', 'Charlie, Cy', 10, null, 'abs', 10, 20, 60],
  [],
  [4, 'T-004', 'Delta, Dee', 15, 20, 60, 95, 45, 86],
];

const grid = (): Grid => readWorkbook(xlsx({ Prelim: CLASS_RECORD, Midterm: [['x']] })).grid('Prelim');

describe('smart Excel import: reading and suggestions', () => {
  it('lists sheets and keeps rows aligned with Excel row numbers', () => {
    const wb = readWorkbook(xlsx({ Prelim: CLASS_RECORD, Midterm: [['x']] }));
    expect(wb.sheetNames).toEqual(['Prelim', 'Midterm']);
    expect(wb.grid('Prelim')[8]?.[2]).toBe('Delta, Dee'); // Excel row 9, after a blank row 8
  });

  it('finds the header row, name and ID columns, the HPS row and score columns', () => {
    const m = suggestMapping(grid());
    expect(m).toMatchObject({ headerRow: 2, maxRow: 3, idCol: 1, nameCol: 2 });
    expect(m.columns).toEqual([
      { col: 3, header: 'Quiz 1', component: 'CS', maxScore: 20 },
      { col: 4, header: 'Quiz 2', component: 'CS', maxScore: 30 },
      { col: 5, header: 'Activity', component: 'CS', maxScore: 80 },
      { col: 7, header: 'Prelim Exam', component: 'WE', maxScore: 60 },
    ]);
  });

  it('reads the max score from the header when there is no HPS row', () => {
    const g = readWorkbook(xlsx({ S: [['Name', 'Quiz (25)', 'Exam /50'], ['A', 20, 40]] })).grid('S');
    expect(suggestMapping(g).columns.map((c) => c.maxScore)).toEqual([25, 50]);
  });
});

describe('smart Excel import: validation', () => {
  it('flags blank cells, text, and scores above the max, by cell', () => {
    const result = applyMapping(grid(), suggestMapping(grid()));
    expect(result.setupIssues).toEqual([]);
    expect(result.rows.map((r) => r.name)).toEqual(['Alpha, Ann B.', 'Bravo, Ben', 'Charlie, Cy', 'Delta, Dee']);
    expect(result.rows[0]).toEqual({ row: 4, studentId: 'T-001', name: 'Alpha, Ann B.', scores: ['18', '25', '70', '55'] });
    expect(result.issues.map(({ row, col, kind }) => ({ row, col, kind }))).toEqual([
      { row: 5, col: 4, kind: 'aboveMax' },
      { row: 6, col: 4, kind: 'blank' },
      { row: 6, col: 5, kind: 'notNumber' },
    ]);
  });

  it('blocks a max score of 0 or a missing name column', () => {
    const m = suggestMapping(grid());
    const zero = { ...m, columns: m.columns.map((c, i) => (i === 0 ? { ...c, maxScore: 0 } : c)) };
    expect(applyMapping(grid(), zero).setupIssues).toEqual(['Enter a maximum score above 0 for "Quiz 1" (Mastersoft rejects a Total Marks of 0).']);
    expect(applyMapping(grid(), { ...m, nameCol: null }).setupIssues[0]).toMatch(/student names/);
  });
});

describe('smart Excel import: templates', () => {
  it('saves a mapping and finds the same columns by header in another file', () => {
    const t = toTemplate('My class record', grid(), suggestMapping(grid()));
    const moved = CLASS_RECORD.map((row) => [row[0], row[2], row[1], ...row.slice(3)]); // name and ID swapped
    const g = readWorkbook(xlsx({ S: moved })).grid('S');
    const { mapping, missing } = fromTemplate(g, t);
    expect(missing).toEqual([]);
    expect(mapping).toMatchObject({ idCol: 2, nameCol: 1 });
    expect(applyMapping(g, mapping).rows[0]?.scores).toEqual(['18', '25', '70', '55']);
    expect(fromTemplate(readWorkbook(xlsx({ S: [['Name', 'Quiz 1']] })).grid('S'), t).missing).toContain('Prelim Exam');
  });
});

const emptyTerm = (): TermSetup => ({ csMode: 'RAW_SUM', categories: [], columns: [] });
const record = (students: Student[]): ClassRecord => ({
  id: 'c1',
  subjectCode: 'CHEM 1',
  subjectName: 'Chemistry',
  section: 'A',
  subjectType: 'LEC',
  terms: { PRELIM: emptyTerm(), MIDTERM: emptyTerm(), FINAL: emptyTerm() },
  students,
  updatedAt: 0,
});
let n = 0;
const make = { student: (): Student => ({ id: `s${n++}`, studentId: '', name: '', scores: {}, statuses: {} }), id: () => `col${n++}` };

describe('smart Excel import: merging into a term', () => {
  it('matches students by ID, then by name, adds the rest, and creates columns', () => {
    const existing: Student[] = [
      { id: 'a', studentId: 'T-001', name: 'ALPHA  ANN B', scores: {}, statuses: { MIDTERM: 'INC' } },
      { id: 'd', studentId: '', name: 'DELTA DEE', scores: {}, statuses: {} },
    ];
    const g = grid();
    const m = suggestMapping(g);
    const { record: r, added, matched, columnsAdded } = mergeImportedScores(record(existing), 'PRELIM', m, applyMapping(g, m).rows, make);
    expect({ added, matched, columnsAdded }).toEqual({ added: 2, matched: 2, columnsAdded: 4 });
    expect(r.students.map((s) => s.name)).toEqual(['ALPHA  ANN B', 'DELTA DEE', 'Bravo, Ben', 'Charlie, Cy']);
    expect(r.students[1]?.studentId).toBe('T-004');
    expect(r.students[0]?.statuses).toEqual({ MIDTERM: 'INC' });
    const o = termOutcome(r, r.students[0]!, 'PRELIM');
    expect(o.kind === 'ok' && [o.result.cs.raw, o.result.cs.total, o.result.termGrade]).toEqual([113, 130, 94]);
    expect(termOutcome(r, r.students[2]!, 'PRELIM').kind).toBe('invalid'); // 31 / 30 stays visible as an error

    // Importing again reuses the same columns.
    const again = mergeImportedScores(r, 'PRELIM', m, applyMapping(g, m).rows, make);
    expect(again.columnsAdded).toBe(0);
    expect(again.added).toBe(0);
  });
});

describe('Encoding Guide', () => {
  const g = grid();
  const m = suggestMapping(g);
  const base = mergeImportedScores(record([]), 'PRELIM', m, applyMapping(g, m).rows, make).record;

  it('lists the totals and each student, with statuses and problems in place of grades', () => {
    const withStatus = { ...base, students: base.students.map((s, i) => (i === 3 ? { ...s, statuses: { PRELIM: 'DRP' as const } } : s)) };
    const guide = buildGuide(withStatus, 'PRELIM');
    expect([guide.csTotal, guide.weTotal]).toEqual([130, 60]);
    expect(guideCells(guide.rows[0]!)).toEqual([1, 'T-001', 'Alpha, Ann B.', 113, 55, 94, '1.5', '']);
    expect(guide.rows[1]?.problem).toBe('Invalid scores');
    expect(guideCells(guide.rows[3]!).slice(3, 7)).toEqual(['DRP', 'DRP', 'DRP', 'DRP']);
  });

  it('carries amber unverified notes', () => {
    const low = { ...base, students: [{ ...base.students[0]!, scores: Object.fromEntries(base.terms.PRELIM.columns.map((c) => [c.id, '1'])) }] };
    const row = buildGuide(low, 'PRELIM').rows[0];
    expect(row?.notes).toEqual(['Unverified: CS below 38% (D30)', 'Unverified: WE below 38% (D30)']);
    expect(row?.point).toBe('5.0'); // term grade 60: 5.0, confirmed in Mastersoft (D36)
  });

  it('uses Mastersoft order when the list was imported', () => {
    const s = (id: string, order?: number): Student => ({
      id,
      studentId: id,
      name: id,
      scores: {},
      statuses: {},
      mastersoft: order === undefined ? undefined : { order, studentId: id, studentName: id, subject: '', campus: '', section: '', semester: '' },
    });
    expect(mastersoftOrder([s('hand'), s('b', 1), s('a', 0)]).map((x) => x.id)).toEqual(['a', 'b', 'hand']);
  });

  it('exports the same table to .xlsx', () => {
    const wb = XLSX.read(guideWorkbook(buildGuide(base, 'PRELIM')), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, defval: null });
    expect(rows[4]?.slice(0, 3)).toEqual(['Prelim – Class Standing', 'Total Marks', 130]);
    expect(rows[7]?.[3]).toBe('CS Marks / 130');
    expect(rows[8]?.slice(0, 7)).toEqual([1, 'T-001', 'Alpha, Ann B.', 113, 55, 94, '1.5']);
  });
});

describe('backup and restore', () => {
  it('round-trips a class record exactly', () => {
    const g = grid();
    const m = suggestMapping(g);
    const r = mergeImportedScores(record([]), 'PRELIM', m, applyMapping(g, m).rows, make).record;
    const restored = parseBackup(serializeBackup(r, new Date('2026-10-18T00:00:00Z')));
    expect(restored.classRecord).toEqual(r);
    expect(restored.exportedAt).toBe('2026-10-18T00:00:00.000Z');
  });

  it('rejects files that are not backups or are damaged', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup('{"app":"other"}')).toThrow(/not a Mastersoft Grade Encoding backup/);
    const bad = JSON.parse(serializeBackup(record([]))) as { classRecord: { students: unknown[] } };
    bad.classRecord.students.push({ id: 'x', studentId: '', name: 'X', scores: { a: 5 }, statuses: {} });
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/score is invalid/);
  });

  it('repairs the OBE setup of an older or damaged backup, so the OBE views still open', () => {
    const file = JSON.parse(serializeBackup(record([]))) as { classRecord: Record<string, unknown> };
    file.classRecord.obe = { cos: [{ id: 'co1', code: 'CO1' }], los: [{ id: 'l1', code: 'LO 1.1', term: 'PRELIM' }] };
    const restored = parseBackup(JSON.stringify(file)).classRecord;
    expect(restored.obe!.los[0]!.coIds).toEqual([]);
    expect(() => obeReport(restored)).not.toThrow();
    expect(() => vpaaForRecord(restored, restored.obe!)).not.toThrow();
  });

  it('fingerprints the class content, so "Not backed up" ignores save times', () => {
    const g = grid();
    const m = suggestMapping(g);
    const r = mergeImportedScores(record([]), 'PRELIM', m, applyMapping(g, m).rows, make).record;
    const restored = parseBackup(serializeBackup(r)).classRecord;
    expect(backupFingerprint({ ...r, updatedAt: 123 })).toBe(backupFingerprint({ ...r, updatedAt: 456 }));
    expect(backupFingerprint(restored)).toBe(backupFingerprint(r));
    const s0 = r.students[0]!;
    const edited = { ...r, students: [{ ...s0, scores: { ...s0.scores, [r.terms.PRELIM.columns[0]!.id]: '1' } }, ...r.students.slice(1)] };
    expect(backupFingerprint(edited)).not.toBe(backupFingerprint(r));
  });
});
