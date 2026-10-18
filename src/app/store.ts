// Single source of truth for the open class records (blueprint §3, State Layer).
// Every change to a class is auto-saved to IndexedDB.
import { create } from 'zustand';
import type { Status, SubjectType, Term } from '../engine';
import { db, getMeta, setMeta } from './db';
import { mergeMastersoftRows, subjectTypeFromSubject, tidy, type MastersoftFile, type MergeResult } from './mastersoftFile';
import type { Category, ClassRecord, Column, CsMode, ReverseInput, Student, TermSetup, View } from './types';

const newId = () => crypto.randomUUID();
const emptyTerm = (): TermSetup => ({ csMode: 'RAW_SUM', categories: [], columns: [] });

export const newStudent = (): Student => ({ id: newId(), studentId: '', name: '', scores: {}, statuses: {} });

export interface ClassInfo {
  subjectCode: string;
  subjectName: string;
  section: string;
  subjectType: SubjectType;
}

/** Column key used by grid paste: a student field or a score column id. */
export type CellKey = 'studentId' | 'name' | { columnId: string };

interface State {
  loaded: boolean;
  noticeSeen: boolean;
  classes: ClassRecord[];
  activeClassId: string | null;
  view: View;
  drawer: { studentId: string; term: Term } | null;

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

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleSave(record: ClassRecord) {
  clearTimeout(saveTimers.get(record.id));
  saveTimers.set(
    record.id,
    setTimeout(() => {
      saveTimers.delete(record.id);
      void db.classes.put(record);
    }, 300),
  );
}

export const useStore = create<State>()((set, get) => {
  /** Applies `fn` to the active class and saves the result. */
  const update = (fn: (c: ClassRecord) => ClassRecord) => {
    const { classes, activeClassId } = get();
    set({
      classes: classes.map((c) => {
        if (c.id !== activeClassId) return c;
        const next = { ...fn(c), updatedAt: Date.now() };
        scheduleSave(next);
        return next;
      }),
    });
  };
  const updateTerm = (term: Term, fn: (t: TermSetup) => TermSetup) =>
    update((c) => ({ ...c, terms: { ...c.terms, [term]: fn(c.terms[term]) } }));
  const updateStudent = (id: string, fn: (s: Student) => Student) =>
    update((c) => ({ ...c, students: c.students.map((s) => (s.id === id ? fn(s) : s)) }));

  return {
    loaded: false,
    noticeSeen: false,
    classes: [],
    activeClassId: null,
    view: 'PRELIM',
    drawer: null,

    async load() {
      const [classes, noticeSeen, activeClassId] = await Promise.all([
        db.classes.orderBy('updatedAt').reverse().toArray(),
        getMeta<boolean>('noticeSeen'),
        getMeta<string>('activeClassId'),
      ]);
      const active = classes.find((c) => c.id === activeClassId) ?? classes[0];
      set({ loaded: true, classes, noticeSeen: !!noticeSeen, activeClassId: active?.id ?? null });
    },
    acceptNotice() {
      set({ noticeSeen: true });
      void setMeta('noticeSeen', true);
    },
    setView: (view) => set({ view, drawer: null }),
    openDrawer: (drawer) => set({ drawer }),
    selectClass(id) {
      set({ activeClassId: id, drawer: null });
      void setMeta('activeClassId', id);
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
      void db.classes.put(record);
      void setMeta('activeClassId', record.id);
    },
    updateClassInfo: (info) => update((c) => ({ ...c, ...info })),
    deleteClass(id) {
      clearTimeout(saveTimers.get(id));
      const classes = get().classes.filter((c) => c.id !== id);
      const activeClassId = get().activeClassId === id ? (classes[0]?.id ?? null) : get().activeClassId;
      set({ classes, activeClassId, drawer: null });
      void db.classes.delete(id);
      if (activeClassId) void setMeta('activeClassId', activeClassId);
    },
    importMastersoft(file, target) {
      if (target === 'active' && get().activeClassId) {
        let result!: MergeResult;
        update((c) => {
          result = mergeMastersoftRows(c.students, file.rows, newStudent);
          return { ...c, students: result.students, mastersoftSession: file.session ?? c.mastersoftSession };
        });
        return result;
      }
      const first = file.rows[0]!;
      get().createClass({
        subjectCode: file.subjectCode ?? '',
        subjectName: tidy(first.subject.replace(/\(\s*(lec|lab)\s*\)\s*$/i, '')),
        section: tidy(first.section),
        subjectType: subjectTypeFromSubject(first.subject) ?? 'LEC',
      });
      const result = mergeMastersoftRows([], file.rows, newStudent);
      update((c) => ({ ...c, students: result.students, mastersoftSession: file.session }));
      return result;
    },

    setCsMode: (term, csMode) => updateTerm(term, (t) => ({ ...t, csMode })),
    saveColumn: (term, column) =>
      updateTerm(term, (t) => ({
        ...t,
        columns: t.columns.some((c) => c.id === column.id)
          ? t.columns.map((c) => (c.id === column.id ? column : c))
          : [...t.columns, column],
      })),
    deleteColumn: (term, columnId) => {
      updateTerm(term, (t) => ({ ...t, columns: t.columns.filter((c) => c.id !== columnId) }));
      update((c) => ({
        ...c,
        students: c.students.map((s) => {
          const { [columnId]: _removed, ...scores } = s.scores;
          return { ...s, scores };
        }),
      }));
    },
    setCategories: (term, categories) => updateTerm(term, (t) => ({ ...t, categories })),

    addStudent: () => update((c) => ({ ...c, students: [...c.students, newStudent()] })),
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
    pasteBlock: (startRow, keys, startKey, rows) =>
      update((c) => {
        const students = [...c.students];
        rows.forEach((cells, r) => {
          const i = startRow + r;
          const student = { ...(students[i] ?? newStudent()) };
          student.scores = { ...student.scores };
          cells.forEach((value, k) => {
            const key = keys[startKey + k];
            if (key === undefined) return;
            const v = value.trim();
            if (key === 'studentId' || key === 'name') student[key] = v;
            else student.scores[key.columnId] = v;
          });
          students[i] = student;
        });
        return { ...c, students };
      }),
  };
});

export const useActiveClass = () => useStore((s) => s.classes.find((c) => c.id === s.activeClassId) ?? null);
