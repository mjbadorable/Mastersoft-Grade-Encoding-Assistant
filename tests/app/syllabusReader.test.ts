// Reading a syllabus PDF in the browser and turning it into the class's OBE setup.
import { existsSync, readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  extractSyllabusFromLines,
  obeConfigFromExtraction,
  pdfLines,
  type SyllabusExtraction,
  type SyllabusLine,
} from '../../src/app/syllabusReader';

const counter = () => {
  let n = 0;
  return () => `id${++n}`;
};

const extraction: SyllabusExtraction = {
  collegeName: 'College of Business ',
  programName: '',
  pos: [
    { code: 'A', description: 'Tourism knowledge' },
    { code: 'D', description: 'IT applications ' },
  ],
  cos: [
    { code: 'CO1', description: 'Apply tools', agaCodes: ['B', 'C', 'B'], poCodes: ['A', 'd', 'Z'] },
    { code: 'CO 2', description: 'Produce documents', agaCodes: [], poCodes: ['D'] },
  ],
  los: [
    { code: 'LO 1.1', moduleCode: 'M1', term: 'PRELIM', coCodes: ['CO1', 'CO2'], description: 'Examine' },
    { code: 'LO 2.3', moduleCode: 'M2', term: 'PRELIM', coCodes: ['co2'], description: 'Defend' },
    { code: 'LO 2.3', moduleCode: 'M2', term: 'PRELIM', coCodes: ['CO2'], description: 'Simulate' },
    { code: 'LO 3.1', moduleCode: 'M3', term: 'MIDTERM', coCodes: ['CO9'], description: 'Orphan' },
  ],
  passRawPct: 60,
  targetClassPct: null,
  notes: ['Terms guessed from exam coverage.'],
};

describe('obeConfigFromExtraction', () => {
  const { config, notes } = obeConfigFromExtraction(extraction, counter());

  it('keeps the outcomes in syllabus order with fresh ids', () => {
    expect(config.pos.map((p) => [p.id, p.code, p.description])).toEqual([
      ['id1', 'A', 'Tourism knowledge'],
      ['id2', 'D', 'IT applications'],
    ]);
    expect(config.cos.map((c) => c.code)).toEqual(['CO1', 'CO 2']);
    expect(config.collegeName).toBe('College of Business');
    expect(config.programName).toBeUndefined();
  });

  it('matches CO → PO and LO → CO links ignoring case and spaces, dropping unknown codes', () => {
    const [co1, co2] = config.cos;
    expect(co1).toMatchObject({ agaCodes: ['B', 'C'], poCodes: ['A', 'D'], passRawPct: 60, targetClassPct: 75 });
    expect(co2!.poCodes).toEqual(['D']);
    expect(config.los[0]!.coIds).toEqual([co1!.id, co2!.id]);
    expect(config.los[1]!.coIds).toEqual([co2!.id]);
    expect(config.los[3]!.coIds).toEqual([]);
  });

  it('renames repeated codes', () => {
    expect(config.los.map((l) => l.code)).toEqual(['LO 1.1', 'LO 2.3', 'LO 2.3 (2)', 'LO 3.1']);
  });

  it("lists the parser's notes and every fix it made for the teacher to check", () => {
    expect(notes).toEqual([
      'Terms guessed from exam coverage.',
      'CO1 links to PO "Z", which is not in the PO list; the link was left out.',
      'The syllabus uses LO code "LO 2.3" more than once; the repeat is named "LO 2.3 (2)".',
      'LO 3.1 has no course outcome link; add one in the Learning outcomes table.',
    ]);
  });
});

/** A line of text pieces at the given x positions. */
const line = (page: number, ...segs: [number, string][]): SyllabusLine => ({ page, segs: segs.map(([x, text]) => ({ x, text })) });

describe('extractSyllabusFromLines (USA layout, decimal LOs)', () => {
  // A cut-down syllabus in the HM5 layout: CO descriptions wrap above and below their "CO n:" label.
  const lines = [
    line(1, [385, 'College of Business']),
    line(1, [19, 'PROGRAM EDUCATIONAL OBJECTIVES (PEO)'], [495, 'PROGRAM OUTCOMES (PO)']),
    line(1, [495, 'By the time of graduation, the students of the'], [717, 'BSHM'], [752, 'program shall have the ability to:']),
    line(1, [19, '1. Practicing professionals'], [495, 'A. Demonstrate knowledge of tourism']),
    line(1, [495, 'B. Manage a service-oriented business']),
    line(1, [495, 'organization']),
    line(2, [24, 'Course Title'], [633, 'Course Code']),
    line(2, [23, 'Course Outcomes:'], [353, 'AGA'], [411, 'PO Code'], [478, 'Course Outcomes:']),
    line(2, [77, 'Apply technological tools']),
    line(2, [29, 'CO 1:'], [339, 'B'], [362, 'C'], [408, 'A']),
    line(2, [77, 'to the hospitality industry']),
    line(2, [29, 'CO 2:'], [77, 'Produce reports'], [339, 'A'], [408, 'B']),
    line(3, [23, 'PRELIM']),
    line(3, [23, 'M0.'], [200, 'N/A'], [243, 'LO 0.1. The University Vision']),
    line(3, [23, 'M1.'], [198, 'CO1'], [243, 'LEC']),
    line(3, [198, 'CO2'], [243, 'LO 1.1.'], [285, 'Examine how technology'], [593, '- Lecture discussion']),
    line(3, [243, 'enhances operations.']),
    line(3, [243, 'LAB']),
    line(3, [243, 'LO 1.2 Apply software']),
    line(3, [35, 'PRELIM EXAMINATION']),
    line(4, [676, 'Page No.'], [775, 'Page'], [803, '4'], [813, 'of'], [825, '10']),
    line(4, [23, 'MIDTERM']),
    line(4, [23, 'M2.'], [201, 'CO2'], [246, 'LO 2.1 Design a hotel website']),
    line(5, [23, 'Note: Passing rate for all activities, quizzes, assessments is 60%.']),
  ];
  const x = extractSyllabusFromLines(lines);

  it('reads the college, program, POs and pass mark', () => {
    expect(x.collegeName).toBe('College of Business');
    expect(x.programName).toBe('BSHM');
    expect(x.pos).toEqual([
      { code: 'A', description: 'Demonstrate knowledge of tourism' },
      { code: 'B', description: 'Manage a service-oriented business organization' },
    ]);
    expect(x.passRawPct).toBe(60);
  });

  it('reads COs with descriptions split around the label, AGA and PO letters', () => {
    expect(x.cos).toEqual([
      { code: 'CO1', description: 'Apply technological tools to the hospitality industry', agaCodes: ['B', 'C'], poCodes: ['A'] },
      { code: 'CO2', description: 'Produce reports', agaCodes: ['A'], poCodes: ['B'] },
    ]);
  });

  it('reads LOs per module and term, skipping LO 0.x, and links each module to its COs', () => {
    expect(x.los).toEqual([
      { code: 'LO 1.1', moduleCode: 'M1', term: 'PRELIM', coCodes: ['CO1', 'CO2'], description: 'Examine how technology enhances operations.' },
      { code: 'LO 1.2', moduleCode: 'M1', term: 'PRELIM', coCodes: ['CO1', 'CO2'], description: 'Apply software' },
      { code: 'LO 2.1', moduleCode: 'M2', term: 'MIDTERM', coCodes: ['CO2'], description: 'Design a hotel website' },
    ]);
    expect(x.notes).toEqual([]);
  });

  it('says so when the layout is not recognised', () => {
    expect(extractSyllabusFromLines([line(1, [10, 'Just some text'])]).notes).toHaveLength(3);
  });
});

// The two real syllabi from docs/05. They are not kept in this repository, so these tests
// run only on a computer that has them in Downloads\Course Syllabus.
const SYLLABI = 'C:/Users/Marvin/Downloads/Course Syllabus/';
const HM5 = `${SYLLABI}1st Sem AY 2025-2026 UPDATED-HM5-Syllabi-Template-Pure-Lec_Lab.docx.pdf`;
const CPE122 = `${SYLLABI}2Guanzon-Syllabus2ndAY23-24-CpE122-Discrete-Math.docx.pdf`;
const readPdf = async (path: string) =>
  extractSyllabusFromLines(await pdfLines(await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) }).promise));

describe.skipIf(!existsSync(HM5))('HM5 syllabus PDF (College of Business, decimal LOs)', () => {
  it('reads every outcome and link', async () => {
    const x = await readPdf(HM5);
    expect(x.collegeName).toBe('College of Business');
    expect(x.programName).toBe('BSHM');
    expect(x.passRawPct).toBe(60);
    expect(x.pos.map((p) => p.code)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    expect(x.pos[5]!.description).toBe('Demonstrate administrative and managerial skills in a service-oriented business organization');
    expect(x.pos[7]!.description).toBe('Perform human capital development functions of a tourism oriented organization');
    expect(x.cos).toEqual([
      { code: 'CO1', description: 'Apply technological tools and systems relevant to the hospitality industry', agaCodes: ['B', 'C'], poCodes: ['A', 'D', 'E'] },
      {
        code: 'CO2',
        description: 'Produce hospitality-related documents and reports using digital tools, adhering to professional formats, and ethical practices',
        agaCodes: ['A', 'B', 'C'],
        poCodes: ['B', 'D', 'G'],
      },
      { code: 'CO3', description: 'Evaluate the integration of current technological innovations', agaCodes: ['A', 'B', 'C'], poCodes: ['C', 'F', 'H'] },
    ]);
    expect(x.los).toHaveLength(36);
    const byModule = (m: string) => x.los.filter((l) => l.moduleCode === m);
    expect(['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map((m) => [byModule(m).length, byModule(m)[0]!.term])).toEqual([
      [6, 'PRELIM'],
      [6, 'PRELIM'],
      [6, 'MIDTERM'],
      [6, 'MIDTERM'],
      [6, 'FINAL'],
      [6, 'FINAL'],
    ]);
    expect(x.los.every((l) => l.coCodes.join() === 'CO1,CO2,CO3')).toBe(true);
    expect(x.los[0]).toEqual({
      code: 'LO 1.1',
      moduleCode: 'M1',
      term: 'PRELIM',
      coCodes: ['CO1', 'CO2', 'CO3'],
      description: 'Examine how technology enhances tourism operations and the functions of front office systems.',
    });
    // The syllabus numbers the first lab LO of M2 "LO 2.3" too; the setup renames the repeat.
    expect(x.los.filter((l) => l.code === 'LO 2.3').map((l) => l.description)).toEqual([
      'Defend the use of automated email systems as a strategic communication solution in hospitality industry operations.',
      'Simulate a basic automated workflow for a common hospitality business task using online tools.',
    ]);
    expect(x.los.at(-1)!.description).toBe(
      'Create a proposal using digital tools that demonstrates the application of smart or sustainable hospitality technologies.',
    );
    const { config, notes } = obeConfigFromExtraction(x, counter());
    expect(config.los.map((l) => l.code)).toContain('LO 2.3 (2)');
    expect(notes).toEqual(['The syllabus uses LO code "LO 2.3" more than once; the repeat is named "LO 2.3 (2)".']);
  });
});

describe.skipIf(!existsSync(CPE122))('CpE122 syllabus PDF (College of Technology, LOs numbered per module)', () => {
  it('reads every outcome and link', async () => {
    const x = await readPdf(CPE122);
    expect(x.collegeName).toBe('College of Technology');
    expect(x.programName).toBe('BSCpE');
    expect(x.passRawPct).toBe(60);
    expect(x.pos.map((p) => p.code).join('')).toBe('abcdefghijklmn');
    expect(x.pos[2]!.description).toBe(
      'design a system, component, or process to meet desired needs within realistic constraints such as economic, environmental, social, political, ethical, health and safety, manufacturability, and sustainability, in accordance with standards',
    );
    expect(x.cos).toEqual([
      { code: 'CO1', description: 'Demonstrate knowledge of the basic concepts of discrete mathematics', agaCodes: [], poCodes: ['a', 'm'] },
      { code: 'CO2', description: 'Solve problems in discrete math fundamental topics', agaCodes: [], poCodes: ['a', 'm'] },
      { code: 'CO3', description: 'Use logic and proofs techniques to prove theorems and problems', agaCodes: [], poCodes: ['a', 'm'] },
      { code: 'CO4', description: 'Use counting techniques, trees and graphs theory to solve problems', agaCodes: [], poCodes: ['a', 'm'] },
    ]);
    const modules = [...new Set(x.los.map((l) => l.moduleCode))].map((m) => {
      const los = x.los.filter((l) => l.moduleCode === m);
      return [m, los.length, los[0]!.term, los[0]!.coCodes.join(',')];
    });
    expect(modules).toEqual([
      ['M1', 4, 'PRELIM', 'CO1,CO2'],
      ['M2', 5, 'PRELIM', 'CO1,CO2,CO3'],
      ['M3', 6, 'PRELIM', 'CO1,CO2'],
      ['M4', 3, 'MIDTERM', 'CO1,CO4'],
      ['M5', 4, 'MIDTERM', 'CO1,CO2'],
      ['M6', 6, 'MIDTERM', 'CO1,CO4'],
      ['M7', 6, 'FINAL', 'CO1,CO4'],
      ['M8', 2, 'FINAL', 'CO1,CO2'],
    ]);
    expect(x.los[3]).toEqual({ code: 'M1-LO4', moduleCode: 'M1', term: 'PRELIM', coCodes: ['CO1', 'CO2'], description: 'solve problems on sequences and sums' });
    expect(x.los.at(-1)!.description).toBe('solve problems on finite state machines');
    expect(x.notes).toEqual([]);
  });
});
