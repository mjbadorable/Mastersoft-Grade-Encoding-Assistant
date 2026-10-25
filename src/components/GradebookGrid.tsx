import { FileSpreadsheet, FileUp, Plus, Trash2, UserPlus } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { assessmentTotals, csColumns, duplicateStudentIds, formatPoint, parseScore, sameIdAs, termOutcome, weColumns, type TermOutcome } from '../app/gradebook';
import { STATUS_NAME, STATUSES } from '../app/labels';
import { columnTags } from '../app/obe';
import { useStore, type CellKey } from '../app/store';
import type { ClassRecord, Column, Component, Student } from '../app/types';
import { rules, type Status, type Term } from '../engine';
import { cn } from '../lib/utils';
import { confirmAction } from './ConfirmDialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

// Pinned left columns: #, Student ID, Student Name, Status.
const LEFT = [
  { w: 40, left: 0 },
  { w: 104, left: 40 },
  { w: 184, left: 144 },
  { w: 76, left: 328 },
];
const OUT_W = 88;
/** Score columns always keep at least this much visible width between the pinned columns. */
const MIN_SCROLL_AREA = 260;
const LEFT_W = LEFT.reduce((sum, c) => sum + c.w, 0);
/** In narrow grids only # and Student Name stay pinned (left offsets). */
const NARROW_LEFT: Record<number, number> = { 0: 0, 2: LEFT[0]!.w };

interface Props {
  record: ClassRecord;
  term: Term;
  onEditColumn: (c: Column) => void;
  onAddColumn: (component?: Component) => void;
  onAddStudent: () => void;
  onImportMastersoft: () => void;
  onImportExcel: () => void;
}

let lastCell: { row: number; col: number } | undefined;

/** The grid cell that last had focus (buttons outside the grid take focus away from it). */
export const lastFocusedCell = () => lastCell;

/**
 * Focuses a grid cell by row and editable-column index (0 = ID, 1 = name, 2+ = scores,
 * 'status' = the Status dropdown). With `flash`, the row lights up briefly so it is easy to spot.
 */
export function focusGridCell(row: number, col: number | 'status', flash = false) {
  let el = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-cell="${row}:${col}"]`);
  // A carried-forward status can't be changed in this term; go to the name instead.
  if (el?.disabled) el = document.querySelector<HTMLInputElement>(`[data-cell="${row}:1"]`);
  if (!el) return;
  lastCell = { row, col: typeof col === 'number' ? col : 1 };
  el.focus();
  if (el instanceof HTMLInputElement) el.select();
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const tr = el.closest('tr');
  if (flash && tr) {
    for (const td of tr.cells) td.animate([{ backgroundColor: '#fde68a' }, {}], { duration: 1400, easing: 'ease-out' });
  }
}

export function GradebookGrid({ record, term, onEditColumn, onAddColumn, onAddStudent, onImportMastersoft, onImportExcel }: Props) {
  const { setStudentField, setScore, setStatus, deleteStudent, addStudent, pasteBlock, openDrawer } = useStore();
  const setup = record.terms[term];
  const cs = csColumns(setup);
  const we = weColumns(setup);
  const scoreColumns = [...cs, ...we];
  const totals = assessmentTotals(setup);
  const weighted = setup.csMode === 'WEIGHTED_CATEGORIES';
  const categoryName = (c: Column) => setup.categories.find((cat) => cat.id === c.categoryId)?.name;
  const tableRef = useRef<HTMLTableElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(Number.POSITIVE_INFINITY);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setGridWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setGridWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const outcomes = useMemo(() => record.students.map((s) => termOutcome(record, s, term)), [record, term]);
  const fromMastersoft = record.students.some((s) => s.mastersoft);
  const duplicates = useMemo(() => duplicateStudentIds(record.students), [record.students]);

  // Editable cells, in order: Student ID, Name, then each score column.
  const keys: CellKey[] = ['studentId', 'name', ...scoreColumns.map((c) => ({ columnId: c.id }))];

  const focusCell = focusGridCell;
  /** The first blank or invalid score in a row, as an editable-column index. */
  const firstProblemCol = (student: Student) => {
    const i = scoreColumns.findIndex((c) => parseScore(student.scores[c.id], c.maxScore).kind !== 'ok');
    return i < 0 ? undefined : i + 2;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    const input = e.currentTarget;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      if (row + 1 < record.students.length) focusCell(row + 1, col);
      else if (e.key === 'Enter') {
        addStudent();
        setTimeout(() => focusCell(row + 1, col));
      }
    } else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
      e.preventDefault();
      focusCell(row - 1, col);
    } else if (e.key === 'ArrowLeft' && atStart) {
      e.preventDefault();
      focusCell(row, col - 1);
    } else if (e.key === 'ArrowRight' && atEnd) {
      e.preventDefault();
      focusCell(row, col + 1);
    }
  };

  /** Pasting several cells copied from Excel fills right and down from this cell. */
  const onPaste = (e: ClipboardEvent<HTMLInputElement>, row: number, col: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
    e.preventDefault();
    const rows = text.replace(/\r?\n$/, '').split(/\r?\n/).map((line) => line.split('\t'));
    pasteBlock(row, keys, col, rows);
  };

  const cellInput = (student: Student, row: number, col: number, value: string, onChange: (v: string) => void, extra?: { invalid?: string; numeric?: boolean; label: string }) => (
    <input
      data-cell={`${row}:${col}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => onKeyDown(e, row, col)}
      onPaste={(e) => onPaste(e, row, col)}
      onFocus={(e) => {
        lastCell = { row, col };
        e.target.select();
      }}
      aria-label={`${extra?.label} for ${student.name || `row ${row + 1}`}`}
      aria-invalid={!!extra?.invalid}
      title={extra?.invalid}
      inputMode={extra?.numeric ? 'decimal' : undefined}
      className={cn(
        'h-8 w-full bg-transparent px-2 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-brand/60',
        extra?.numeric && 'tabular text-right',
        extra?.invalid && 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-400',
      )}
    />
  );

  const outputs = [
    { key: 'cs', head: 'CS Marks', sub: totals.cs !== null ? `/ ${totals.cs}` : '' },
    { key: 'we', head: 'WE Marks', sub: totals.we !== null ? `/ ${totals.we}` : '' },
    ...(weighted ? [{ key: 'rawsum', head: 'Raw-sum TG', sub: 'comparison' }] : []),
    { key: 'tg', head: 'Term Grade', sub: '' },
    { key: 'pg', head: 'Point Grade', sub: '' },
  ];
  // Pin only what fits, so pinned columns never cover the student names and scores.
  const pinOutputs = gridWidth >= LEFT_W + outputs.length * OUT_W + MIN_SCROLL_AREA;
  const pinAllLeft = gridWidth >= LEFT_W + MIN_SCROLL_AREA;
  const outStyle = (i: number): CSSProperties => ({
    width: OUT_W,
    minWidth: OUT_W,
    ...(pinOutputs && { position: 'sticky', right: (outputs.length - 1 - i) * OUT_W }),
  });
  const leftStyle = (i: number): CSSProperties => {
    const left = pinAllLeft ? LEFT[i]!.left : NARROW_LEFT[i];
    return { width: LEFT[i]!.w, minWidth: LEFT[i]!.w, ...(left !== undefined && { position: 'sticky', left }) };
  };
  /** The last pinned left column gets the divider line. */
  const leftEdge = (i: number) => i === (pinAllLeft ? 3 : 2) && 'border-r-2 border-r-slate-300';

  const th = 'border-b border-r border-slate-200 bg-slate-100 px-2 py-1.5 text-left text-xs font-semibold text-slate-600';
  const td = 'border-b border-r border-slate-200 p-0';
  const pinned = 'sticky z-10';
  // Row highlight on hover and while a cell in the row has focus.
  const rowBg = 'bg-white group-hover:bg-slate-50 group-focus-within:bg-sky-50';
  const columnCount = 4 + Math.max(cs.length, 1) + Math.max(we.length, 1) + 2 + outputs.length;
  const addPlaceholder = (component: Component) => (
    <th className={cn(th, 'p-1 font-normal', component === 'CS' ? 'bg-sky-50/60' : 'bg-violet-50/60')}>
      <Button size="sm" variant="ghost" className="h-7 w-full px-2 text-xs text-slate-600" onClick={() => onAddColumn(component)}>
        <Plus /> Add {component} column
      </Button>
    </th>
  );

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-white">
      <table ref={tableRef} className="min-w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20">
          <tr>
            {['#', 'Student ID', 'Student Name', 'Status'].map((h, i) => (
              <th key={h} rowSpan={2} style={leftStyle(i)} className={cn(th, 'z-30 align-bottom', leftEdge(i))}>
                {h}
              </th>
            ))}
            <th colSpan={Math.max(cs.length, 1)} className={cn(th, 'whitespace-nowrap bg-sky-50 text-center text-sky-900')}>
              Class Standing{weighted && ' (weighted categories)'}
            </th>
            <th colSpan={Math.max(we.length, 1)} className={cn(th, 'whitespace-nowrap bg-violet-50 text-center text-violet-900')}>
              Written Exam
            </th>
            <th rowSpan={2} className={cn(th, 'w-12')}>
              <Button size="icon" variant="ghost" onClick={() => onAddColumn()} aria-label="Add column" title="Add column">
                <Plus />
              </Button>
            </th>
            <th rowSpan={2} className="w-full border-b border-slate-200 bg-slate-100" />
            {outputs.map((o, i) => (
              <th
                key={o.key}
                rowSpan={2}
                style={outStyle(i)}
                className={cn(th, 'z-30 bg-brand/10 align-bottom text-brand', i === 0 && 'border-l-2 border-l-brand/40')}
              >
                <div className="leading-tight">{o.head}</div>
                {o.sub && <div className="tabular text-[11px] font-normal text-slate-500">{o.sub}</div>}
              </th>
            ))}
          </tr>
          <tr>
            {cs.length === 0 && addPlaceholder('CS')}
            {scoreColumns.map((c) => (
              <th key={c.id} className={cn(th, 'min-w-20 p-0', c.component === 'CS' ? 'bg-sky-50/60' : 'bg-violet-50/60')}>
                <button onClick={() => onEditColumn(c)} className="w-full px-2 py-1.5 text-left hover:bg-white/70" title="Edit column">
                  <div className="truncate">{c.label}</div>
                  <div className="tabular text-[11px] font-normal text-slate-500">
                    / {c.maxScore}
                    {weighted && c.component === 'CS' && <span className="ml-1">· {categoryName(c) ?? 'no category'}</span>}
                  </div>
                  <ObeTags record={record} column={c} />
                </button>
              </th>
            ))}
            {we.length === 0 && addPlaceholder('WE')}
          </tr>
        </thead>
        <tbody>
          {record.students.map((student, row) => {
            const outcome = outcomes[row]!;
            const ownStatus = student.statuses[term];
            const carried = outcome.kind === 'status' && outcome.carried;
            return (
              <tr key={student.id} className="group">
                <td style={leftStyle(0)} className={cn(td, 'z-10', rowBg, 'text-center text-xs text-slate-500')}>
                  <span className="group-hover:hidden">
                    {fromMastersoft && !student.mastersoft ? (
                      <span className="font-semibold text-amber-700" title="Not in the Mastersoft list: left out of the Mastersoft export">
                        {row + 1}*
                      </span>
                    ) : (
                      row + 1
                    )}
                  </span>
                  <button
                    onClick={() =>
                      void (async () => {
                        const hasData = student.name || student.studentId || Object.values(student.scores).some((v) => v.trim());
                        const ok =
                          !hasData ||
                          (await confirmAction({
                            title: 'Remove student?',
                            message: `${student.name || 'This student'} and their scores in every term will be removed from the class.`,
                            confirmLabel: 'Remove student',
                          }));
                        if (ok) deleteStudent(student.id);
                      })()
                    }
                    className="hidden w-full justify-center text-slate-400 hover:text-red-600 group-hover:flex"
                    aria-label={`Remove ${student.name || `row ${row + 1}`}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
                <td style={leftStyle(1)} className={cn(td, 'z-10', rowBg)}>
                  {cellInput(student, row, 0, student.studentId, (v) => setStudentField(student.id, 'studentId', v), {
                    label: 'Student ID',
                    invalid: (() => {
                      const others = sameIdAs(duplicates, student);
                      return others.length > 0
                        ? `Student ID ${student.studentId.trim()} is already used by ${others.map((o) => o.name || `row ${record.students.indexOf(o) + 1}`).join(', ')}. Each student can appear only once.`
                        : undefined;
                    })(),
                  })}
                </td>
                <td style={leftStyle(2)} className={cn(td, 'z-10', rowBg, leftEdge(2))}>
                  {cellInput(student, row, 1, student.name, (v) => setStudentField(student.id, 'name', v), { label: 'Student name' })}
                </td>
                <td style={leftStyle(3)} className={cn(td, 'z-10', rowBg, leftEdge(3))}>
                  <select
                    data-cell={`${row}:status`}
                    value={carried ? outcome.status : (ownStatus ?? '')}
                    disabled={carried}
                    onChange={(e) => setStatus(student.id, term, (e.target.value || undefined) as Status | undefined)}
                    title={carried ? `${STATUS_NAME[outcome.status]}: carried forward from an earlier term` : 'Mastersoft status for this term'}
                    aria-label={`Status for ${student.name || `row ${row + 1}`}`}
                    className={cn('h-8 w-full bg-transparent px-1 text-xs text-slate-400 outline-none focus:ring-2 focus:ring-inset focus:ring-brand/60', (ownStatus || carried) && 'font-semibold text-brand', carried && 'italic')}
                  >
                    <option value="">—</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s} title={STATUS_NAME[s]}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                {cs.length === 0 && <td className={td} />}
                {scoreColumns.map((c, i) => {
                  const text = student.scores[c.id] ?? '';
                  const parsed = parseScore(text, c.maxScore);
                  return (
                    <td key={c.id} className={cn(td, 'group-hover:bg-slate-50 group-focus-within:bg-sky-50/60', outcome.kind === 'status' && 'bg-slate-50')}>
                      {cellInput(student, row, i + 2, text, (v) => setScore(student.id, c.id, v), {
                        numeric: true,
                        label: c.label,
                        invalid: parsed.kind === 'invalid' ? parsed.message : undefined,
                      })}
                    </td>
                  );
                })}
                {we.length === 0 && <td className={td} />}
                <td className="border-b border-slate-200" />
                <td className="border-b border-slate-200" />
                {outputs.map((o, i) => (
                  <td key={o.key} style={outStyle(i)} className={cn(td, 'z-10 bg-[#fdf6f6]', i === 0 && 'border-l-2 border-l-brand/40')}>
                    <button
                      onClick={() => {
                        const col = outcome.kind === 'incomplete' || outcome.kind === 'invalid' ? firstProblemCol(student) : undefined;
                        if (col !== undefined) focusCell(row, col);
                        else openDrawer({ studentId: student.id, term });
                      }}
                      className="flex h-8 w-full items-center justify-end gap-1 px-2 text-right hover:bg-brand/10"
                      title={outcome.kind === 'incomplete' || outcome.kind === 'invalid' ? 'Go to the score that needs attention' : 'Show the step-by-step breakdown'}
                    >
                      <OutputCell outcome={outcome} column={o.key} first={i === 0} />
                    </button>
                  </td>
                ))}
              </tr>
            );
          })}
          {record.students.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="p-0">
                <div className="sticky left-0 flex max-w-2xl flex-col gap-3 px-6 py-8">
                  <div>
                    <h3 className="text-base font-semibold">Add your students</h3>
                    <p className="text-sm text-slate-500">
                      Start from Mastersoft's student list so the export keeps Mastersoft's order, or bring in your own class record.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={onImportMastersoft}>
                      <FileSpreadsheet /> Import from Mastersoft
                    </Button>
                    <Button variant="outline" onClick={onImportExcel}>
                      <FileUp /> Import Excel class record
                    </Button>
                    <Button variant="outline" onClick={onAddStudent}>
                      <UserPlus /> Type them in
                    </Button>
                  </div>
                  <p className="text-xs text-slate-400">You can also paste rows copied from Excel (ID, name, scores) into a Student ID cell.</p>
                </div>
              </td>
            </tr>
          ) : (
            <tr>
              <td colSpan={4} style={{ left: 0 }} className={cn(td, pinned, 'bg-white px-2 py-1.5')}>
                <Button size="sm" variant="ghost" onClick={onAddStudent}>
                  <Plus /> Add student
                </Button>
              </td>
              <td colSpan={columnCount - 4} className="border-b border-slate-200" />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const Unverified = ({ title, children = '!' }: { title: string; children?: ReactNode }) => (
  <Badge variant="amber" title={title} className="px-1">
    {children}
  </Badge>
);

/** `first` is the first output column, which carries the row's message. */
function OutputCell({ outcome, column, first }: { outcome: TermOutcome; column: string; first: boolean }) {
  switch (outcome.kind) {
    case 'status':
      return <span className={cn('text-xs font-semibold text-brand', outcome.carried && 'italic')}>{outcome.status}</span>;
    case 'setup':
      return <span className="text-slate-300">—</span>;
    case 'incomplete':
      return first ? (
        <span className="whitespace-nowrap text-xs font-medium text-amber-700" title="Click to go to the blank score">
          {outcome.missing} blank
        </span>
      ) : (
        <span className="text-slate-300">—</span>
      );
    case 'invalid':
      return first ? (
        <span className="whitespace-nowrap text-xs font-medium text-red-600" title={`${outcome.messages.join('\n')}\nClick to go to the score.`}>
          Fix score
        </span>
      ) : (
        <span className="text-slate-300">—</span>
      );
    case 'ok': {
      const { result } = outcome;
      const comp = column === 'cs' ? result.cs : column === 'we' ? result.we : null;
      if (comp) {
        return (
          <>
            {comp.unverifiedBoundary && <Unverified title="Unverified boundary: the raw % is between x.495 and x.499, where rounding twice differs from rounding once (D20)." />}
            {comp.unverifiedLowPct && <Unverified title="Unverified: scores below 38% use whole-number transmutation ranges not yet confirmed in Mastersoft (D30)." />}
            <span className="tabular font-semibold">{comp.raw}</span>
          </>
        );
      }
      if (column === 'rawsum') return <span className="tabular text-slate-500">{outcome.rawSumResult?.termGrade}</span>;
      if (column === 'tg') {
        return (
          <>
            {outcome.decimalWarning && (
              <Unverified title={`Decimal marks: encoding them as whole numbers would give ${outcome.decimalWarning.roundedGrade}. Consider a larger Total Marks (e.g. 1000).`}>
                dec
              </Unverified>
            )}
            <span className={cn('tabular font-semibold', result.termGrade < rules.passingGrade && 'text-red-600')}>{result.termGrade}</span>
          </>
        );
      }
      const pg = result.termPointGrade;
      return pg.verified ? (
        <span className={cn('tabular font-semibold', result.termGrade < rules.passingGrade && 'text-red-600')}>{formatPoint(pg.point)}</span>
      ) : (
        <Unverified title="Unverified term point grade: taken from the sheet, not yet confirmed in Mastersoft (D31, D32).">
          <span className="tabular text-sm">{formatPoint(pg.point)}</span>
        </Unverified>
      );
    }
  }
}

/** Compact CO and LO pills under a column header. */
function ObeTags({ record, column }: { record: ClassRecord; column: Column }) {
  const { cos, los } = columnTags(record.obe, column);
  if (cos.length === 0 && los.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-0.5" title={[...cos, ...los].join(', ')}>
      {cos.length > 0 && <span className="rounded bg-brand/10 px-1 text-[10px] font-semibold leading-4 text-brand">{cos.join(' · ')}</span>}
      {los.length > 0 && <span className="rounded bg-slate-200/70 px-1 text-[10px] font-medium leading-4 text-slate-600">{los.join(' · ')}</span>}
    </div>
  );
}
