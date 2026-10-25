// OBE views of a class record: Final Rating → VPAA sheet, column tags, and the VPAA workbook.
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { columnTags, nextOutcomeCode, obeReport, vpaaFileName, vpaaForRecord, vpaaWorkbook } from '../../src/app/obe';
import type { ClassRecord, Student, TermSetup } from '../../src/app/types';
import type { ObeConfig } from '../../src/engine';

const obe: ObeConfig = {
  programName: 'BS Computer Engineering',
  pos: [
    { id: 'pa', code: 'a', description: 'Apply mathematics' },
    { id: 'pm', code: 'm', description: 'Specialized field' },
  ],
  cos: [
    { id: 'co1', code: 'CO1', description: '', agaCodes: [], poCodes: ['a'], passRawPct: 60, targetClassPct: 75 },
    { id: 'co2', code: 'CO2', description: '', agaCodes: [], poCodes: ['a'], passRawPct: 60, targetClassPct: 75 },
  ],
  los: [
    { id: 'l1', code: 'LO 1.1', moduleCode: 'M1', term: 'PRELIM', coIds: ['co1'], description: '' },
    { id: 'l2', code: 'LO 1.2', moduleCode: 'M1', term: 'PRELIM', coIds: ['co1'], description: '' },
    { id: 'l3', code: 'LO 2.1', moduleCode: 'M2', term: 'MIDTERM', coIds: ['co1'], description: '' },
    { id: 'l4', code: 'LO 3.1', moduleCode: 'M3', term: 'FINAL', coIds: ['co2'], description: '' },
  ],
};

const term = (p: string): TermSetup => ({
  csMode: 'RAW_SUM',
  categories: [],
  columns: [
    { id: `${p}q`, label: `${p} Quiz`, maxScore: 100, component: 'CS', coIds: ['co1'], loIds: ['l1', 'gone'] },
    { id: `${p}ex`, label: `${p} Exam`, maxScore: 100, component: 'WE', coIds: ['co2'] },
  ],
});

const student = (id: string, mark: string): Student => ({
  id,
  studentId: `T-${id}`,
  name: `Student ${id}`,
  scores: Object.fromEntries(['p', 'm', 'f'].flatMap((p) => [[`${p}q`, mark], [`${p}ex`, mark]])),
  statuses: {},
});

const record: ClassRecord = {
  id: 'c',
  subjectCode: 'CpE 122',
  subjectName: 'Discrete Math',
  section: 'A',
  subjectType: 'LEC',
  terms: { PRELIM: term('p'), MIDTERM: term('m'), FINAL: term('f') },
  // a: 100% everywhere (FR 100); b: 50% everywhere (transmuted 73, FR 73); c: no scores.
  students: [student('a', '100'), student('b', '50'), student('c', '')],
  obe,
  updatedAt: 0,
};

describe('obeReport', () => {
  it('is null until the class has syllabus outcomes', () => {
    expect(obeReport({ ...record, obe: undefined })).toBeNull();
    expect(obeReport(record)!.classCos.OVERALL[0]).toMatchObject({ attainedCount: 1, totalGraded: 2, attainmentPct: 50 });
  });
});

describe('columnTags', () => {
  it('lists the codes in syllabus order and skips deleted outcomes', () => {
    expect(columnTags(obe, record.terms.PRELIM.columns[0]!)).toEqual({ cos: ['CO1'], los: ['LO 1.1'] });
    expect(columnTags(undefined, record.terms.PRELIM.columns[0]!)).toEqual({ cos: [], los: [] });
  });
});

describe('vpaaForRecord', () => {
  it("uses each student's whole-number Final Rating", () => {
    const sheet = vpaaForRecord(record, obe);
    expect(sheet.students.map((s) => s.finalGrade)).toEqual([100, 73, null]);
    expect(sheet.students[0]!.contributions).toEqual({ co1: 75, co2: 25 });
    expect(sheet.students[1]!.contributions).toEqual({ co1: 54.75, co2: 18.25 });
    expect(sheet.summary).toMatchObject({ totalGraded: 2, attainedCount: 1, notAttainedCount: 1 });
  });
});

describe('vpaaWorkbook', () => {
  const wb = XLSX.read(vpaaWorkbook(record, obe), { type: 'array' });
  /** Sheet rows, without the null padding up to the sheet's widest row. */
  const rows = (name: string) =>
    XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, defval: null }).map((r) => {
      const row = [...r];
      while (row.length > 0 && row.at(-1) === null) row.pop();
      return row;
    });

  it('has the CO Attainment and PO Attainment sheets', () => {
    expect(wb.SheetNames).toEqual(['CO Attainment', 'PO Attainment']);
  });

  it('writes the module table, contributions and summary', () => {
    const co = rows('CO Attainment');
    const find = (first: unknown) => co.find((r) => r[0] === first)!;
    expect(find('M1')).toEqual(['M1', 'Prelim', 'LO 1.1, LO 1.2', '']);
    expect(find('No. of LOs')).toEqual(['No. of LOs', '', 3, 1]);
    expect(find('CO weight')).toEqual(['CO weight', '', '75.00%', '25.00%']);
    expect(find(1)).toEqual([1, 'T-a', 'Student a', 100, 75, 25, 'Attained']);
    expect(find(2)).toEqual([2, 'T-b', 'Student b', 73, 54.75, 18.25, 'Not Attained']);
    expect(find(3)).toEqual([3, 'T-c', 'Student c', null, null, null, 'No Final Rating yet']);
    expect(find('% students attained CO')).toEqual(['% students attained CO', '50.00%']);
  });

  it('writes the CO-to-PO mapping and the course row', () => {
    const po = rows('PO Attainment');
    const find = (first: unknown) => po.find((r) => r[0] === first)!;
    expect(find('Course Outcome')).toEqual(['Course Outcome', 'a', 'm']);
    expect(find('CO1')).toEqual(['CO1', 1]);
    expect(find('CpE 122')).toEqual(['CpE 122', 1, 0]);
    expect(find('Total POs mapped')).toEqual(['Total POs mapped', 1]);
  });

  it('names the file after the class', () => {
    expect(vpaaFileName(record)).toBe('CpE 122 A VPAA OBE.xlsx');
  });
});

describe('nextOutcomeCode', () => {
  it('numbers COs after the existing ones, skipping codes already taken', () => {
    expect(nextOutcomeCode('CO', [])).toBe('CO1');
    expect(nextOutcomeCode('CO', ['CO1', 'CO3'])).toBe('CO4'); // CO2 deleted: not a second CO3
  });

  it('letters POs after the existing ones, skipping codes already taken', () => {
    expect(nextOutcomeCode('PO', [])).toBe('A');
    expect(nextOutcomeCode('PO', ['B', 'C'])).toBe('D'); // A deleted: not a second C
  });

  it('numbers POs once the letters run out', () => {
    const az = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    expect(nextOutcomeCode('PO', az)).toBe('PO27');
  });
});
