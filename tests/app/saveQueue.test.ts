// Save queue (REQ-16): two tabs never overwrite each other (TC-028), every save is
// confirmed (TC-026), and a failed save is reported and can be retried (TC-027).
import { describe, expect, it, vi } from 'vitest';
import { SaveQueue, type SaveItem, type SaveStatus, type SaveStorage } from '../../src/app/saveQueue';
import type { ClassRecord, Student } from '../../src/app/types';

const student = (id: string, score: string): Student => ({ id, studentId: id, name: id, scores: { q: score }, statuses: {} });
const base: ClassRecord = {
  id: 'c',
  subjectCode: 'X',
  subjectName: '',
  section: '',
  subjectType: 'LEC',
  terms: { PRELIM: { csMode: 'RAW_SUM', categories: [], columns: [] }, MIDTERM: { csMode: 'RAW_SUM', categories: [], columns: [] }, FINAL: { csMode: 'RAW_SUM', categories: [], columns: [] } },
  students: [student('A', '10'), student('B', '10')],
  updatedAt: 0,
};

/** One shared "database", like IndexedDB shared by every tab. */
function memoryStorage(initial: ClassRecord[]) {
  const rows = new Map(initial.map((r) => [r.id, structuredClone(r)]));
  let failNext = 0;
  const storage: SaveStorage = {
    async apply({ classId, change }: SaveItem) {
      if (failNext > 0) {
        failNext--;
        throw new Error('disk full');
      }
      const next = change(rows.get(classId));
      if (next === 'delete') rows.delete(classId);
      else if (next) rows.set(classId, structuredClone(next));
    },
  };
  return { storage, rows, failTimes: (n: number) => (failNext = n) };
}

const setScore = (id: string, score: string) => (c: ClassRecord | undefined) =>
  c && { ...c, students: c.students.map((s) => (s.id === id ? { ...s, scores: { q: score } } : s)) };

function tab(storage: SaveStorage) {
  const statuses: SaveStatus[] = [];
  const saved: string[][] = [];
  const queue = new SaveQueue(storage, { onStatus: (s) => statuses.push(s), onSaved: (ids) => saved.push(ids) }, () => 1000);
  return { queue, statuses, saved };
}

describe('SaveQueue', () => {
  it('TC-028: two tabs editing different students keep both changes', async () => {
    const db = memoryStorage([base]);
    const tab1 = tab(db.storage);
    const tab2 = tab(db.storage); // opened earlier: its copy of the class is out of date
    tab1.queue.enqueue({ classId: 'c', change: setScore('A', '11') });
    await tab1.queue.idle();
    tab2.queue.enqueue({ classId: 'c', change: setScore('B', '7') });
    await tab2.queue.idle();
    expect(db.rows.get('c')!.students.map((s) => s.scores.q)).toEqual(['11', '7']);
  });

  it('TC-026: confirms each save and reports which classes changed', async () => {
    const db = memoryStorage([base]);
    const t = tab(db.storage);
    t.queue.enqueue({ classId: 'c', change: setScore('A', '12') });
    t.queue.enqueue({ classId: 'c', change: setScore('B', '13') });
    await t.queue.idle();
    expect(t.statuses.at(-1)).toEqual({ state: 'saved', at: 1000 });
    expect(t.saved).toEqual([['c']]);
    expect(t.queue.busy).toBe(false);
  });

  it('TC-027: a failed save is reported, kept, and saved on retry', async () => {
    const db = memoryStorage([base]);
    const t = tab(db.storage);
    db.failTimes(1);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    t.queue.enqueue({ classId: 'c', change: setScore('A', '15') });
    await t.queue.idle();
    expect(t.statuses.at(-1)).toEqual({ state: 'error', message: 'Your last changes could not be saved in this browser. They are still on screen.' });
    expect(t.queue.busy).toBe(true);
    expect(t.saved).toEqual([]);
    expect(db.rows.get('c')!.students[0]!.scores.q).toBe('10');

    t.queue.retry();
    await t.queue.idle();
    expect(db.rows.get('c')!.students[0]!.scores.q).toBe('15');
    expect(t.statuses.at(-1)).toEqual({ state: 'saved', at: 1000 });
    expect(t.queue.busy).toBe(false);
  });

  it('creates and deletes whole records', async () => {
    const db = memoryStorage([]);
    const t = tab(db.storage);
    t.queue.enqueue({ classId: 'c', change: () => base });
    await t.queue.idle();
    expect(db.rows.has('c')).toBe(true);
    t.queue.enqueue({ classId: 'c', change: () => 'delete' });
    await t.queue.idle();
    expect(db.rows.has('c')).toBe(false);
  });
});
