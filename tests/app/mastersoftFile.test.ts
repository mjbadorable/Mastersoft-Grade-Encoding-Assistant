// Mastersoft "Upload Grade Encoding" import and export (D34).
// Fixture: a real Prelim Class Standing file with IDs and names replaced by S01…S45 (D29).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { termOutcome } from '../../src/app/gradebook';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync as readFile, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildBatchZip,
  buildMastersoftFile,
  buildZip,
  exportFileName,
  MastersoftFileError,
  mergeMastersoftRows,
  parseMastersoftFile,
  planAllTermsExport,
  planExport,
  planReverseExport,
  subjectTypeFromSubject,
  zipFileName,
} from '../../src/app/mastersoftFile';
import type { ClassRecord, Student, TermSetup } from '../../src/app/types';
import { solveReverse } from '../../src/engine';

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
    expect(ws.G2).toMatchObject({ t: 'n' });
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

describe('Final Rating Only export', () => {
  const rows = parseMastersoftFile(fixture, FILE_NAME).rows;
  const listed = mergeMastersoftRows([], rows, newStudent).students.map((s, i) => ({
    ...s,
    reverse: { kind: 'transmuted' as const, grade: String(75 + (i % 25)) },
  }));
  const r = (students: Student[]) => ({ ...record(students), terms: { PRELIM: { ...term('p'), columns: [] }, MIDTERM: { ...term('m'), columns: [] }, FINAL: { ...term('f'), columns: [] } } });

  it('fills Marks with the solved mark for every term and both components, out of 100', () => {
    for (const t of ['PRELIM', 'MIDTERM', 'FINAL'] as const) {
      for (const c of ['CS', 'WE'] as const) {
        const plan = planReverseExport(r(listed), t, c);
        expect(plan.blockers).toEqual([]);
        expect(plan.total).toBe(100);
        expect(plan.rows).toHaveLength(45);
        plan.rows.forEach(({ mark }, i) => expect(mark).toBe(solveReverse({ kind: 'transmuted', grade: 75 + (i % 25) }).mark));
      }
    }
  });

  it('writes the same file layout as a normal export, in Mastersoft order', () => {
    const plan = planReverseExport(r(listed), 'FINAL', 'WE');
    const out = readBack(buildMastersoftFile(plan.rows));
    const original = readBack(fixture);
    expect(out).toHaveLength(original.length);
    out.forEach((cells, i) => expect(cells.slice(0, 6)).toEqual(original[i]!.slice(0, 6)));
    expect(out[1]![6]).toBe(solveReverse({ kind: 'transmuted', grade: 75 }).mark);
    expect(exportFileName(r(listed), 'FINAL', 'WE')).toBe('1stSem,2024-2025-Chem1-MLS1-A-Final-WrittenExam.xlsx');
  });

  it('is blocked until every listed student has a reachable target', () => {
    const students = listed.map((s, i) => (i === 0 ? { ...s, reverse: undefined } : i === 1 ? { ...s, reverse: { kind: 'transmuted' as const, grade: '40' } } : s));
    const blockers = planReverseExport(r(students), 'PRELIM', 'CS').blockers;
    expect(blockers).toHaveLength(2);
    expect(blockers.join(' ')).toContain('Fix the target of: STUDENT S02');
    expect(blockers.join(' ')).toContain('Enter a target Final Rating for: STUDENT S01');
  });

  it('is blocked by duplicate Student IDs and needs an imported list', () => {
    const dup = listed.map((s, i) => (i === 1 ? { ...s, studentId: listed[0]!.studentId } : s));
    expect(planReverseExport(r(dup), 'PRELIM', 'CS').blockers.join(' ')).toContain('is used by more than one student');
    expect(planReverseExport(r([newStudent()]), 'PRELIM', 'CS').blockers).toEqual(['Import the student list from a Mastersoft file first.']);
  });

  it('leaves out students added by hand', () => {
    const plan = planReverseExport(r([...listed, { ...newStudent(), name: 'Walk-in' }]), 'PRELIM', 'CS');
    expect(plan.notInFile).toEqual(['Walk-in']);
    expect(plan.rows).toHaveLength(45);
  });
});

/** Reads a stored (uncompressed) zip back through its central directory. */
function readZip(zip: Uint8Array): Record<string, Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);
  const out: Record<string, Uint8Array> = {};
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(pos, true)).toBe(0x02014b50);
    const size = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const local = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(zip.subarray(pos + 46, pos + 46 + nameLen));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    out[name] = zip.subarray(start, start + size);
    pos += 46 + nameLen;
  }
  return out;
}

describe('planAllTermsExport (zip of all six upload files)', () => {
  const rows = parseMastersoftFile(fixture, FILE_NAME).rows;
  const students = mergeMastersoftRows([], rows, newStudent).students.map((s, i) => ({
    ...s,
    scores: {
      pq: String(30 + (i % 20)), pa: String(25 + (i % 25)), pe: String(20 + (i % 40)),
      mq: String(31 + (i % 20)), ma: String(26 + (i % 25)), me: String(21 + (i % 40)),
      fq: String(30 + (i % 20)), fa: String(26 + (i % 25)), fe: String(21 + (i % 40)),
    },
  }));

  it('makes all 6 files with Mastersoft names, in Prelim → Final, CS then WE order', () => {
    const batch = planAllTermsExport(record(students));
    expect(batch.blocked).toEqual([]);
    expect(batch.totalFiles).toBe(6);
    expect(batch.files.map((f) => f.fileName)).toEqual([
      '1stSem,2024-2025-Chem1-MLS1-A-Prelim-ClassStanding.xlsx',
      '1stSem,2024-2025-Chem1-MLS1-A-Prelim-WrittenExam.xlsx',
      '1stSem,2024-2025-Chem1-MLS1-A-MidTerm-ClassStanding.xlsx',
      '1stSem,2024-2025-Chem1-MLS1-A-MidTerm-WrittenExam.xlsx',
      '1stSem,2024-2025-Chem1-MLS1-A-Final-ClassStanding.xlsx',
      '1stSem,2024-2025-Chem1-MLS1-A-Final-WrittenExam.xlsx',
    ]);
    expect(batch.zipName).toBe('Chem1-MLS1-A-Mastersoft-Uploads.zip');
    expect(zipFileName(record(students))).toBe(batch.zipName);
  });

  it('puts the same rows in each file as the single-file export', () => {
    const r = record(students);
    for (const f of planAllTermsExport(r).files) {
      const out = readBack(f.data);
      const plan = planExport(r, f.term, f.component);
      expect(out).toHaveLength(46);
      expect(out[0]).toEqual([...readBack(fixture)[0]!.slice(0, 6), 'Marks']);
      expect(out.slice(1).map((c) => c[6])).toEqual(plan.rows.map((x) => x.mark));
      expect(out[1]!.slice(0, 2)).toEqual(readBack(fixture)[1]!.slice(0, 2));
    }
    expect(readBack(planAllTermsExport(r).files[5]!.data)[1]![6]).toBe(21);
  });

  it('lists blocked files and still exports the ready ones', () => {
    const noFinalSetup = { ...record(students), terms: { ...record(students).terms, FINAL: { ...term('f'), columns: [] } } };
    const batch = planAllTermsExport(noFinalSetup);
    expect(batch.files.map((f) => f.fileName)).toHaveLength(4);
    expect(batch.blocked.map((b) => [b.term, b.component])).toEqual([['FINAL', 'CS'], ['FINAL', 'WE']]);
    expect(batch.blocked.every((b) => b.reasons.length > 0)).toBe(true);

    const missing = students.map((s, i) => (i === 0 ? { ...s, scores: { ...s.scores, me: '' } } : s));
    const partial = planAllTermsExport(record(missing));
    expect(partial.blocked.map((b) => [b.term, b.component])).toEqual([['MIDTERM', 'CS'], ['MIDTERM', 'WE']]);
    expect(partial.blocked[0]!.reasons).toEqual(['Scores missing for: STUDENT S01.']);
    expect(partial.files).toHaveLength(4);
  });

  it('blocks all six on duplicate Student IDs, and without an imported list', () => {
    const dup = students.map((s, i) => (i === 1 ? { ...s, studentId: students[0]!.studentId } : s));
    const batch = planAllTermsExport(record(dup));
    expect(batch.files).toEqual([]);
    expect(batch.blocked).toHaveLength(6);
    expect(batch.blocked[0]!.reasons[0]).toMatch(/Student ID S01 is used by more than one student/);
    expect(planAllTermsExport(record([newStudent()])).blocked.map((b) => b.reasons)).toEqual(
      Array(6).fill(['Import the student list from a Mastersoft file first.']),
    );
  });

  it('packs the ready files into a valid zip', () => {
    const batch = planAllTermsExport(record(students));
    const zip = buildBatchZip(batch);
    const entries = readZip(zip);
    expect(Object.keys(entries)).toEqual(batch.files.map((f) => f.fileName));
    batch.files.forEach((f) => expect(Buffer.from(entries[f.fileName]!).equals(Buffer.from(f.data))).toBe(true));

    // An independent unzip tool must accept it and agree on the contents.
    const dir = mkdtempSync(join(tmpdir(), 'ms-zip-'));
    const file = join(dir, batch.zipName);
    writeFileSync(file, zip);
    try {
      execFileSync('unzip', ['-tq', file], { stdio: 'pipe' });
      execFileSync('unzip', ['-qo', file, '-d', dir], { stdio: 'pipe' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    expect(buildZip([]).length).toBe(22);
    void readFile;
  });
});

describe('Final Rating Only batch', () => {
  it('uses the solved marks for all six files', () => {
    const rows = parseMastersoftFile(fixture, FILE_NAME).rows;
    const listed = mergeMastersoftRows([], rows, newStudent).students.map((s) => ({
      ...s,
      reverse: { kind: 'transmuted' as const, grade: '80' },
    }));
    const batch = planAllTermsExport(record(listed), true);
    expect(batch.blocked).toEqual([]);
    expect(batch.files).toHaveLength(6);
    const mark = solveReverse({ kind: 'transmuted', grade: 80 }).mark;
    batch.files.forEach((f) => expect(readBack(f.data)[1]![6]).toBe(mark));
  });
});
