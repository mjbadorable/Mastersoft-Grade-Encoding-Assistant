// Phase 3 I/O: smart Excel import (D7), Encoding Guide (D13), backup/restore (D9).
// All students here are made up.
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  BackupError,
  backupFingerprint,
  backupReminderDue,
  parseBackup,
  restoreTemplates,
  restoreWorkspaceClasses,
  serializeBackup,
  serializeWorkspaceBackup,
  workspaceBackupFileName,
} from '../../src/app/backup';
import { buildGuide, buildReverseGuide, guideCells, guideWorkbook, mastersoftOrder, reverseGuideCells, reverseGuideWorkbook } from '../../src/app/encodingGuide';
import { applyMapping, fromTemplate, mergeImportedScores, readWorkbook, suggestMapping, toTemplate, type Grid, type ImportTemplate } from '../../src/app/excelImport';
import { termOutcome } from '../../src/app/gradebook';
import { obeReport, vpaaForRecord } from '../../src/app/obe';
import { solveReverse } from '../../src/engine';
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

/** parseBackup for a one-class file. */
const parseSingle = (text: string) => {
  const b = parseBackup(text);
  if (b.type !== 'single') throw new Error('expected a single-class backup');
  return b;
};

describe('backup and restore', () => {
  it('round-trips a class record exactly', () => {
    const g = grid();
    const m = suggestMapping(g);
    const r = mergeImportedScores(record([]), 'PRELIM', m, applyMapping(g, m).rows, make).record;
    const restored = parseSingle(serializeBackup(r, new Date('2026-10-18T00:00:00Z')));
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
    const restored = parseSingle(JSON.stringify(file)).classRecord;
    expect(restored.obe!.los[0]!.coIds).toEqual([]);
    expect(() => obeReport(restored)).not.toThrow();
    expect(() => vpaaForRecord(restored, restored.obe!)).not.toThrow();
  });

  it('fingerprints the class content, so "Not backed up" ignores save times', () => {
    const g = grid();
    const m = suggestMapping(g);
    const r = mergeImportedScores(record([]), 'PRELIM', m, applyMapping(g, m).rows, make).record;
    const restored = parseSingle(serializeBackup(r)).classRecord;
    expect(backupFingerprint({ ...r, updatedAt: 123 })).toBe(backupFingerprint({ ...r, updatedAt: 456 }));
    expect(backupFingerprint(restored)).toBe(backupFingerprint(r));
    const s0 = r.students[0]!;
    const edited = { ...r, students: [{ ...s0, scores: { ...s0.scores, [r.terms.PRELIM.columns[0]!.id]: '1' } }, ...r.students.slice(1)] };
    expect(backupFingerprint(edited)).not.toBe(backupFingerprint(r));
  });
});

describe('workspace backup', () => {
  const cls = (id: string, code: string, students: Student[] = []): ClassRecord => ({ ...record(students), id, subjectCode: code });
  const stu = (id: string, name: string): Student => ({ id, studentId: id, name, scores: {}, statuses: {} });
  const tpl = (name: string, header = 'Quiz 1'): ImportTemplate => ({
    name,
    headerRow: 2,
    maxRow: 3,
    idHeader: 'Student ID',
    nameHeader: 'Name of Student',
    columns: [{ header, component: 'CS', maxScore: 20 }],
  });
  const workspace = (text: string) => {
    const b = parseBackup(text);
    if (b.type !== 'workspace') throw new Error('expected a workspace backup');
    return b;
  };
  const A = cls('a', 'CHEM1', [stu('s1', 'Ann')]);
  const B = cls('b', 'BIO2', [stu('s2', 'Ben'), stu('s3', 'Cy')]);

  it('writes the documented file schema', () => {
    const file = JSON.parse(serializeWorkspaceBackup([A, B], { exportedAt: 1_700_000_000_000, templates: [tpl('t1')] })) as Record<string, unknown>;
    expect(Object.keys(file)).toEqual(['app', 'format', 'type', 'exportedAt', 'classes', 'templates']);
    expect(file).toMatchObject({ app: 'mastersoft-grade-encoding', format: 1, type: 'workspace', exportedAt: 1_700_000_000_000 });
    expect(file.classes).toHaveLength(2);
    expect(typeof (JSON.parse(serializeWorkspaceBackup([A])) as { exportedAt: unknown }).exportedAt).toBe('number');
    expect(workspaceBackupFileName(new Date('2026-10-28T10:00:00Z'))).toBe('Mastersoft workspace backup 2026-10-28.json');
  });

  it('round-trips every class and the import templates exactly', () => {
    const templates = [tpl('Chem quizzes'), tpl('Bio labs', 'Lab 1')];
    const parsed = workspace(serializeWorkspaceBackup([A, B], { templates, exportedAt: 5 }));
    expect(parsed.classes).toEqual([A, B]);
    expect(parsed.templates).toEqual(templates);
    expect(parsed.exportedAt).toBe(5);
    // A saved template still maps the same headers after the round trip.
    const g = grid();
    const { mapping, missing } = fromTemplate(g, parsed.templates![0]!);
    expect(missing).toEqual([]);
    expect(mapping.columns[0]).toMatchObject({ header: 'Quiz 1', maxScore: 20 });
  });

  it('leaves templates out when none are given, and old single-class files still load as single', () => {
    const file = JSON.parse(serializeWorkspaceBackup([A])) as Record<string, unknown>;
    expect('templates' in file).toBe(false);
    expect(workspace(serializeWorkspaceBackup([A])).templates).toBeUndefined();
    const single = parseBackup(serializeBackup(A));
    expect(single.type).toBe('single');
  });

  it('rejects damaged workspace files', () => {
    const base = JSON.parse(serializeWorkspaceBackup([A, B], { templates: [tpl('t')] })) as { classes: Record<string, unknown>[]; templates: Record<string, unknown>[]; exportedAt: unknown };
    const bad = (edit: (f: typeof base) => void) => {
      const f = structuredClone(base);
      edit(f);
      return () => parseBackup(JSON.stringify(f));
    };
    expect(bad((f) => (f.classes = []))).toThrow(/no classes/);
    expect(bad((f) => (f.classes[1]!.id = 'a'))).toThrow(/same id/);
    expect(bad((f) => (f.classes[0]!.students = 'x'))).toThrow(/student list/);
    expect(bad((f) => (f.templates[0]!.columns = [{ header: 1 }]))).toThrow(/import template is invalid/);
    expect(bad((f) => (f.exportedAt = 'yesterday'))).toThrow(/no backup time/);
  });

  it('merge keeps current classes, updates matching ids and adds new ones', () => {
    const current = [cls('a', 'CHEM1', [stu('old', 'Old')]), cls('c', 'MATH3'), cls('d', 'PHY4')];
    const incoming = [A, B];
    const merged = restoreWorkspaceClasses(current, incoming, 'merge');
    expect(merged.map((c) => c.id)).toEqual(['a', 'c', 'd', 'b']);
    expect(merged[0]).toBe(A); // updated in place by the backup
    expect(merged[1]).toBe(current[1]);
    expect(merged[3]).toBe(B);
  });

  it('replace leaves exactly the backup classes', () => {
    const current = [cls('a', 'CHEM1', [stu('old', 'Old')]), cls('c', 'MATH3')];
    expect(restoreWorkspaceClasses(current, [A, B], 'replace').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('merges templates by name (backup wins) or replaces them; no templates in the file keeps yours', () => {
    const mine = [tpl('shared', 'Mine'), tpl('only mine')];
    const theirs = [tpl('shared', 'Theirs'), tpl('only theirs')];
    const merged = restoreTemplates(mine, theirs, 'merge');
    expect(merged.map((t) => t.name).sort()).toEqual(['only mine', 'only theirs', 'shared']);
    expect(merged.find((t) => t.name === 'shared')!.columns[0]!.header).toBe('Theirs');
    expect(restoreTemplates(mine, theirs, 'replace')).toEqual(theirs);
    expect(restoreTemplates(mine, undefined, 'replace')).toBe(mine);
    expect(restoreTemplates(mine, undefined, 'merge')).toBe(mine);
  });
});

describe('backup reminder', () => {
  const base = { students: 12, sessionBackupTaken: false, dismissed: false, armed: true };

  it('shows only when there is work, no backup yet this session, and it was not dismissed', () => {
    expect(backupReminderDue(base)).toBe(true);
    expect(backupReminderDue({ ...base, students: 0 })).toBe(false);
    expect(backupReminderDue({ ...base, sessionBackupTaken: true })).toBe(false);
    expect(backupReminderDue({ ...base, dismissed: true })).toBe(false);
  });

  it('waits for a class switch or the Overview (armed) before showing', () => {
    expect(backupReminderDue({ ...base, armed: false })).toBe(false);
  });
});

describe('Final Rating Only Encoding Guide', () => {
  const ms = (order: number, id: string) => ({ order, studentId: id, studentName: id, subject: '', campus: '', section: '', semester: '' });
  const student = (id: string, reverse?: Student['reverse'], order?: number): Student => ({
    id,
    studentId: id,
    name: `Name ${id}`,
    scores: {},
    statuses: {},
    reverse,
    mastersoft: order === undefined ? undefined : ms(order, id),
  });
  const guide = buildReverseGuide(
    record([
      student('B', { kind: 'transmuted', grade: '90' }, 1),
      student('A', { kind: 'point', point: '1.5', transmuted: '' }, 0),
      student('C', { kind: 'transmuted', grade: '40' }, 2),
      student('D', undefined, 3),
      student('hand', { kind: 'transmuted', grade: '80' }),
    ]),
  );

  it('totals 100 and lists students in Mastersoft order, hand-added ones last', () => {
    expect(guide.total).toBe(100);
    expect(guide.rows.map((r) => r.studentId)).toEqual(['A', 'B', 'C', 'D', 'hand']);
  });

  it('shows the target, the same solved mark for CS and WE, and the forward check', () => {
    const mark = solveReverse({ kind: 'transmuted', grade: 90 }).mark;
    const b = guide.rows[1]!;
    expect(reverseGuideCells(b).slice(0, 8)).toEqual([2, 'B', 'Name B', '90', mark, mark, 90, '1.8']);
    expect(guide.rows[0]!.target).toBe('Point 1.5');
    expect(guide.rows[0]!.mark).toBeDefined();
  });

  it('explains rows with no marks and flags students outside the Mastersoft list', () => {
    expect(guide.rows[2]!.problem).toBeTruthy();
    expect(guide.rows[2]!.mark).toBeUndefined();
    expect(guide.rows[3]!.problem).toBe('Enter a target');
    expect(guide.rows[4]!.notes).toContain('Not in the Mastersoft list');
  });

  it('exports the same table to .xlsx', () => {
    const wb = XLSX.read(reverseGuideWorkbook(guide), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, defval: null });
    expect(rows[4]?.slice(1, 3)).toEqual(['Total Marks', 100]);
    expect(rows[5]?.slice(1, 3)).toEqual(['Total Marks', 100]);
    expect(rows[7]).toEqual(['#', 'Student ID', 'Student Name', 'Target FR', 'CS Marks / 100', 'WE Marks / 100', 'Predicted FR', 'Point Grade', 'Notes']);
    expect(rows[9]?.slice(0, 5)).toEqual([2, 'B', 'Name B', '90', solveReverse({ kind: 'transmuted', grade: 90 }).mark]);
  });
});
