// Saving class records safely (REQ-16, TC-026–028). Each edit is a change, not a whole
// copy: it is re-applied to the latest saved record inside one database transaction, so
// another open tab can never overwrite this tab's edits (or the other way round).
import type { ClassRecord } from './types';

/** Builds the record to save from the latest saved one; 'delete' removes it. */
export type ClassChange = (latest: ClassRecord | undefined) => ClassRecord | 'delete' | undefined;

export interface SaveItem {
  classId: string;
  change: ClassChange;
}

export interface SaveStorage {
  /** Reads the latest record, applies the change and writes the result, atomically. */
  apply(item: SaveItem): Promise<void>;
}

export type SaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'error'; message: string };

export interface SaveEvents {
  onStatus(status: SaveStatus): void;
  /** Every queued change is saved: these classes can be reloaded from storage. */
  onSaved(classIds: string[]): void;
}

export class SaveQueue {
  private pending: SaveItem[] = [];
  private failed: SaveItem[] = [];
  private saved = new Set<string>();
  private running = false;

  constructor(
    private storage: SaveStorage,
    private events: SaveEvents,
    private now: () => number = Date.now,
  ) {}

  /** True while changes are waiting to be saved or have failed to save. */
  get busy() {
    return this.running || this.pending.length > 0 || this.failed.length > 0;
  }

  enqueue(item: SaveItem) {
    this.pending.push(item);
    void this.run();
  }

  /** Saves the changes that failed, in their original order. */
  retry() {
    this.pending.unshift(...this.failed);
    this.failed = [];
    void this.run();
  }

  /** Resolves when nothing is left to save (for tests). */
  async idle() {
    while (this.running) await new Promise((r) => setTimeout(r, 0));
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    this.events.onStatus({ state: 'saving' });
    let error: unknown;
    while (this.pending.length > 0) {
      const item = this.pending.shift()!;
      try {
        await this.storage.apply(item);
        this.saved.add(item.classId);
      } catch (e) {
        error = e;
        this.failed.push(item);
      }
    }
    this.running = false;
    if (this.failed.length > 0) {
      console.error('Saving to IndexedDB failed', error);
      this.events.onStatus({ state: 'error', message: 'Your last changes could not be saved in this browser. They are still on screen.' });
      return;
    }
    const ids = [...this.saved];
    this.saved.clear();
    this.events.onStatus({ state: 'saved', at: this.now() });
    this.events.onSaved(ids);
  }
}
