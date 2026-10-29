// Single source of truth for the open class records (blueprint §3, State Layer).
// Every change to a class is saved to IndexedDB through the save queue, which re-applies
// it to the latest saved record so open tabs never overwrite each other (TC-028).
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { ObeConfig, Status, SubjectType, Term } from '../engine';
import { TERM_LABEL } from './labels';
import { backupFingerprint, restoreTemplates, restoreWorkspaceClasses } from './backup';
import { createDemoClass } from './demoClass';
import { clearColumn, copyTermSetup, duplicateClassSetup, fillColumn } from './gradebook';
import { announceChanges, classStorage, db, getMeta, keepStorage, onOtherTabChanges, setMeta, storagePersisted } from './db';
import { recordEdit, stepBack, stepForward, type ClassHistory } from './history';
import { mergeImportedScores, TEMPLATES_KEY, type ImportTemplate, type ImportedRow, type ImportMapping, type MergeScoresResult } from './excelImport';
import { mergeMastersoftRows, subjectTypeFromSubject, tidy, type MastersoftFile, type MergeResult } from './mastersoftFile';
import { normalizeClassObe } from './obe';
import { SaveQueue, type SaveStatus } from './saveQueue';
import type { Category, ClassRecord, Column, CsMode, ReverseInput, Student, TermSetup, View } from './types';

/** Bump when the Data Privacy Notice changes, so every teacher sees the new text once. */
const NOTICE_VERSION = 2;

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

// Actions are typed as properties, not methods: they are closures and never use `this`.
interface State {
  loaded: boolean;
  noticeSeen: boolean;
  classes: ClassRecord[];
  activeClassId: string | null;
  view: View;
  drawer: { studentId: string; term: Term } | null;
  saveStatus: SaveStatus;
  /** Set when this browser's storage could not be opened: nothing can be saved. */
  storageError: string | null;
  /** The browser's answer to "keep this app's data" (null: not asked yet or not supported). */
  storageKept: boolean | null;
  /** Content fingerprint of each class at its last backup (see backupFingerprint). */
  backedUp: Record<string, string>;
  /** A backup was downloaded or restored since the app opened (memory only; drives the backup reminder). */
  sessionBackupTaken: boolean;
  /** Undo / redo steps of each open class, kept in memory only (TC-029). */
  history: Record<string, ClassHistory>;

  load: () => Promise<void>;
  acceptNotice: () => void;
  /** Remembers that this class, as it is now, has been backed up. */
  markBackedUp: (record: ClassRecord) => void;
  setView: (view: View) => void;
  openDrawer: (drawer: State['drawer']) => void;
  selectClass: (id: string) => void;
  createClass: (info: ClassInfo) => void;
  /** Adds the sample demo class, opens it and shows its Prelim gradebook. */
  loadDemoClass: () => void;
  updateClassInfo: (info: ClassInfo) => void;
  /** Soft delete: the class waits in the Trash (restorable) until deleted permanently. Offers an undo notice. */
  trashClass: (id: string) => void;
  restoreClassFromTrash: (id: string) => void;
  archiveClass: (id: string) => void;
  unarchiveClass: (id: string) => void;
  /** Removes a class and its history from this browser for good. */
  deleteClassPermanent: (id: string) => void;
  /** Permanently deletes every class in the Trash. */
  emptyTrash: () => void;
  /** The class just moved to the Trash, shown as an undo notice until dismissed. */
  trashNotice: { id: string; label: string } | null;
  dismissTrashNotice: () => void;
  /** Clones a class's 3-term setup and OBE into a new class with no students; returns its id ('' if the source is gone). */
  duplicateClassSetup: (sourceClassId: string, newSection: string) => string;
  /** Mastersoft student list (D34): into a new class, or merged into the active one. */
  importMastersoft: (file: MastersoftFile, target: 'new' | 'active') => MergeResult;
  /** Smart Excel import (D7): mapped scores into one term of the active class. */
  importScores: (term: Term, mapping: ImportMapping, rows: ImportedRow[]) => MergeScoresResult;
  /** Restore a backup (D9), replacing the class with the same id or as a separate copy. */
  restoreClass: (record: ClassRecord, mode: 'replace' | 'copy') => void;
  /**
   * Restores a workspace backup. Merge keeps current classes and replaces the ones with a matching id;
   * replace leaves only the backup's classes. Saved import templates follow the same rule.
   */
  restoreWorkspace: (classes: ClassRecord[], templates: ImportTemplate[] | undefined, mode: 'merge' | 'replace') => void;
  /** Tries the changes that failed to save again. */
  retrySave: () => void;
  /** Steps the active class back / forward one edit and saves the result. */
  undo: () => void;
  redo: () => void;

  setCsMode: (term: Term, mode: CsMode) => void;
  saveColumn: (term: Term, column: Column) => void;
  deleteColumn: (term: Term, columnId: string) => void;
  /** Types one score into a column for the whole class. Students with a status in `term` are skipped. */
  fillColumnScores: (term: Term, columnId: string, value: string, mode: 'blanks-only' | 'all') => void;
  /** Removes every score typed in a column. */
  clearColumnScores: (term: Term, columnId: string) => void;
  setCategories: (term: Term, categories: Category[]) => void;
  setObeConfig: (obe: ObeConfig) => void;
  /** Gives a term the columns, categories and Class Standing mode of another; no scores (TC-029 undoes it). */
  copyTermSetup: (fromTerm: Term, toTerm: Term) => void;

  addStudent: () => void;
  deleteStudent: (id: string) => void;
  setStudentField: (id: string, field: 'studentId' | 'name', value: string) => void;
  setScore: (id: string, columnId: string, value: string) => void;
  setStatus: (id: string, term: Term, status: Status | undefined) => void;
  setReverse: (id: string, reverse: ReverseInput | undefined) => void;
  /** `order`: the record rows the pasted rows go to, when the grid is filtered or sorted; rows past it add students. */
  pasteBlock: (startRow: number, keys: CellKey[], startKey: number, rows: string[][], order?: number[]) => void;
}

const ignore = () => {};

/** In the class list: neither archived nor in the Trash. */
export const isLiveClass = (c: ClassRecord) => !c.deletedAt && !c.archived;
const firstLiveId = (classes: ClassRecord[], except?: string) => classes.find((c) => c.id !== except && isLiveClass(c))?.id ?? null;

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
      const saved = records[i] && normalizeClassObe(records[i]);
      if (!saved) classes = classes.filter((c) => c.id !== id);
      else if (classes.some((c) => c.id === id)) classes = classes.map((c) => (c.id === id ? saved : c));
      else classes = [saved, ...classes];
    });
    const activeClassId = classes.some((c) => c.id === get().activeClassId && !c.deletedAt) ? get().activeClassId : firstLiveId(classes);
    set({ classes, activeClassId });
  };

  const queue = new SaveQueue(classStorage, {
    onStatus: (saveStatus) => set({ saveStatus }),
    onSaved: (ids) => {
      void keepStorage().then((storageKept) => set({ storageKept }));
      announceChanges(ids);
      const all = [...new Set([...ids, ...staleFromOtherTabs])];
      staleFromOtherTabs.clear();
      void reload(all);
    },
  });

  /**
   * Applies an edit to the active class now, and queues it to be saved. `label` says what the
   * edit did (for undo); edits with the same `key` in quick succession count as one step.
   */
  const update = (edit: Edit, label: string, key?: string) => {
    const { classes, activeClassId, history } = get();
    const before = classes.find((c) => c.id === activeClassId);
    if (!activeClassId || !before) return;
    const ids: string[] = [];
    const replayIds = () => {
      let i = 0;
      return () => {
        if (ids[i] === undefined) ids[i] = newId();
        return ids[i++]!;
      };
    };
    const apply = (c: ClassRecord) => ({ ...edit(c, replayIds()), updatedAt: Date.now() });
    set({
      classes: classes.map((c) => (c.id === activeClassId ? apply(c) : c)),
      history: { ...history, [activeClassId]: recordEdit(history[activeClassId], before, label, key, Date.now()) },
    });
    queue.enqueue({ classId: activeClassId, change: (latest) => latest && apply(latest) });
  };
  const activeClass = () => get().classes.find((c) => c.id === get().activeClassId);
  /** A column's label for undo tooltips, looked up in every term of the active class. */
  const columnLabel = (columnId: string) =>
    Object.values(activeClass()?.terms ?? {})
      .flatMap((t) => t.columns)
      .find((c) => c.id === columnId)?.label ?? 'a deleted column';
  /** Moves the active class along its history and saves that exact copy (it replaces the saved class, other tabs' edits included). */
  const travel = (step: typeof stepBack) => {
    const { classes, activeClassId, history } = get();
    const current = activeClass();
    if (!activeClassId || !current) return;
    const result = step(history[activeClassId], current, Date.now());
    if (!result) return;
    const record = { ...result.record, updatedAt: Date.now() };
    set({
      classes: classes.map((c) => (c.id === activeClassId ? record : c)),
      history: { ...history, [activeClassId]: result.history },
      drawer: null,
    });
    saveWhole(activeClassId, record);
  };
  const updateTerm = (term: Term, fn: (t: TermSetup) => TermSetup, label: string) =>
    update((c) => ({ ...c, terms: { ...c.terms, [term]: fn(c.terms[term]) } }), label);
  const updateStudent = (id: string, fn: (s: Student) => Student, label: string, key?: string) =>
    update((c) => ({ ...c, students: c.students.map((s) => (s.id === id ? fn(s) : s)) }), label, key);
  /** Saves a whole record (new, restored) or deletes one. */
  const saveWhole = (classId: string, record: ClassRecord | 'delete') => queue.enqueue({ classId, change: () => record });
  const saveMeta = (key: string, value: unknown) => void setMeta(key, value).catch(ignore);
  /** Deletes classes from the list, the undo history and storage. */
  const removeForGood = (ids: string[]) => {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    const classes = get().classes.filter((c) => !gone.has(c.id));
    const activeClassId = gone.has(get().activeClassId ?? '') ? firstLiveId(classes) : get().activeClassId;
    const history = Object.fromEntries(Object.entries(get().history).filter(([id]) => !gone.has(id)));
    const trashNotice = get().trashNotice && gone.has(get().trashNotice!.id) ? null : get().trashNotice;
    set({ classes, activeClassId, history, drawer: null, trashNotice });
    ids.forEach((id) => saveWhole(id, 'delete'));
    if (activeClassId) saveMeta('activeClassId', activeClassId);
  };

  return {
    loaded: false,
    noticeSeen: false,
    classes: [],
    activeClassId: null,
    view: 'PRELIM',
    drawer: null,
    saveStatus: { state: 'idle' },
    storageError: null,
    storageKept: null,
    backedUp: {},
    history: {},
    sessionBackupTaken: false,

    async load() {
      try {
        const [classes, noticeSeen, activeClassId, backedUp] = await Promise.all([
          // Records saved by older versions may lack OBE fields: repaired on load (see normalizeClassObe).
          db.classes.orderBy('updatedAt').reverse().toArray().then((rows) => rows.map(normalizeClassObe)),
          getMeta<boolean | number>('noticeSeen'),
          getMeta<string>('activeClassId'),
          getMeta<Record<string, string>>('backedUp'),
        ]);
        // Open the class used last; never one in the Trash. If everything is archived, open an archived class.
        const active = classes.find((c) => c.id === activeClassId && !c.deletedAt) ?? classes.find(isLiveClass) ?? classes.find((c) => !c.deletedAt);
        set({
          loaded: true,
          classes,
          // Older versions stored `true`; the notice changed (offline use, backups), so they see it once more.
          noticeSeen: noticeSeen === NOTICE_VERSION,
          activeClassId: active?.id ?? null,
          backedUp: backedUp ?? {},
          storageKept: await storagePersisted(),
        });
        if (classes.length > 0) void keepStorage().then((storageKept) => set({ storageKept }));
      } catch (e) {
        // Private windows or blocked site data: the app still computes, but can't save.
        console.error('Opening IndexedDB failed', e);
        set({
          loaded: true,
          storageError:
            "This browser isn't letting the app save data (a private window or blocked site data can cause this). You can still compute grades, but nothing will be kept after you close this tab, so download a backup before closing.",
        });
        return;
      }
      onOtherTabChanges((ids) => void reload(ids));
      // Warn before closing the tab while changes are unsaved.
      window.addEventListener('beforeunload', (e) => {
        if (queue.busy) e.preventDefault();
      });
    },
    acceptNotice() {
      set({ noticeSeen: true });
      saveMeta('noticeSeen', NOTICE_VERSION);
    },
    markBackedUp(record) {
      const backedUp = { ...get().backedUp, [record.id]: backupFingerprint(record) };
      set({ backedUp, sessionBackupTaken: true });
      saveMeta('backedUp', backedUp);
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
    loadDemoClass() {
      const record = createDemoClass();
      set({ classes: [record, ...get().classes], activeClassId: record.id, view: 'PRELIM', drawer: null });
      saveWhole(record.id, record);
      saveMeta('activeClassId', record.id);
    },
    updateClassInfo: ({ subjectCode, subjectName, section, subjectType }) => update((c) => ({ ...c, subjectCode, subjectName, section, subjectType }), 'Edit class info'),
    duplicateClassSetup(sourceClassId, newSection) {
      const source = get().classes.find((c) => c.id === sourceClassId);
      if (!source) return '';
      const record = duplicateClassSetup(source, newSection, newId);
      // Undo leaves the new class as it would be without the copied setup.
      const blank: ClassRecord = { ...record, terms: { PRELIM: emptyTerm(), MIDTERM: emptyTerm(), FINAL: emptyTerm() }, obe: undefined };
      const label = `Duplicate setup from ${source.subjectCode} (${source.section})`;
      set({
        classes: [record, ...get().classes],
        activeClassId: record.id,
        history: { ...get().history, [record.id]: recordEdit(undefined, blank, label, undefined, Date.now()) },
        view: 'PRELIM',
        drawer: null,
      });
      saveWhole(record.id, record);
      saveMeta('activeClassId', record.id);
      return record.id;
    },
    trashNotice: null,
    dismissTrashNotice: () => set({ trashNotice: null }),
    trashClass(id) {
      const target = get().classes.find((c) => c.id === id);
      if (!target || target.deletedAt) return;
      const deletedAt = Date.now();
      const classes = get().classes.map((c) => (c.id === id ? { ...c, deletedAt, updatedAt: deletedAt } : c));
      const activeClassId = get().activeClassId === id ? firstLiveId(classes, id) : get().activeClassId;
      const label = [target.subjectCode, target.section].filter(Boolean).join(' · ') || 'Untitled class';
      set({ classes, activeClassId, drawer: null, trashNotice: { id, label } });
      queue.enqueue({ classId: id, change: (latest) => latest && { ...latest, deletedAt, updatedAt: deletedAt } });
      if (activeClassId) saveMeta('activeClassId', activeClassId);
    },
    restoreClassFromTrash(id) {
      const target = get().classes.find((c) => c.id === id);
      if (!target?.deletedAt) return;
      const restoredAt = Date.now();
      const bring = (c: ClassRecord): ClassRecord => {
        const { deletedAt: _out, ...rest } = c;
        return { ...rest, updatedAt: restoredAt };
      };
      set({ classes: get().classes.map((c) => (c.id === id ? bring(c) : c)), activeClassId: id, drawer: null, trashNotice: null });
      queue.enqueue({ classId: id, change: (latest) => latest && bring(latest) });
      saveMeta('activeClassId', id);
    },
    archiveClass(id) {
      const target = get().classes.find((c) => c.id === id);
      if (!target || target.deletedAt || target.archived) return;
      const at = Date.now();
      const classes = get().classes.map((c) => (c.id === id ? { ...c, archived: true, updatedAt: at } : c));
      const activeClassId = get().activeClassId === id ? firstLiveId(classes, id) : get().activeClassId;
      set({ classes, activeClassId, drawer: null });
      queue.enqueue({ classId: id, change: (latest) => latest && { ...latest, archived: true, updatedAt: at } });
      if (activeClassId) saveMeta('activeClassId', activeClassId);
    },
    unarchiveClass(id) {
      if (!get().classes.some((c) => c.id === id && c.archived)) return;
      const at = Date.now();
      set({ classes: get().classes.map((c) => (c.id === id ? { ...c, archived: false, updatedAt: at } : c)) });
      queue.enqueue({ classId: id, change: (latest) => latest && { ...latest, archived: false, updatedAt: at } });
    },
    deleteClassPermanent: (id) => removeForGood([id]),
    emptyTrash: () => removeForGood(get().classes.filter((c) => c.deletedAt !== undefined).map((c) => c.id)),
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
      }, 'Import Mastersoft student list');
      return result;
    },
    importScores(term, mapping, rows) {
      let result!: MergeScoresResult;
      update((c, nid) => {
        result = mergeImportedScores(c, term, mapping, rows, { student: () => newStudent(nid()), id: nid });
        return result.record;
      }, `Import scores from Excel into ${TERM_LABEL[term]}`);
      return result;
    },
    restoreClass(record, mode) {
      const restored = mode === 'copy' ? { ...record, id: newId(), updatedAt: Date.now() } : { ...record, updatedAt: Date.now() };
      set({
        classes: [restored, ...get().classes.filter((c) => c.id !== restored.id)],
        activeClassId: restored.id,
        history: { ...get().history, [restored.id]: { past: [], future: [] } },
        view: 'PRELIM',
        drawer: null,
      });
      saveWhole(restored.id, restored);
      saveMeta('activeClassId', restored.id);
      // Replaced from a backup file: that file already holds exactly this class.
      if (mode === 'replace') get().markBackedUp(restored);
    },
    restoreWorkspace(incoming, templates, mode) {
      const before = get().classes;
      const restored = incoming.map((c) => ({ ...c, updatedAt: Date.now() }));
      const classes = restoreWorkspaceClasses(before, restored, mode);
      const activeClassId = classes.some((c) => c.id === get().activeClassId) ? get().activeClassId : (classes[0]?.id ?? null);
      const removed = before.filter((c) => !classes.some((x) => x.id === c.id));
      const history = { ...get().history };
      for (const c of restored) history[c.id] = { past: [], future: [] };
      for (const c of removed) delete history[c.id];
      // The backup file holds exactly these classes.
      const backedUp = { ...get().backedUp };
      for (const c of restored) backedUp[c.id] = backupFingerprint(c);
      set({ classes, activeClassId, history, backedUp, drawer: null, sessionBackupTaken: true });
      for (const c of restored) saveWhole(c.id, c);
      for (const c of removed) saveWhole(c.id, 'delete');
      if (activeClassId) saveMeta('activeClassId', activeClassId);
      saveMeta('backedUp', backedUp);
      if (templates) {
        void getMeta<ImportTemplate[]>(TEMPLATES_KEY)
          .then((current) => setMeta(TEMPLATES_KEY, restoreTemplates(current ?? [], templates, mode)))
          .catch(ignore);
      }
    },
    retrySave: () => queue.retry(),
    undo: () => travel(stepBack),
    redo: () => travel(stepForward),

    setCsMode: (term, csMode) => updateTerm(term, (t) => ({ ...t, csMode }), 'Change Class Standing mode'),
    saveColumn: (term, column) =>
      updateTerm(
        term,
        (t) => ({
          ...t,
          columns: t.columns.some((c) => c.id === column.id)
            ? t.columns.map((c) => (c.id === column.id ? column : c))
            : [...t.columns, column],
        }),
        `${activeClass()?.terms[term].columns.some((c) => c.id === column.id) ? 'Edit' : 'Add'} column ${column.label}`,
      ),
    deleteColumn: (term, columnId) =>
      update(
        (c) => ({
          ...c,
          terms: { ...c.terms, [term]: { ...c.terms[term], columns: c.terms[term].columns.filter((col) => col.id !== columnId) } },
          students: c.students.map((s) => {
            const { [columnId]: _removed, ...scores } = s.scores;
            return { ...s, scores };
          }),
        }),
        `Delete column ${columnLabel(columnId)}`,
      ),
    fillColumnScores(term, columnId, value, mode) {
      const record = activeClass();
      const column = record?.terms[term].columns.find((c) => c.id === columnId);
      if (!record || !column || fillColumn(record, term, columnId, value, mode) === record) return;
      update((c) => fillColumn(c, term, columnId, value, mode), `Fill ${column.label} with ${value.trim()}`);
    },
    clearColumnScores(term, columnId) {
      const record = activeClass();
      const column = record?.terms[term].columns.find((c) => c.id === columnId);
      if (!record || !column || clearColumn(record, columnId) === record) return;
      update((c) => clearColumn(c, columnId), `Clear scores in ${column.label}`);
    },
    setCategories: (term, categories) => updateTerm(term, (t) => ({ ...t, categories }), 'Edit categories'),
    copyTermSetup(fromTerm, toTerm) {
      if (fromTerm === toTerm || !activeClass()?.terms[fromTerm].columns.length) return;
      update((c, nid) => copyTermSetup(c, fromTerm, toTerm, nid), `Copy setup from ${TERM_LABEL[fromTerm]} to ${TERM_LABEL[toTerm]}`);
    },
    setObeConfig: (obe) => update((c) => ({ ...c, obe }), 'Edit OBE setup'),

    addStudent: () => update((c, nid) => ({ ...c, students: [...c.students, newStudent(nid())] }), 'Add student'),
    deleteStudent: (id) => update((c) => ({ ...c, students: c.students.filter((s) => s.id !== id) }), 'Delete student'),
    setStudentField(id, field, value) {
      if (activeClass()?.students.find((s) => s.id === id)?.[field] === value) return;
      updateStudent(id, (s) => ({ ...s, [field]: value }), `Edit student ${field === 'name' ? 'name' : 'ID'}`, `${id}:${field}`);
    },
    setScore(id, columnId, value) {
      const student = activeClass()?.students.find((s) => s.id === id);
      if ((student?.scores[columnId] ?? '') === value) return;
      updateStudent(id, (s) => ({ ...s, scores: { ...s.scores, [columnId]: value } }), `Score edit in ${columnLabel(columnId)}`, `${id}:${columnId}`);
    },
    setStatus: (id, term, status) =>
      updateStudent(
        id,
        (s) => {
          const statuses = { ...s.statuses };
          if (status) statuses[term] = status;
          else delete statuses[term];
          return { ...s, statuses };
        },
        status ? `Set status ${status}` : 'Clear status',
      ),
    setReverse: (id, reverse) => updateStudent(id, (s) => ({ ...s, reverse }), 'Edit reverse-mode input', `${id}:reverse`),

    /** Pastes a block copied from Excel, adding students when it runs past the last row. */
    pasteBlock(startRow, keys, startKey, rows, order) {
      // Fix the target students now, by id, so the save lands on the same rows.
      const current = get().classes.find((c) => c.id === get().activeClassId)?.students ?? [];
      const targets = rows.map((_, r) => (order ? current[order[r] ?? -1] : current[startRow + r])?.id);
      const scoreCells = rows.reduce((n, cells) => n + cells.filter((_, k) => typeof keys[startKey + k] === 'object').length, 0);
      const cellCount = scoreCells || rows.reduce((n, cells) => n + cells.length, 0);
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
      }, `Paste ${cellCount} ${scoreCells ? 'score' : 'cell'}${cellCount === 1 ? '' : 's'} from Excel`);
    },
  };
});

/** What undo and redo would do for the open class (null: nothing to step through). */
export const useHistoryLabels = () =>
  useStore(
    useShallow((s) => {
      const h = s.activeClassId ? s.history[s.activeClassId] : undefined;
      return { undo: h?.past.at(-1)?.label ?? null, redo: h?.future.at(-1)?.label ?? null };
    }),
  );

export const useActiveClass = () => useStore((s) => s.classes.find((c) => c.id === s.activeClassId) ?? null);
