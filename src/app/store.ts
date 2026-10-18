// Single source of truth for the open class records (blueprint §3, State Layer).
// Every change to a class is saved to IndexedDB through the save queue, which re-applies
// it to the latest saved record so open tabs never overwrite each other (TC-028).
import { create } from 'zustand';
import type { Status, SubjectType, Term } from '../engine';
import { announceChanges, classStorage, db, getMeta, onOtherTabChanges, setMeta } from './db';
import { mergeImportedScores, type ImportedRow, type ImportMapping, type MergeScoresResult } from './excelImport';
import { mergeMastersoftRows, subjectTypeFromSubject, tidy, type MastersoftFile, type MergeResult } from './mastersoftFile';
import { SaveQueue, type SaveStatus } from './saveQueue';
import type { Category, ClassRecord, Column, CsMode, ReverseInput, Student, TermSetup, View } from './types';

const newId = (): string => crypto.randomUUID();
const emptyTerm = (): TermSetup => ({ csMode: 'RAW_SUM', categories: [], columns: [] });

export const newStudent = (id = newId()): Student => ({ id, studentId: '', name: '', scores: {}, statuses: {} });

export interface ClassInfo {
  subjectCode: string;
  subjectName: string;
  section: string;
  subjectType: SubjectType;
}

/** Column key used by grid paste: a student field or a score column id. */
export type CellKey = 'studentId' | 'name' | { columnId: string };

/**
 * An edit to one class. It runs on this tab's copy and again on the latest saved copy,
 * so it must give the same ids both times: take new ids from `nid`, never crypto directly.
 */
type Edit = (c: ClassRecord, nid: () => string) => ClassRecord;

interface State {
  loaded: boolean;
  noticeSeen: boolean;
  classes: ClassRecord[];
  activeClassId: string | null;
  view: View;
  drawer: { studentId: string; term: Term } | null;
  saveStatus: SaveStatus;

  load(): Promise<void>;
  acceptNotice(): void;
  setView(view: View): void;
  openDrawer(drawer: State['drawer']): void;
  selectClass(id: string): void;
  createClass(info: ClassInfo): void;
  updateClassInfo(info: ClassInfo): void;
  deleteClass(id: string): void;
  /** Mastersoft student list (D34): into a new class, or merged into the active one. */
  importMastersoft(file: MastersoftFile, target: 'new' | 'active'): MergeResult;
  /** Smart Excel import (D7): mapped scores into one term of the active class. */
  importScores(term: Term, mapping: ImportMapping, rows: ImportedRow[]): MergeScoresResult;
  /** Restore a backup (D9), replacing the class with the same id or as a separate copy. */
  restoreClass(record: ClassRecord, mode: 'replace' | 'copy'): void;
  /** Tries the changes that failed to save again. */
  retrySave(): void;

  setCsMode(term: Term, mode: CsMode): void;
  saveColumn(term: Term, column: Column): void;
  deleteColumn(term: Term, columnId: string): void;
  setCategories(term: Term, categories: Category[]): void;

  addStudent(): void;
  deleteStudent(id: string): void;
  setStudentField(id: string, field: 'studentId' | 'name', value: string): void;
  setScore(id: string, columnId: string, value: string): void;
  setStatus(id: string, term: Term, status: Status | undefined): void;
  setReverse(id: string, reverse: ReverseInput | undefined): void;
  pasteBlock(startRow: number, keys: CellKey[], startKey: number, rows: string[][]): void;
}

const ignore = () => {};

export const useStore = create<State>()((set, get) => {
  /** Classes changed in another tab while this tab still had changes to save. */
  const staleFromOtherTabs = new Set<string>();

  /** Replaces this tab's copies of these classes with the saved ones. */
  const reload = async (ids: string[]) => {
    const records = await db.classes.bulkGet(ids);
    if (queue.busy) {
      ids.forEach((id) => staleFromOtherTabs.add(id));
      return;
    }
    let classes = get().classes;
    ids.forEach((id, i) => {
      const saved = records[i];
      if (!saved) classes = classes.filter((c) => c.id !== id);
      else if (classes.some((c) => c.id === id)) classes = classes.map((c) => (c.id === id ? saved : c));
      else classes = [saved, ...classes];
    });
    const activeClassId = classes.some((c) => c.id === get().activeClassId) ? get().activeClassId : (classes[0]?.id ?? null);
    set({ classes, activeClassId });
  };

  const queue = new SaveQueue(classStorage, {
    onStatus: (saveStatus) => set({ saveStatus }),
    onSaved: (ids) => {
      announceChanges(ids);
      const all = [...new Set([...ids, ...staleFromOtherTabs])];
      staleFromOtherTabs.clear();
      void reload(all);
    },
  });

  /** Applies an edit to the active class now, and queues it to be saved. */
  const update = (edit: Edit) => {
    const { classes, activeClassId } = get();
    if (!activeClassId) return;
    const ids: string[] = [];
    const replayIds = () => {
      let i = 0;
      return () => {
        if (ids[i] === undefined) ids[i] = newId();
        return ids[i++]!;
      };
    };
    const apply = (c: ClassRecord) => ({ ...edit(c, replayIds()), updatedAt: Date.now() });
    set({ classes: classes.map((c) => (c.id === activeClassId ? apply(c) : c)) });
    queue.enqueue({ classId: activeClassId, change: (latest) => latest && apply(latest) });
  };
  const updateTerm = (term: Term, fn: (t: TermSetup) => TermSetup) =>
    update((c) => ({ ...c, terms: { ...c.terms, [term]: fn(c.terms[term]) } }));
  const updateStudent = (id: string, fn: (s: Student) => Student) =>
    update((c) => ({ ...c, students: c.students.map((s) => (s.id === id ? fn(s) : s)) }));
  /** Saves a whole record (new, restored) or deletes one. */
  const saveWhole = (classId: string, record: ClassRecord | 'delete') => queue.enqueue({ classId, change: () => record });
  const saveMeta = (key: string, value: unknown) => void setMeta(key, value).catch(ignore);

  return {
    loaded: false,
    noticeSeen: false,
    classes: [],
    activeClassId: null,
    view: 'PRELIM',
    drawer: null,
    saveStatus: { state: 'idle' },

    async load() {
      const [classes, noticeSeen, activeClassId] = await Promise.all([
        db.classes.orderBy('updatedAt').reverse().toArray(),
        getMeta<boolean>('noticeSeen'),
        getMeta<string>('activeClassId'),
      ]);
      const active = classes.find((c) => c.id === activeClassId) ?? classes[0];
      set({ loaded: true, classes, noticeSeen: !!noticeSeen, activeClassId: active?.id ?? null });
      onOtherTabChanges((ids) => void reload(ids));
      // Warn before closing the tab while changes are unsaved.
      window.addEventListener('beforeunload', (e) => {
        if (queue.busy) e.preventDefault();
      });
    },
    acceptNotice() {
      set({ noticeSeen: true });
      saveMeta('noticeSeen', true);
    },
    setView: (view) => set({ view, drawer: null }),
    openDrawer: (drawer) => set({ drawer }),
    selectClass(id) {
      set({ activeClassId: id, drawer: null });
      saveMeta('activeClassId', id);
    },
    createClass(info) {
      const record: ClassRecord = {
        id: newId(),
        ...info,
        terms: { PRELIM: emptyTerm(), MIDTERM: emptyTerm(), FINAL: emptyTerm() },
        students: [],
        updatedAt: Date.now(),
      };
      set({ classes: [record, ...get().classes], activeClassId: record.id, view: 'PRELIM', drawer: null });
      saveWhole(record.id, record);
      saveMeta('activeClassId', record.id);
    },
    updateClassInfo: ({ subjectCode, subjectName, section, subjectType }) => update((c) => ({ ...c, subjectCode, subjectName, section, subjectType })),
    deleteClass(id) {
      const classes = get().classes.filter((c) => c.id !== id);
      const activeClassId = get().activeClassId === id ? (classes[0]?.id ?? null) : get().activeClassId;
      set({ classes, activeClassId, drawer: null });
      saveWhole(id, 'delete');
      if (activeClassId) saveMeta('activeClassId', activeClassId);
    },
    importMastersoft(file, target) {
      if (!(target === 'active' && get().activeClassId)) {
        const first = file.rows[0]!;
        get().createClass({
          subjectCode: file.subjectCode ?? '',
          subjectName: tidy(first.subject.replace(/\(\s*(lec|lab)\s*\)\s*$/i, '')),
          section: tidy(first.section),
          subjectType: subjectTypeFromSubject(first.subject) ?? 'LEC',
        });
      }
      let result!: MergeResult;
      update((c, nid) => {
        result = mergeMastersoftRows(c.students, file.rows, () => newStudent(nid()));
        return { ...c, students: result.students, mastersoftSession: file.session ?? c.mastersoftSession };
      });
      return result;
    },
    importScores(term, mapping, rows) {
      let result!: MergeScoresResult;
      update((c, nid) => {
        result = mergeImportedScores(c, term, mapping, rows, { student: () => newStudent(nid()), id: nid });
        return result.record;
      });
      return result;
    },
    restoreClass(record, mode) {
      const restored = mode === 'copy' ? { ...record, id: newId(), updatedAt: Date.now() } : { ...record, updatedAt: Date.now() };
      set({
        classes: [restored, ...get().classes.filter((c) => c.id !== restored.id)],
        activeClassId: restored.id,
        view: 'PRELIM',
        drawer: null,
      });
      saveWhole(restored.id, restored);
      saveMeta('activeClassId', restored.id);
    },
    retrySave: () => queue.retry(),

    setCsMode: (term, csMode) => updateTerm(term, (t) => ({ ...t, csMode })),
    saveColumn: (term, column) =>
      updateTerm(term, (t) => ({
        ...t,
        columns: t.columns.some((c) => c.id === column.id)
          ? t.columns.map((c) => (c.id === column.id ? column : c))
          : [...t.columns, column],
      })),
    deleteColumn: (term, columnId) =>
      update((c) => ({
        ...c,
        terms: { ...c.terms, [term]: { ...c.terms[term], columns: c.terms[term].columns.filter((col) => col.id !== columnId) } },
        students: c.students.map((s) => {
          const { [columnId]: _removed, ...scores } = s.scores;
          return { ...s, scores };
        }),
      })),
    setCategories: (term, categories) => updateTerm(term, (t) => ({ ...t, categories })),

    addStudent: () => update((c, nid) => ({ ...c, students: [...c.students, newStudent(nid())] })),
    deleteStudent: (id) => update((c) => ({ ...c, students: c.students.filter((s) => s.id !== id) })),
    setStudentField: (id, field, value) => updateStudent(id, (s) => ({ ...s, [field]: value })),
    setScore: (id, columnId, value) => updateStudent(id, (s) => ({ ...s, scores: { ...s.scores, [columnId]: value } })),
    setStatus: (id, term, status) =>
      updateStudent(id, (s) => {
        const statuses = { ...s.statuses };
        if (status) statuses[term] = status;
        else delete statuses[term];
        return { ...s, statuses };
      }),
    setReverse: (id, reverse) => updateStudent(id, (s) => ({ ...s, reverse })),

    /** Pastes a block copied from Excel, adding students when it runs past the last row. */
    pasteBlock(startRow, keys, startKey, rows) {
      // Fix the target students now, by id, so the save lands on the same rows.
      const current = get().classes.find((c) => c.id === get().activeClassId)?.students ?? [];
      const targets = rows.map((_, r) => current[startRow + r]?.id);
      update((c, nid) => {
        const students = [...c.students];
        rows.forEach((cells, r) => {
          const id = targets[r];
          const i = id === undefined ? -1 : students.findIndex((s) => s.id === id);
          const student = { ...(i >= 0 ? students[i]! : newStudent(nid())) };
          student.scores = { ...student.scores };
          cells.forEach((value, k) => {
            const key = keys[startKey + k];
            if (key === undefined) return;
            const v = value.trim();
            if (key === 'studentId' || key === 'name') student[key] = v;
            else student.scores[key.columnId] = v;
          });
          if (i >= 0) students[i] = student;
          else students.push(student);
        });
        return { ...c, students };
      });
    },
  };
});

export const useActiveClass = () => useStore((s) => s.classes.find((c) => c.id === s.activeClassId) ?? null);
