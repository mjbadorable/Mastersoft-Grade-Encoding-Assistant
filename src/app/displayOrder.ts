// Which students the grid shows, and in what order. Display only: the class record keeps
// its own order (Mastersoft's), which the export and the row numbers depend on.
import type { Student } from './types';

export type SortOrder = 'mastersoft' | 'name-asc' | 'id-asc';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Record indexes of the students that match `query` (ID or name), in display order. Blank values sort last. */
export function displayOrder(students: Student[], query: string, sortOrder: SortOrder): number[] {
  const q = query.trim().toLowerCase();
  const rows = students.map((_, i) => i).filter((i) => !q || students[i]!.name.toLowerCase().includes(q) || students[i]!.studentId.toLowerCase().includes(q));
  if (sortOrder === 'mastersoft') return rows;
  const key = (i: number) => (sortOrder === 'name-asc' ? students[i]!.name : students[i]!.studentId).trim();
  return rows.sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    if (x === '' || y === '') return x === y ? a - b : x === '' ? 1 : -1;
    return collator.compare(x, y) || a - b;
  });
}
