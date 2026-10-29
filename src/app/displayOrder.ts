// Which students the grid shows, and in what order. Display only: the class record keeps
// its own order (Mastersoft's), which the export and the row numbers depend on.
import type { Student } from './types';

export type SortOrder = 'mastersoft' | 'name-asc' | 'id-asc';

/** Orders rows by the typed score in one column. Blank and non-numeric scores always go last. */
export interface ScoreSort {
  columnId: string;
  dir: 'asc' | 'desc';
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Record indexes of the students that match `query` (ID or name), in display order. Blank values sort last. */
export function displayOrder(students: Student[], query: string, sortOrder: SortOrder, scoreSort?: ScoreSort): number[] {
  const q = query.trim().toLowerCase();
  const rows = students.map((_, i) => i).filter((i) => !q || students[i]!.name.toLowerCase().includes(q) || students[i]!.studentId.toLowerCase().includes(q));
  if (scoreSort) {
    const score = (i: number) => {
      const text = students[i]!.scores[scoreSort.columnId]?.trim() ?? '';
      const n = text === '' ? NaN : Number(text);
      return Number.isFinite(n) ? n : null;
    };
    const sign = scoreSort.dir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const [x, y] = [score(a), score(b)];
      if (x === null || y === null) return x === y ? a - b : x === null ? 1 : -1;
      return sign * (x - y) || a - b;
    });
  }
  if (sortOrder === 'mastersoft') return rows;
  const key = (i: number) => (sortOrder === 'name-asc' ? students[i]!.name : students[i]!.studentId).trim();
  return rows.sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    if (x === '' || y === '') return x === y ? a - b : x === '' ? 1 : -1;
    return collator.compare(x, y) || a - b;
  });
}
