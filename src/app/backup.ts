// Backup and restore (D9): one class record as a JSON file the teacher keeps.
import { STATUSES } from './labels';
import type { ClassRecord } from './types';

const APP = 'mastersoft-grade-encoding';
const FORMAT = 1;

export class BackupError extends Error {}

export interface BackupFile {
  app: typeof APP;
  format: typeof FORMAT;
  exportedAt: string;
  classRecord: ClassRecord;
}

export function serializeBackup(record: ClassRecord, now = new Date()): string {
  const file: BackupFile = { app: APP, format: FORMAT, exportedAt: now.toISOString(), classRecord: record };
  return JSON.stringify(file, null, 2);
}

/**
 * Identifies a class's content (not when it was saved), so the app can tell whether it
 * changed since the teacher's last backup. FNV-1a over the record without `updatedAt`.
 */
export function backupFingerprint(record: ClassRecord): string {
  const text = JSON.stringify({ ...record, updatedAt: 0 });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${(h >>> 0).toString(16)}-${text.length}`;
}

export function backupFileName(record: ClassRecord, now = new Date()): string {
  const name = [record.subjectCode, record.section, 'backup', now.toISOString().slice(0, 10)].filter(Boolean).join(' ');
  return `${name.replace(/[\\/:*?"<>|]+/g, '-')}.json`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Reads a backup file and checks its shape, so a wrong or damaged file can't load. */
export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('This file is not a valid backup (it is not JSON).');
  }
  if (!isObj(data) || data.app !== APP) throw new BackupError('This file is not a Mastersoft Grade Encoding backup.');
  if (data.format !== FORMAT) throw new BackupError(`This backup was made by a different version of the app (format ${String(data.format)}).`);
  const c = data.classRecord;
  const fail = (what: string): never => {
    throw new BackupError(`The backup is damaged: ${what}.`);
  };
  if (!isObj(c)) fail('no class record');
  const r = c as Record<string, unknown>;
  for (const key of ['id', 'subjectCode', 'subjectName', 'section']) if (!isStr(r[key])) fail(`"${key}" is missing`);
  if (!['LEC', 'LAB', 'COMPOSITE'].includes(r.subjectType as string)) fail('unknown subject type');
  if (!isObj(r.terms)) fail('no terms');
  for (const t of ['PRELIM', 'MIDTERM', 'FINAL']) {
    const term = (r.terms as Record<string, unknown>)[t];
    if (!isObj(term) || !Array.isArray(term.columns) || !Array.isArray(term.categories)) fail(`${t} is missing`);
    for (const col of (term as { columns: unknown[] }).columns) {
      if (!isObj(col) || !isStr(col.id) || !isStr(col.label) || typeof col.maxScore !== 'number' || !['CS', 'WE'].includes(col.component as string)) {
        fail(`a ${t} column is invalid`);
      }
    }
  }
  if (!Array.isArray(r.students)) fail('no student list');
  for (const s of r.students as unknown[]) {
    if (!isObj(s) || !isStr(s.id) || !isStr(s.studentId) || !isStr(s.name) || !isObj(s.scores) || !isObj(s.statuses)) fail('a student row is invalid');
    const st = s as { scores: Record<string, unknown>; statuses: Record<string, unknown> };
    if (!Object.values(st.scores).every(isStr)) fail('a score is invalid');
    if (!Object.values(st.statuses).every((v) => STATUSES.includes(v as never))) fail('a status is invalid');
  }
  return data as unknown as BackupFile;
}
