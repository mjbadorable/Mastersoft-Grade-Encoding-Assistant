// Backup and restore (D9): one class, or the whole workspace, as a JSON file the teacher keeps.
import { STATUSES } from './labels';
import type { ImportTemplate } from './excelImport';
import { normalizeClassObe } from './obe';
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

/** The whole workspace: every class, plus the saved Excel import templates when given. */
export interface WorkspaceBackupFile {
  app: typeof APP;
  format: typeof FORMAT;
  type: 'workspace';
  /** Milliseconds since 1970. */
  exportedAt: number;
  classes: ClassRecord[];
  templates?: ImportTemplate[];
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

/**
 * Writes every class into one file. `meta.templates` (the saved Excel import templates) is
 * kept in the file when it is an array; `meta.exportedAt` (ms) overrides the time, for tests.
 */
export function serializeWorkspaceBackup(classes: ClassRecord[], meta: Record<string, unknown> = {}): string {
  const file: WorkspaceBackupFile = {
    app: APP,
    format: FORMAT,
    type: 'workspace',
    exportedAt: typeof meta.exportedAt === 'number' ? meta.exportedAt : Date.now(),
    classes,
    ...(Array.isArray(meta.templates) ? { templates: meta.templates as ImportTemplate[] } : {}),
  };
  return JSON.stringify(file, null, 2);
}

export function workspaceBackupFileName(now = new Date()): string {
  return `Mastersoft workspace backup ${now.toISOString().slice(0, 10)}.json`;
}

export function backupFileName(record: ClassRecord, now = new Date()): string {
  const name = [record.subjectCode, record.section, 'backup', now.toISOString().slice(0, 10)].filter(Boolean).join(' ');
  return `${name.replace(/[\\/:*?"<>|]+/g, '-')}.json`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Whether to show the "download a backup" reminder: there is work to lose and nothing has been backed up yet. */
export function backupReminderDue(s: { students: number; sessionBackupTaken: boolean; dismissed: boolean; armed: boolean }): boolean {
  return s.armed && s.students > 0 && !s.sessionBackupTaken && !s.dismissed;
}

/** What a backup file holds: one class, or a whole workspace. */
export type ParsedBackup =
  | { type: 'single'; classRecord: ClassRecord; exportedAt: string }
  | { type: 'workspace'; classes: ClassRecord[]; templates?: ImportTemplate[]; exportedAt: number };

const fail = (what: string): never => {
  throw new BackupError(`The backup is damaged: ${what}.`);
};

/** Checks one class record's shape and repairs older OBE data. */
function checkClass(c: unknown): ClassRecord {
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
  // Older backups may lack OBE fields or links: repair them rather than reject the class.
  return normalizeClassObe(c as ClassRecord);
}

function checkTemplate(t: unknown): ImportTemplate {
  const ok =
    isObj(t) &&
    isStr(t.name) &&
    typeof t.headerRow === 'number' &&
    (t.maxRow === null || typeof t.maxRow === 'number') &&
    (t.idHeader === null || isStr(t.idHeader)) &&
    isStr(t.nameHeader) &&
    Array.isArray(t.columns) &&
    t.columns.every((c) => isObj(c) && isStr(c.header) && ['CS', 'WE'].includes(c.component as string) && typeof c.maxScore === 'number');
  if (!ok) fail('an import template is invalid');
  return t as ImportTemplate;
}

/** Reads a backup file and checks its shape, so a wrong or damaged file can't load (OBE data is repaired). */
export function parseBackup(text: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('This file is not a valid backup (it is not JSON).');
  }
  if (!isObj(data) || data.app !== APP) throw new BackupError('This file is not a Mastersoft Grade Encoding backup.');
  if (data.format !== FORMAT) throw new BackupError(`This backup was made by a different version of the app (format ${String(data.format)}).`);

  if (data.type === 'workspace') {
    if (typeof data.exportedAt !== 'number' || !Number.isFinite(data.exportedAt)) fail('no backup time');
    if (!Array.isArray(data.classes) || data.classes.length === 0) fail('the workspace has no classes');
    const classes = (data.classes as unknown[]).map(checkClass);
    if (new Set(classes.map((c) => c.id)).size !== classes.length) fail('two classes share the same id');
    if (data.templates !== undefined && !Array.isArray(data.templates)) fail('the import templates are invalid');
    const templates = (data.templates as unknown[] | undefined)?.map(checkTemplate);
    return { type: 'workspace', classes, ...(templates ? { templates } : {}), exportedAt: data.exportedAt as number };
  }
  return { type: 'single', classRecord: checkClass(data.classRecord), exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '' };
}

/**
 * The class list after restoring a workspace backup. Merge keeps every current class and
 * lets the backup replace the ones with the same id (new ones are added at the end);
 * replace leaves exactly the backup's classes.
 */
export function restoreWorkspaceClasses(current: ClassRecord[], incoming: ClassRecord[], mode: 'merge' | 'replace'): ClassRecord[] {
  if (mode === 'replace') return incoming;
  const byId = new Map(incoming.map((c) => [c.id, c]));
  const kept = current.map((c) => byId.get(c.id) ?? c);
  return [...kept, ...incoming.filter((c) => !current.some((x) => x.id === c.id))];
}

/** Saved import templates after a restore: the backup's win on the same name; replace without any templates in the file keeps yours. */
export function restoreTemplates(current: ImportTemplate[], incoming: ImportTemplate[] | undefined, mode: 'merge' | 'replace'): ImportTemplate[] {
  if (!incoming) return current;
  if (mode === 'replace') return incoming;
  const names = new Set(incoming.map((t) => t.name));
  return [...current.filter((t) => !names.has(t.name)), ...incoming];
}
