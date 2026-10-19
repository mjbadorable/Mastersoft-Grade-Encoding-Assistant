// Local persistence (D9): everything stays in this browser's IndexedDB.
import Dexie, { type EntityTable } from 'dexie';
import type { SaveStorage } from './saveQueue';
import type { ClassRecord } from './types';

interface Meta {
  key: string;
  value: unknown;
}

export const db = new Dexie('mastersoft-grade-encoding') as Dexie & {
  classes: EntityTable<ClassRecord, 'id'>;
  meta: EntityTable<Meta, 'key'>;
};

db.version(1).stores({
  classes: 'id, updatedAt',
  meta: 'key',
});

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/**
 * Asks the browser to keep the saved classes even when the disk is nearly full (otherwise
 * it may clear them). Chrome and Edge decide on their own; Firefox asks the teacher.
 * Never forced: resolves to the browser's answer, or null where it can't be asked.
 */
let storageKept: Promise<boolean | null> | null = null;
export function keepStorage(): Promise<boolean | null> {
  storageKept ??= (async () => {
    try {
      if (!navigator.storage?.persist) return null;
      return (await navigator.storage.persisted()) || (await navigator.storage.persist());
    } catch {
      // Not supported: the classes are still saved, just without the guarantee.
      return null;
    }
  })();
  return storageKept;
}

/** Whether the browser already keeps this app's data, without asking (null: unknown). */
export async function storagePersisted(): Promise<boolean | null> {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    return null;
  }
}

/** Saves one change atomically against the latest stored record (see saveQueue.ts). */
export const classStorage: SaveStorage = {
  apply: ({ classId, change }) =>
    db.transaction('rw', db.classes, async () => {
      const next = change(await db.classes.get(classId));
      if (next === 'delete') await db.classes.delete(classId);
      else if (next) await db.classes.put({ ...next, updatedAt: Date.now() });
    }),
};

/** Tells this app's other open tabs which classes changed. */
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('mastersoft-grade-encoding');

export function announceChanges(classIds: string[]) {
  if (classIds.length > 0) channel?.postMessage({ classIds });
}

export function onOtherTabChanges(listener: (classIds: string[]) => void) {
  if (channel) channel.onmessage = (e: MessageEvent<{ classIds?: string[] }>) => listener(e.data.classIds ?? []);
}
