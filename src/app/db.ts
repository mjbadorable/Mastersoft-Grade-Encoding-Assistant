// Local persistence (D9): everything stays in this browser's IndexedDB.
import Dexie, { type EntityTable } from 'dexie';
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
