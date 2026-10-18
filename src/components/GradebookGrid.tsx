import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useRef, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { assessmentTotals, csColumns, formatPoint, parseScore, termOutcome, weColumns, type TermOutcome } from '../app/gradebook';
import { STATUS_NAME, STATUSES } from '../app/labels';
import { useStore, type CellKey } from '../app/store';
import type { ClassRecord, Column, Student } from '../app/types';
import { rules, type Status, type Term } from '../engine';
import { cn } from '../lib/utils';
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

interface Props {
  record: ClassRecord;
  term: Term;
  onEditColumn: (c: Column) => void;
  onAddColumn: () => void;
}

export function GradebookGrid({ record, term, onEditColumn, onAddColumn }: Props) {
  const { setStudentField, setScore, setStatus, deleteStudent, addStudent, pasteBlock, openDrawer } = useStore();
  const setup = record.terms[term];
  const cs = csColumns(setup);
  const we = weColumns(setup);
  const scoreColumns = [...cs, ...we];
  const totals = assessmentTotals(setup);
  const weighted = setup.csMode === 'WEIGHTED_CATEGORIES';
  const categoryName = (c: Column) => setup.categories.find((cat) => cat.id === c.categoryId)?.name;
  const tableRef = useRef<HTMLTableElement>(null);

  const outcomes = useMemo(() => record.students.map((s) => termOutcome(record, s, term)), [record, term]);
  const fromMastersoft = record.students.some((s) => s.mastersoft);

  // Editable cells, in order: Student ID, Name, then each score column.
  const keys: CellKey[] = ['studentId', 'name', ...scoreColumns.map((c) => ({ columnId: c.id }))];

  const focusCell = (row: number, col: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`[data-cell="${row}:${col}"]`);
    if (el) {
      el.focus();
      el.select();
    }
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
      onFocus={(e) => e.target.select()}
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
  const outStyle = (i: number): CSSProperties => ({ right: (outputs.length - 1 - i) * OUT_W, width: OUT_W, minWidth: OUT_W });
  const leftStyle = (i: number): CSSProperties => ({ left: LEFT[i]!.left, width: LEFT[i]!.w, minWidth: LEFT[i]!.w });

  const th = 'border-b border-r border-slate-200 bg-slate-100 px-2 py-1.5 text-left text-xs font-semibold text-slate-600';
  const td = 'border-b border-r border-slate-200 p-0';
  const pinned = 'sticky z-10';

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-white">
      <table ref={tableRef} className="min-w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20">
          <tr>
            {['#', 'Student ID', 'Student Name', 'Status'].map((h, i) => (
              <th key={h} rowSpan={2} style={leftStyle(i)} className={cn(th, pinned, 'z-30 align-bottom', i === 3 && 'border-r-2 border-r-slate-300')}>
                {h}
              </th>
            ))}
            <th colSpan={Math.max(cs.length, 1)} className={cn(th, 'bg-sky-50 text-center text-sky-900')}>
              Class Standing{weighted && ' (weighted categories)'}
            </th>
            <th colSpan={Math.max(we.length, 1)} className={cn(th, 'bg-violet-50 text-center text-violet-900')}>
              Written Exam
            </th>
            <th rowSpan={2} className={cn(th, 'w-12')}>
              <Button size="icon" variant="ghost" onClick={onAddColumn} aria-label="Add column" title="Add column">
                <Plus />
              </Button>
            </th>
            <th rowSpan={2} className="w-full border-b border-slate-200 bg-slate-100" />
            {outputs.map((o, i) => (
              <th
                key={o.key}
                rowSpan={2}
                style={outStyle(i)}
                className={cn(th, pinned, 'z-30 bg-brand/10 align-bottom text-brand', i === 0 && 'border-l-2 border-l-brand/40')}
              >
                <div className="leading-tight">{o.head}</div>
                {o.sub && <div className="tabular text-[11px] font-normal text-slate-500">{o.sub}</div>}
              </th>
            ))}
          </tr>
          <tr>
            {scoreColumns.length === 0 && <th colSpan={2} className={cn(th, 'font-normal text-slate-400')} />}
            {cs.length === 0 && we.length > 0 && <th className={cn(th, 'font-normal text-slate-400')}>—</th>}
            {scoreColumns.map((c) => (
              <th key={c.id} className={cn(th, 'min-w-20 p-0', c.component === 'CS' ? 'bg-sky-50/60' : 'bg-violet-50/60')}>
                <button onClick={() => onEditColumn(c)} className="w-full px-2 py-1.5 text-left hover:bg-white/70" title="Edit column">
                  <div className="truncate">{c.label}</div>
                  <div className="tabular text-[11px] font-normal text-slate-500">
                    / {c.maxScore}
                    {weighted && c.component === 'CS' && <span className="ml-1">· {categoryName(c) ?? 'no category'}</span>}
                  </div>
                </button>
              </th>
            ))}
            {we.length === 0 && cs.length > 0 && <th className={cn(th, 'font-normal text-slate-400')}>—</th>}
          </tr>
        </thead>
        <tbody>
          {record.students.map((student, row) => {
            const outcome = outcomes[row]!;
            const ownStatus = student.statuses[term];
            const carried = outcome.kind === 'status' && outcome.carried;
            return (
              <tr key={student.id} className="group">
                <td style={leftStyle(0)} className={cn(td, pinned, 'bg-white text-center text-xs text-slate-500')}>
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
                    onClick={() => {
                      const hasData = student.name || student.studentId || Object.values(student.scores).some((v) => v.trim());
                      if (!hasData || window.confirm(`Remove ${student.name || 'this student'} from the class?`)) deleteStudent(student.id);
                    }}
                    className="hidden w-full justify-center text-slate-400 hover:text-red-600 group-hover:flex"
                    aria-label={`Remove ${student.name || `row ${row + 1}`}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
                <td style={leftStyle(1)} className={cn(td, pinned, 'bg-white')}>
                  {cellInput(student, row, 0, student.studentId, (v) => setStudentField(student.id, 'studentId', v), { label: 'Student ID' })}
                </td>
                <td style={leftStyle(2)} className={cn(td, pinned, 'bg-white')}>
                  {cellInput(student, row, 1, student.name, (v) => setStudentField(student.id, 'name', v), { label: 'Student name' })}
                </td>
                <td style={leftStyle(3)} className={cn(td, pinned, 'border-r-2 border-r-slate-300 bg-white')}>
                  <select
                    value={carried ? outcome.status : (ownStatus ?? '')}
                    disabled={carried}
                    onChange={(e) => setStatus(student.id, term, (e.target.value || undefined) as Status | undefined)}
                    title={carried ? `${STATUS_NAME[outcome.status]}: carried forward from an earlier term` : 'Mastersoft status for this term'}
                    aria-label={`Status for ${student.name || `row ${row + 1}`}`}
                    className={cn('h-8 w-full bg-transparent px-1 text-xs outline-none focus:ring-2 focus:ring-inset focus:ring-brand/60', (ownStatus || carried) && 'font-semibold text-brand', carried && 'italic')}
                  >
                    <option value="">—</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s} title={STATUS_NAME[s]}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                {scoreColumns.length === 0 && <td colSpan={2} className={td} />}
                {cs.length === 0 && we.length > 0 && <td className={td} />}
                {scoreColumns.map((c, i) => {
                  const text = student.scores[c.id] ?? '';
                  const parsed = parseScore(text, c.maxScore);
                  return (
                    <td key={c.id} className={cn(td, outcome.kind === 'status' && 'bg-slate-50')}>
                      {cellInput(student, row, i + 2, text, (v) => setScore(student.id, c.id, v), {
                        numeric: true,
                        label: c.label,
                        invalid: parsed.kind === 'invalid' ? parsed.message : undefined,
                      })}
                    </td>
                  );
                })}
                {we.length === 0 && cs.length > 0 && <td className={td} />}
                <td className={td} />
                <td className="border-b border-slate-200" />
                {outputs.map((o, i) => (
                  <td key={o.key} style={outStyle(i)} className={cn(td, pinned, 'bg-[#fdf6f6]', i === 0 && 'border-l-2 border-l-brand/40')}>
                    <button
                      onClick={() => openDrawer({ studentId: student.id, term })}
                      className="flex h-8 w-full items-center justify-end gap-1 px-2 text-right hover:bg-brand/10"
                      title="Show the step-by-step breakdown"
                    >
                      <OutputCell outcome={outcome} column={o.key} />
                    </button>
                  </td>
                ))}
              </tr>
            );
          })}
          <tr>
            <td colSpan={4} style={{ left: 0 }} className={cn(td, pinned, 'bg-white px-2 py-1.5')}>
              <Button size="sm" variant="ghost" onClick={addStudent}>
                <Plus /> Add student
              </Button>
              {record.students.length < 2 && (
                <span className="ml-2 text-xs text-slate-500">Tip: paste rows copied from Excel (ID, name, scores) into a Student ID cell to fill the grid.</span>
              )}
            </td>
            <td colSpan={Math.max(cs.length, 1) + Math.max(we.length, 1) + 2 + outputs.length} className="border-b border-slate-200" />
          </tr>
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

function OutputCell({ outcome, column }: { outcome: TermOutcome; column: string }) {
  switch (outcome.kind) {
    case 'status':
      return <span className={cn('text-xs font-semibold text-brand', outcome.carried && 'italic')}>{outcome.status}</span>;
    case 'setup':
      return <span className="text-slate-300">—</span>;
    case 'incomplete':
      return (
        <span className="text-slate-300" title={`${outcome.missing} score${outcome.missing === 1 ? '' : 's'} missing`}>
          —
        </span>
      );
    case 'invalid':
      return (
        <span className="text-xs font-medium text-red-600" title={outcome.messages.join('\n')}>
          Fix scores
        </span>
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
