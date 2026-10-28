// Per-class undo / redo (TC-029). Each entry keeps the whole class as it was before an edit.
// Edits never change a record in place, so a snapshot shares most of its data with the
// current record and 50 of them stay small.
import type { ClassRecord } from './types';

export const HISTORY_LIMIT = 50;

/** Edits to the same cell closer together than this are one undo step (typing a number). */
const COALESCE_MS = 1500;

export interface HistoryEntry {
  /** What the edit did, for the button tooltips: "Score edit in Quiz 1". */
  label: string;
  /** The class as it was before the edit (undo) or before the undo (redo). */
  snapshot: ClassRecord;
  /** Edits with the same key within COALESCE_MS are merged into one entry. */
  key?: string;
  at: number;
}

export interface ClassHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const emptyHistory: ClassHistory = { past: [], future: [] };

/** Records an edit made to `before`. A new edit ends the redo chain. */
export function recordEdit(h: ClassHistory = emptyHistory, before: ClassRecord, label: string, key: string | undefined, at: number): ClassHistory {
  const last = h.past.at(-1);
  if (key !== undefined && last?.key === key && at - last.at < COALESCE_MS) {
    return { past: [...h.past.slice(0, -1), { ...last, at }], future: [] };
  }
  const past = [...h.past, { label, snapshot: before, key, at }];
  return { past: past.slice(-HISTORY_LIMIT), future: [] };
}

/** Steps back: returns the class to show and the new history, or null when there is nothing to undo. */
export function stepBack(h: ClassHistory = emptyHistory, current: ClassRecord, at: number) {
  const entry = h.past.at(-1);
  if (!entry) return null;
  const history: ClassHistory = {
    past: h.past.slice(0, -1),
    future: [...h.future, { label: entry.label, snapshot: current, at }].slice(-HISTORY_LIMIT),
  };
  return { record: entry.snapshot, label: entry.label, history };
}

/** Steps forward again after an undo. */
export function stepForward(h: ClassHistory = emptyHistory, current: ClassRecord, at: number) {
  const entry = h.future.at(-1);
  if (!entry) return null;
  const history: ClassHistory = {
    past: [...h.past, { label: entry.label, snapshot: current, at }].slice(-HISTORY_LIMIT),
    future: h.future.slice(0, -1),
  };
  return { record: entry.snapshot, label: entry.label, history };
}
