import { BP, rules, type Status, type SubjectType, type Term } from '../engine';

export const TERM_LABEL: Record<Term, string> = { PRELIM: 'Prelim', MIDTERM: 'Midterm', FINAL: 'Final' };

/** "20%" etc., from the rules file. */
export const termWeightLabel = (term: Term) => `${(rules.finalRatingBp[term] / BP) * 100}%`;

const pct = (bp: number) => String(Math.round((bp / BP) * 10000) / 100);

export const SUBJECT_TYPES: SubjectType[] = ['LEC', 'LAB', 'COMPOSITE'];
const SUBJECT_NAME: Record<SubjectType, string> = { LEC: 'Lecture', LAB: 'Laboratory', COMPOSITE: 'Composite' };
/** "50/50 CS/WE" etc., from the rules file. */
export const subjectSplitLabel = (t: SubjectType) => `${pct(rules.weightBp[t].cs)}/${pct(rules.weightBp[t].we)} CS/WE`;
export const subjectTypeName = (t: SubjectType) => SUBJECT_NAME[t];
export const subjectTypeLabel = (t: SubjectType) =>
  `${SUBJECT_NAME[t]} ${pct(rules.weightBp[t].cs)}/${pct(rules.weightBp[t].we)}`;

export const STATUSES: Status[] = ['INC', 'ABS', 'HNA', 'DRP', 'WP'];
export const STATUS_NAME: Record<Status, string> = {
  INC: 'Incomplete',
  ABS: 'Absent',
  HNA: 'Has No Attendance',
  DRP: 'Dropped',
  WP: 'Withdrawn with Permission',
};
