// Class Trash, restore and archive: soft delete, undo, and permanent removal from IndexedDB.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/app/db';
import { isLiveClass, useStore } from '../../src/app/store';
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
const find = (id: string) => store().classes.find((c) => c.id === id)!;
const saved = () => vi.waitFor(() => expect(store().saveStatus.state).toBe('saved'));

beforeEach(async () => {
  await db.classes.clear();
  const all = ['A', 'B', 'C'].map(classRecord);
  await db.classes.bulkPut(all);
  useStore.setState({ classes: all, activeClassId: 'A', history: {}, trashNotice: null, saveStatus: { state: 'idle' } });
});

describe('trashClass', () => {
  it('marks the class deleted, saves it, and moves to the first remaining active class', async () => {
    store().trashClass('A');
    expect(find('A').deletedAt).toBeTypeOf('number');
    expect(store().activeClassId).toBe('B');
    expect(store().trashNotice).toEqual({ id: 'A', label: 'A' });
    await saved();
    expect((await db.classes.get('A'))!.deletedAt).toBe(find('A').deletedAt);
  });

  it('leaves the open class alone when another class is trashed, and ends on null with nothing left', () => {
    store().trashClass('B');
    expect(store().activeClassId).toBe('A');
    store().trashClass('A');
    store().trashClass('C');
    expect(store().activeClassId).toBeNull();
  });

  it('skips archived classes when choosing the next one', () => {
    store().archiveClass('B');
    store().trashClass('A');
    expect(store().activeClassId).toBe('C');
  });
});

describe('restoreClassFromTrash', () => {
  it('clears deletedAt in memory and in storage, opens the class and drops the undo notice', async () => {
    store().trashClass('A');
    await saved();
    store().restoreClassFromTrash('A');
    expect(find('A').deletedAt).toBeUndefined();
    expect(store().activeClassId).toBe('A');
    expect(store().trashNotice).toBeNull();
    await vi.waitFor(async () => expect((await db.classes.get('A'))!.deletedAt).toBeUndefined());
  });
});

describe('archiveClass / unarchiveClass', () => {
  it('archives, switches the open class away, and keeps the class stored', async () => {
    store().archiveClass('A');
    expect(find('A').archived).toBe(true);
    expect(isLiveClass(find('A'))).toBe(false);
    expect(store().activeClassId).toBe('B');
    await vi.waitFor(async () => expect((await db.classes.get('A'))!.archived).toBe(true));
  });

  it('unarchives back into the active list', async () => {
    store().archiveClass('B');
    store().unarchiveClass('B');
    expect(find('B').archived).toBe(false);
    expect(isLiveClass(find('B'))).toBe(true);
    await vi.waitFor(async () => expect((await db.classes.get('B'))!.archived).toBe(false));
  });
});

describe('deleteClassPermanent / emptyTrash', () => {
  it('removes one class everywhere, including its history', async () => {
    useStore.setState({ history: { B: { past: [], future: [] } } });
    store().deleteClassPermanent('B');
    expect(store().classes.map((c) => c.id)).toEqual(['A', 'C']);
    expect(store().history.B).toBeUndefined();
    await vi.waitFor(async () => expect(await db.classes.get('B')).toBeUndefined());
  });

  it('emptyTrash deletes only the trashed classes', async () => {
    store().trashClass('B');
    store().trashClass('C');
    store().archiveClass('A');
    store().emptyTrash();
    expect(store().classes.map((c) => c.id)).toEqual(['A']);
    expect(store().trashNotice).toBeNull();
    await vi.waitFor(async () => expect((await db.classes.toArray()).map((c) => c.id)).toEqual(['A']));
  });
});
