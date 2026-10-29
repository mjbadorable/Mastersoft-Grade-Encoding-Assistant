// Per-class undo / redo (TC-029): steps restore the class, and IndexedDB follows every step.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getMeta, setMeta } from '../../src/app/db';
import { HISTORY_LIMIT, recordEdit } from '../../src/app/history';
import { useStore } from '../../src/app/store';
import type { ClassRecord } from '../../src/app/types';

const term = () => ({ csMode: 'RAW_SUM' as const, categories: [], columns: [] });
const classRecord = (id: string): ClassRecord => ({
  id,
  subjectCode: id,
  subjectName: '',
  section: '',
  subjectType: 'LEC',
  terms: { PRELIM: term(), MIDTERM: term(), FINAL: term() },
  students: [],
  updatedAt: 0,
});

const store = () => useStore.getState();
const active = () => store().classes.find((c) => c.id === store().activeClassId)!;
const labels = () => {
  const h = store().history[store().activeClassId!];
  return { undo: h?.past.at(-1)?.label ?? null, redo: h?.future.at(-1)?.label ?? null };
};
/** Waits until every queued change is in IndexedDB. */
const saved = () => vi.waitFor(() => expect(store().saveStatus.state).toBe('saved'));
const stored = async (id: string) => (await db.classes.get(id))!;

async function openClass(id = 'A') {
  await db.classes.clear();
  await db.classes.put(classRecord(id));
  useStore.setState({ classes: [classRecord(id)], activeClassId: id, history: {}, saveStatus: { state: 'idle' } });
}

/** Adds a Quiz 1 column and one student; returns the ids. */
async function seed() {
  store().saveColumn('PRELIM', { id: 'q1', label: 'Quiz 1', maxScore: 20, component: 'CS' });
  store().addStudent();
  await saved();
  return { studentId: active().students[0]!.id };
}

describe('undo / redo', () => {
  beforeEach(() => openClass());

  it('walks back and forward through several edits', async () => {
    const { studentId } = await seed();
    store().setScore(studentId, 'q1', '10');
    store().setStudentField(studentId, 'name', 'Ana');
    await saved();

    expect(active().students[0]).toMatchObject({ name: 'Ana', scores: { q1: '10' } });
    expect(labels().undo).toBe('Edit student name');

    store().undo();
    expect(active().students[0]).toMatchObject({ name: '', scores: { q1: '10' } });
    expect(labels()).toEqual({ undo: 'Score edit in Quiz 1', redo: 'Edit student name' });

    store().undo();
    expect(active().students[0]!.scores).toEqual({});

    store().redo();
    store().redo();
    expect(active().students[0]).toMatchObject({ name: 'Ana', scores: { q1: '10' } });
    expect(labels().redo).toBeNull();
  });

  it('describes edits in plain words', async () => {
    const { studentId } = await seed();
    store().pasteBlock(0, ['studentId', { columnId: 'q1' }], 0, [['2024-1', '15'], ['2024-2', '12'], ['2024-3', '9']]);
    expect(labels().undo).toBe('Paste 3 scores from Excel');
    store().setStatus(studentId, 'PRELIM', 'INC');
    expect(labels().undo).toBe('Set status INC');
    store().deleteColumn('PRELIM', 'q1');
    expect(labels().undo).toBe('Delete column Quiz 1');
    await saved();
  });

  it('a new edit after an undo ends the redo chain', async () => {
    const { studentId } = await seed();
    store().setStatus(studentId, 'PRELIM', 'INC');
    store().undo();
    expect(labels().redo).toBe('Set status INC');
    store().setStatus(studentId, 'PRELIM', 'ABS');
    expect(labels().redo).toBeNull();
    await saved();
  });

  it('saves every undo and redo to IndexedDB', async () => {
    const { studentId } = await seed();
    store().setScore(studentId, 'q1', '18');
    await saved();
    expect((await stored('A')).students[0]!.scores).toEqual({ q1: '18' });

    store().undo();
    await saved();
    expect((await stored('A')).students[0]!.scores).toEqual({});

    store().redo();
    await saved();
    expect((await stored('A')).students[0]!.scores).toEqual({ q1: '18' });
  });

  it('undoing a column delete brings back the column and its scores', async () => {
    const { studentId } = await seed();
    store().setScore(studentId, 'q1', '7');
    store().deleteColumn('PRELIM', 'q1');
    await saved();
    expect((await stored('A')).terms.PRELIM.columns).toHaveLength(0);

    store().undo();
    await saved();
    const record = await stored('A');
    expect(record.terms.PRELIM.columns.map((c) => c.id)).toEqual(['q1']);
    expect(record.students[0]!.scores).toEqual({ q1: '7' });
  });

  it('keeps a separate history for each class', async () => {
    const { studentId } = await seed();
    store().setStatus(studentId, 'PRELIM', 'INC');
    await db.classes.put(classRecord('B'));
    useStore.setState({ classes: [...store().classes, classRecord('B')] });

    store().selectClass('B');
    expect(labels()).toEqual({ undo: null, redo: null });
    store().undo(); // nothing to undo in B: A must be untouched
    expect(store().classes.find((c) => c.id === 'A')!.students[0]!.statuses).toEqual({ PRELIM: 'INC' });

    store().selectClass('A');
    expect(labels().undo).toBe('Set status INC');
    await saved();
  });

  it('merges quick edits to one cell into one step', async () => {
    const { studentId } = await seed();
    for (const v of ['1', '15', '152']) store().setScore(studentId, 'q1', v);
    expect(store().history.A!.past.filter((e) => e.label.startsWith('Score edit'))).toHaveLength(1);
    store().undo();
    expect(active().students[0]!.scores).toEqual({});
    await saved();
  });

  it('ignores an edit that changes nothing', async () => {
    const { studentId } = await seed();
    const before = store().history.A!.past.length;
    store().setScore(studentId, 'q1', '');
    expect(store().history.A!.past).toHaveLength(before);
    await saved();
  });

  it('forgets the history of a deleted class', async () => {
    await seed();
    store().deleteClassPermanent('A');
    expect(store().history.A).toBeUndefined();
    await saved();
  });
});

describe('history buffer', () => {
  it(`keeps only the last ${HISTORY_LIMIT} edits`, () => {
    let h = recordEdit(undefined, classRecord('A'), 'first', undefined, 0);
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) h = recordEdit(h, classRecord('A'), `edit ${i}`, undefined, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past.at(-1)!.label).toBe(`edit ${HISTORY_LIMIT + 5}`);
    expect(h.past[0]!.label).toBe('edit 6');
  });
});

describe('copy term setup', () => {
  beforeEach(() => openClass());

  it('copies a term, labels the step, and undoes it', async () => {
    await seed();
    store().copyTermSetup('PRELIM', 'MIDTERM');
    await saved();
    expect(active().terms.MIDTERM.columns.map((c) => c.label)).toEqual(['Quiz 1']);
    expect(active().terms.MIDTERM.columns[0]!.id).not.toBe('q1');
    expect(labels().undo).toBe('Copy setup from Prelim to Midterm');
    expect((await stored('A')).terms.MIDTERM.columns).toHaveLength(1);

    store().undo();
    await saved();
    expect((await stored('A')).terms.MIDTERM.columns).toHaveLength(0);
  });

  it('does nothing when the source term has no columns', () => {
    store().copyTermSetup('FINAL', 'MIDTERM');
    expect(labels().undo).toBeNull();
  });
});

describe('fill and clear column scores', () => {
  beforeEach(() => openClass());

  /** Quiz 1 (max 20) with three students: typed 7, blank, and one with an ABS status. */
  async function seedThree() {
    await seed();
    store().addStudent();
    store().addStudent();
    const [a, , c] = active().students.map((s) => s.id);
    store().setScore(a!, 'q1', '7');
    store().setStatus(c!, 'PRELIM', 'ABS');
    await saved();
    return { c: c! };
  }
  const scoresOf = () => active().students.map((s) => s.scores.q1);

  it('fills blanks only, skips statuses, labels the step, and undo / redo restore exactly', async () => {
    await seedThree();
    store().fillColumnScores('PRELIM', 'q1', '20', 'blanks-only');
    await saved();
    expect(scoresOf()).toEqual(['7', '20', undefined]);
    expect(labels().undo).toBe('Fill Quiz 1 with 20');
    expect((await stored('A')).students.map((s) => s.scores.q1)).toEqual(['7', '20', undefined]);

    store().undo();
    await saved();
    expect(scoresOf()).toEqual(['7', undefined, undefined]);
    expect((await stored('A')).students.map((s) => s.scores.q1)).toEqual(['7', undefined, undefined]);

    store().redo();
    await saved();
    expect(scoresOf()).toEqual(['7', '20', undefined]);
  });

  it('in "all" mode replaces typed scores but still skips statuses; undo brings them back', async () => {
    const { c } = await seedThree();
    store().fillColumnScores('PRELIM', 'q1', '18', 'all');
    await saved();
    expect(scoresOf()).toEqual(['18', '18', undefined]);
    expect(active().students.find((s) => s.id === c)!.statuses).toEqual({ PRELIM: 'ABS' });
    store().undo();
    expect(scoresOf()).toEqual(['7', undefined, undefined]);
  });

  it('ignores invalid values and no-op fills (no undo step)', async () => {
    await seedThree();
    const before = labels().undo;
    store().fillColumnScores('PRELIM', 'q1', '21', 'all');
    store().fillColumnScores('PRELIM', 'q1', 'x', 'all');
    store().fillColumnScores('PRELIM', 'missing', '5', 'all');
    expect(labels().undo).toBe(before);
    expect(scoresOf()).toEqual(['7', undefined, undefined]);

    store().fillColumnScores('PRELIM', 'q1', '7', 'blanks-only');
    const filled = labels().undo;
    store().fillColumnScores('PRELIM', 'q1', '7', 'blanks-only');
    expect(filled).toBe('Fill Quiz 1 with 7');
    expect(store().history.A!.past.filter((h) => h.label === filled)).toHaveLength(1);
  });

  it('clears the column, labels the step, and undo / redo round-trip', async () => {
    await seedThree();
    store().fillColumnScores('PRELIM', 'q1', '20', 'blanks-only');
    store().clearColumnScores('PRELIM', 'q1');
    await saved();
    expect(scoresOf()).toEqual([undefined, undefined, undefined]);
    expect(labels().undo).toBe('Clear scores in Quiz 1');
    expect((await stored('A')).students.every((s) => !('q1' in s.scores))).toBe(true);

    store().undo();
    expect(scoresOf()).toEqual(['7', '20', undefined]);
    store().redo();
    expect(scoresOf()).toEqual([undefined, undefined, undefined]);

    const step = labels().undo;
    store().clearColumnScores('PRELIM', 'q1');
    expect(labels().undo).toBe(step);
  });
});

describe('session backup flag', () => {
  beforeEach(() => openClass());

  it('starts false and turns true once a class is marked backed up or a workspace is restored', async () => {
    useStore.setState({ sessionBackupTaken: false });
    expect(store().sessionBackupTaken).toBe(false);
    store().markBackedUp(active());
    expect(store().sessionBackupTaken).toBe(true);

    useStore.setState({ sessionBackupTaken: false });
    store().restoreWorkspace([classRecord('A')], undefined, 'merge');
    expect(store().sessionBackupTaken).toBe(true);
    await saved();
  });
});

describe('restore workspace backup', () => {
  const tpl = (name: string) => ({ name, headerRow: 0, maxRow: null, idHeader: null, nameHeader: 'Name', columns: [] });
  const incoming = () => [{ ...classRecord('A'), subjectCode: 'FROM-BACKUP' }, classRecord('B')];
  beforeEach(async () => {
    await openClass();
    await db.classes.put(classRecord('C'));
    useStore.setState({ classes: [...store().classes, classRecord('C')] });
    await setMeta('importTemplates', [tpl('mine'), tpl('shared')]);
  });

  it('merge updates matching ids, adds new ones, keeps the rest, and saves everything', async () => {
    store().restoreWorkspace(incoming(), [{ ...tpl('shared'), nameHeader: 'Theirs' }, tpl('new')], 'merge');
    await saved();
    expect(store().classes.map((c) => c.id)).toEqual(['A', 'C', 'B']);
    expect(active().subjectCode).toBe('FROM-BACKUP');
    expect((await db.classes.toArray()).map((c) => c.id).sort()).toEqual(['A', 'B', 'C']);
    await vi.waitFor(async () => expect((await getMeta<{ name: string }[]>('importTemplates'))!.map((t) => t.name).sort()).toEqual(['mine', 'new', 'shared']));
    expect(store().history.A).toEqual({ past: [], future: [] });
  });

  it('replace leaves only the backup classes, removes the rest from storage, and swaps templates', async () => {
    store().restoreWorkspace(incoming(), [tpl('new')], 'replace');
    await saved();
    expect(store().classes.map((c) => c.id)).toEqual(['A', 'B']);
    expect((await db.classes.toArray()).map((c) => c.id).sort()).toEqual(['A', 'B']);
    await vi.waitFor(async () => expect((await getMeta<{ name: string }[]>('importTemplates'))!.map((t) => t.name)).toEqual(['new']));
  });

  it('picks another open class when the active one is replaced away', async () => {
    useStore.setState({ activeClassId: 'C' });
    store().restoreWorkspace(incoming(), undefined, 'replace');
    expect(store().activeClassId).toBe('A');
    await saved();
    expect((await getMeta<{ name: string }[]>('importTemplates'))!.map((t) => t.name)).toEqual(['mine', 'shared']);
  });
});

describe('duplicate class setup', () => {
  beforeEach(() => openClass());

  it('creates and selects a new class with the same setup and no students, saved and undoable', async () => {
    await seed();
    store().setScore(active().students[0]!.id, 'q1', '15');
    await saved();

    const id = store().duplicateClassSetup('A', ' 2-B ');
    await saved();
    expect(id).not.toBe('A');
    expect(store().activeClassId).toBe(id);
    expect(store().view).toBe('PRELIM');
    expect(active()).toMatchObject({ subjectCode: 'A', section: '2-B', students: [] });
    expect(active().terms.PRELIM.columns.map((c) => [c.label, c.maxScore])).toEqual([['Quiz 1', 20]]);
    expect(active().terms.PRELIM.columns[0]!.id).not.toBe('q1');
    expect(labels().undo).toBe('Duplicate setup from A ()');
    expect((await stored(id)).students).toEqual([]);
    expect((await stored('A')).students).toHaveLength(1);

    store().undo();
    await saved();
    expect((await stored(id)).terms.PRELIM.columns).toHaveLength(0);
    store().redo();
    await saved();
    expect((await stored(id)).terms.PRELIM.columns).toHaveLength(1);
  });

  it('returns an empty id for a class that does not exist', () => {
    expect(store().duplicateClassSetup('nope', 'B')).toBe('');
    expect(store().classes).toHaveLength(1);
  });
});

describe('paste into a filtered or sorted grid', () => {
  beforeEach(() => openClass());

  it('fills the rows in the order shown and adds students past the last shown row', async () => {
    await seed();
    for (let i = 0; i < 2; i++) store().addStudent();
    const ids = active().students.map((s) => s.id);
    // The grid shows the last row first, then the first row.
    store().pasteBlock(2, [{ columnId: 'q1' }], 0, [['10'], ['20'], ['30']], [2, 0]);
    await saved();
    const scores = active().students.map((s) => s.scores.q1 ?? '');
    expect(scores.slice(0, 3)).toEqual(['20', '', '10']);
    expect(active().students).toHaveLength(4);
    expect(active().students[3]!.scores.q1).toBe('30');
    expect(active().students.slice(0, 3).map((s) => s.id)).toEqual(ids);
  });
});
