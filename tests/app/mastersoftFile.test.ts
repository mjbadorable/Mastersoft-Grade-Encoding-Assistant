// Mastersoft "Upload Grade Encoding" import and export (D34).
// Fixture: a real Prelim Class Standing file with IDs and names replaced by S01…S45 (D29).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { termOutcome } from '../../src/app/gradebook';
import {
  buildMastersoftFile,
  exportFileName,
  MastersoftFileError,
  mergeMastersoftRows,
  parseMastersoftFile,
  planExport,
  subjectTypeFromSubject,
} from '../../src/app/mastersoftFile';
import type { ClassRecord, Student, TermSetup } from '../../src/app/types';

const FILE_NAME = '1stSem,2024-2025-Chem1-MLS1-A-Prelim-ClassStanding.xlsx';
const fixture = readFileSync(new URL('../fixtures/mastersoft-upload-prelim-cs.xlsx', import.meta.url));

let n = 0;
const newStudent = (): Student => ({ id: `new${n++}`, studentId: '', name: '', scores: {}, statuses: {} });

const term = (p: string): TermSetup => ({
  csMode: 'RAW_SUM',
  categories: [],
  columns: [
    { id: `${p}q`, label: 'Quiz', maxScore: 50, component: 'CS' },
    { id: `${p}a`, label: 'Activity', maxScore: 50, component: 'CS' },
    { id: `${p}e`, label: 'Exam', maxScore: 60, component: 'WE' },
  ],
});

const record = (students: Student[]): ClassRecord => ({
  id: 'c',
  subjectCode: 'Chem1',
  subjectName: '',
  section: 'MLS 1-A',
  subjectType: 'LEC',
  terms: { PRELIM: term('p'), MIDTERM: term('m'), FINAL: term('f') },
  students,
  mastersoftSession: '1stSem,2024-2025',
  updatedAt: 0,
});

/** Reads an .xlsx back into rows of raw cell values. */
const readBack = (data: Uint8Array | Buffer) => {
  const wb = XLSX.read(data, { type: 'array' });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true, defval: null });
};

describe('parseMastersoftFile', () => {
  const file = parseMastersoftFile(fixture, FILE_NAME);

  it('reads every student in the file order, keeping the text exactly', () => {
    expect(file.rows).toHaveLength(45);
    expect(file.rows.map((r) => r.studentId)).toEqual(Array.from({ length: 45 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`));
    expect(file.rows[0]).toEqual({
      order: 0,
      studentId: 'S01',
      studentName: 'STUDENT  S01  ',
      subject: 'Inorganic and Organic Chemistry (lec)',
      campus: 'USA',
      section: 'MLS 1-A',
      semester: 'Y1S1',
    });
    expect(file.hasMarks).toBe(true);
  });

  it('reads the session, subject code, term and component from the file name', () => {
    expect(file).toMatchObject({ session: '1stSem,2024-2025', subjectCode: 'Chem1', term: 'PRELIM', component: 'CS' });
    expect(parseMastersoftFile(fixture, '1stSem,2024-2025-Chem1-MLS1-A-Mid Term-WrittenExam (1).xlsx')).toMatchObject({ term: 'MIDTERM', component: 'WE' });
    expect(parseMastersoftFile(fixture, 'renamed.xlsx').session).toBeUndefined();
  });

  it('detects the subject type from the subject name', () => {
    expect(subjectTypeFromSubject('Inorganic and Organic Chemistry (lec)')).toBe('LEC');
    expect(subjectTypeFromSubject('Inorganic and Organic Chemistry (Lab)')).toBe('LAB');
    expect(subjectTypeFromSubject('Art Appreciation')).toBeUndefined();
  });

  it('rejects files that are not Mastersoft upload files', () => {
    const ws = XLSX.utils.aoa_to_sheet([['Name', 'Score'], ['A', 1]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const other = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
    expect(() => parseMastersoftFile(other, 'x.xlsx')).toThrow(MastersoftFileError);
    expect(() => parseMastersoftFile(new Uint8Array([1, 2, 3]), 'x.xlsx')).toThrow(MastersoftFileError);
  });
});

describe('mergeMastersoftRows', () => {
  const rows = parseMastersoftFile(fixture, FILE_NAME).rows;

  it('matches by Student ID, keeps typed scores, and uses the file order', () => {
    const typed: Student = { id: 'x', studentId: ' S03 ', name: 'old', scores: { pq: '40' }, statuses: { PRELIM: 'INC' } };
    const extra: Student = { id: 'y', studentId: 'Z99', name: 'Added by hand', scores: {}, statuses: {} };
    const result = mergeMastersoftRows([extra, typed], rows, newStudent);
    expect(result.matched).toBe(1);
    expect(result.added).toBe(44);
    expect(result.students.slice(0, 45).map((s) => s.studentId)).toEqual(rows.map((r) => r.studentId));
    expect(result.students[2]).toMatchObject({ id: 'x', name: 'STUDENT S03', scores: { pq: '40' }, statuses: { PRELIM: 'INC' } });
    expect(result.students[45]).toMatchObject({ id: 'y' });
    expect(result.notInFile.map((s) => s.id)).toEqual(['y']);
  });
});

describe('export round trip', () => {
  const rows = parseMastersoftFile(fixture, FILE_NAME).rows;
  const students = mergeMastersoftRows([], rows, newStudent).students.map((s, i) => ({
    ...s,
    scores: { pq: String(30 + (i % 20)), pa: String(25 + (i % 25)), pe: String(20 + (i % 40)) },
  }));

  it('writes the same rows and columns, with only Marks filled from the engine', () => {
    const r = record(students);
    const cs = planExport(r, 'PRELIM', 'CS');
    expect(cs.blockers).toEqual([]);
    expect(cs.total).toBe(100);
    const out = readBack(buildMastersoftFile(cs.rows));
    const original = readBack(fixture);
    expect(out).toHaveLength(original.length);
    out.forEach((cells, i) => expect(cells.slice(0, 6)).toEqual(original[i]!.slice(0, 6)));
    expect(out[0]![6]).toBe('Marks');
    students.forEach((s, i) => {
      const o = termOutcome(r, s, 'PRELIM');
      expect(o.kind === 'ok' && o.result.cs.raw).toBe(out[i + 1]![6]);
    });
    const we = readBack(buildMastersoftFile(planExport(r, 'PRELIM', 'WE').rows));
    expect(we.slice(1).map((c) => c[6])).toEqual(students.map((_, i) => 20 + (i % 40)));
  });

  it('writes Student Id as text and Marks as numbers, like Mastersoft', () => {
    const wb = XLSX.read(buildMastersoftFile(planExport(record(students), 'PRELIM', 'CS').rows), { type: 'array' });
    const ws = wb.Sheets.Sheet1!;
    expect(wb.SheetNames).toEqual(['Sheet1']);
    expect(ws.A2).toMatchObject({ t: 's', v: 'S01' });
    expect(ws.G2?.t).toBe('n');
  });

  it('leaves Marks blank for a student with a status and lists them', () => {
    const withStatus = students.map((s, i) => (i === 1 ? { ...s, statuses: { PRELIM: 'DRP' as const } } : s));
    const plan = planExport(record(withStatus), 'PRELIM', 'CS');
    expect(plan.blockers).toEqual([]);
    expect(plan.statusStudents).toEqual(['STUDENT S02 (DRP)']);
    expect(readBack(buildMastersoftFile(plan.rows))[2]![6]).toBeNull();
  });

  it('blocks missing scores and leaves out students added by hand', () => {
    const missing = [...students.map((s, i) => (i === 0 ? { ...s, scores: {} } : s)), { ...newStudent(), name: 'Walk-in' }];
    const plan = planExport(record(missing), 'PRELIM', 'CS');
    expect(plan.blockers).toEqual(['Scores missing for: STUDENT S01.']);
    expect(plan.notInFile).toEqual(['Walk-in']);
  });

  it('needs an imported list before exporting', () => {
    expect(planExport(record([newStudent()]), 'PRELIM', 'CS').blockers).toEqual(['Import the student list from a Mastersoft file first.']);
  });

  it('names the file like Mastersoft does', () => {
    expect(exportFileName(record(students), 'MIDTERM', 'WE')).toBe('1stSem,2024-2025-Chem1-MLS1-A-MidTerm-WrittenExam.xlsx');
  });
});
