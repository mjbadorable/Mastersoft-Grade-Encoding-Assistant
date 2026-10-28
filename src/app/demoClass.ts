// A made-up class for first-time users to explore (no real student data).
import { OBE_DEFAULT_CONFIG, type ObeConfig, type Term } from '../engine';
import type { ClassRecord, Column, Student, TermSetup } from './types';

const TERM_LIST: Term[] = ['PRELIM', 'MIDTERM', 'FINAL'];
const TERM_KEY: Record<Term, string> = { PRELIM: 'prelim', MIDTERM: 'midterm', FINAL: 'final' };

const CO_TEXT: Record<string, string> = {
  co1: 'Describe how art reflects culture, history and society.',
  co2: 'Analyze artworks using the elements and principles of art.',
  co3: 'Evaluate artworks and express informed, respectful opinions about them.',
};
const LO_TEXT: Record<Term, string[]> = {
  PRELIM: ['Define art and its functions.', 'Identify the major art forms.'],
  MIDTERM: ['Apply the elements and principles of art to a work.', 'Compare styles across periods.'],
  FINAL: ['Critique an artwork with evidence.', 'Present a reflection on a chosen artwork.'],
};

/** CO1–CO3 with descriptions, and the learning outcomes the default setup lays out per term. */
function demoObe(): ObeConfig {
  const used: Record<Term, number> = { PRELIM: 0, MIDTERM: 0, FINAL: 0 };
  return {
    ...OBE_DEFAULT_CONFIG,
    programName: 'Sample Program',
    cos: OBE_DEFAULT_CONFIG.cos.map((c) => ({ ...c, description: CO_TEXT[c.id] ?? '' })),
    los: OBE_DEFAULT_CONFIG.los.map((l) => ({ ...l, description: LO_TEXT[l.term][used[l.term]++] ?? '' })),
  };
}

const COLUMNS: { key: string; label: string; maxScore: number; component: Column['component'] }[] = [
  { key: 'quiz', label: 'Quiz', maxScore: 50, component: 'CS' },
  { key: 'activity', label: 'Activity', maxScore: 50, component: 'CS' },
  { key: 'exam', label: 'Exam', maxScore: 100, component: 'WE' },
];

const colId = (term: Term, key: string) => `demo-${TERM_KEY[term]}-${key}`;

function demoTerm(term: Term, obe: ObeConfig): TermSetup {
  const co = obe.cos[TERM_LIST.indexOf(term)]!;
  const los = obe.los.filter((l) => l.term === term);
  return {
    csMode: 'RAW_SUM',
    categories: [],
    columns: COLUMNS.map((c) => ({
      id: colId(term, c.key),
      label: c.label,
      maxScore: c.maxScore,
      component: c.component,
      // Each term assesses one CO. Quiz and Activity cover the term's first LO, the Exam all of them.
      coIds: [co.id],
      loIds: (c.key === 'exam' ? los : los.slice(0, 1)).map((l) => l.id),
    })),
  };
}

type Marks = [quiz: number, activity: number, exam: number] | null;

const student = (n: number, name: string, marks: Record<Term, Marks>, statuses: Student['statuses'] = {}): Student => ({
  id: `demo-student-${n}`,
  studentId: `DEMO-${String(n).padStart(3, '0')}`,
  name,
  scores: Object.fromEntries(TERM_LIST.flatMap((t) => (marks[t] ?? []).map((v, i) => [colId(t, COLUMNS[i]!.key), String(v)] as const))),
  statuses,
});

/**
 * "GE 6 – Art Appreciation", section 1-A, with five made-up students whose Final Ratings land on
 * 1.0 (high pass), 2.1 (typical pass), 3.0 (borderline pass) and 5.0 (failed), plus one INC in the Final term.
 */
export function createDemoClass(): ClassRecord {
  const obe = demoObe();
  return {
    id: crypto.randomUUID(),
    subjectCode: 'GE 6',
    subjectName: 'Art Appreciation',
    section: '1-A',
    subjectType: 'LEC',
    terms: { PRELIM: demoTerm('PRELIM', obe), MIDTERM: demoTerm('MIDTERM', obe), FINAL: demoTerm('FINAL', obe) },
    students: [
      student(1, 'Sample Student A', { PRELIM: [50, 50, 100], MIDTERM: [50, 50, 100], FINAL: [50, 50, 100] }),
      student(2, 'Sample Student B', { PRELIM: [40, 39, 79], MIDTERM: [39, 39, 78], FINAL: [39, 39, 78] }),
      student(3, 'Sample Student C', { PRELIM: [30, 30, 60], MIDTERM: [30, 30, 60], FINAL: [30, 30, 60] }),
      student(4, 'Sample Student D', { PRELIM: [27, 28, 55], MIDTERM: [27, 28, 55], FINAL: [27, 28, 55] }),
      student(5, 'Sample Student E', { PRELIM: [42, 41, 84], MIDTERM: [40, 42, 82], FINAL: null }, { FINAL: 'INC' }),
    ],
    obe,
    demo: true,
    updatedAt: Date.now(),
  };
}
