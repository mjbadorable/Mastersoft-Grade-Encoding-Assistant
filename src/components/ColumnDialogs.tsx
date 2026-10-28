import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { parseScore } from '../app/gradebook';
import { useStore } from '../app/store';
import type { Category, Column, Component, TermSetup } from '../app/types';
import { OBE_DEFAULT_CONFIG, sumMarks, type ObeConfig, type Term } from '../engine';
import { cn } from '../lib/utils';
import { confirmAction } from './ConfirmDialog';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';
import { Input, Label, Select } from './ui/input';

interface ColumnDialogProps {
  term: Term;
  setup: TermSetup;
  /** Column to edit, 'new' to add one, null when closed. */
  column: Column | 'new' | null;
  onClose: () => void;
  hasScores: (columnId: string) => boolean;
  /** Component picked when adding a new column. */
  defaultComponent?: Component;
  /** The class's syllabus outcomes, for CO / LO tags. */
  obe?: ObeConfig;
}

export function ColumnDialog({ term, setup, column, onClose, hasScores, defaultComponent, obe }: ColumnDialogProps) {
  return (
    <Dialog open={column !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={column === 'new' ? 'Add column' : 'Edit column'}
        description="Tag each column as Class Standing or Written Exam; the app adds them into Mastersoft's two totals."
      >
        {column !== null && (
          <ColumnForm term={term} setup={setup} column={column} onClose={onClose} hasScores={hasScores} defaultComponent={defaultComponent} obe={obe} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ColumnForm({ term, setup, column, onClose, hasScores, defaultComponent, obe }: ColumnDialogProps & { column: Column | 'new' }) {
  const { saveColumn, deleteColumn, setObeConfig } = useStore();
  const existing = column === 'new' ? undefined : column;
  const [label, setLabel] = useState(existing?.label ?? '');
  const [max, setMax] = useState(existing ? String(existing.maxScore) : '');
  const [component, setComponent] = useState<Component>(existing?.component ?? defaultComponent ?? 'CS');
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? setup.categories[0]?.id ?? '');
  const [coIds, setCoIds] = useState(existing?.coIds ?? []);
  const [loIds, setLoIds] = useState(existing?.loIds ?? []);
  // Custom CO split: starts custom only when the column already has weights for a tagged CO.
  const [split, setSplit] = useState<'equal' | 'custom'>(coIds.some((id) => existing?.coWeights?.[id] !== undefined) ? 'custom' : 'equal');
  const [weightText, setWeightText] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(existing?.coWeights ?? {}).map(([id, w]) => [id, String(w)])),
  );
  const hasCos = !!obe && obe.cos.length > 0;
  const [obeOpen, setObeOpen] = useState(false);
  const customSplit = split === 'custom' && coIds.length >= 2;
  const shownWeight = (id: string) => weightText[id] ?? String(Math.round(100 / coIds.length));
  const weights = coIds.map((id) => Number(shownWeight(id)));
  const weightsPlain = coIds.every((id, i) => shownWeight(id).trim() !== '' && Number.isFinite(weights[i]) && weights[i]! > 0);
  const weightTotal = weightsPlain ? sumMarks(weights) : NaN;
  const weightsValid = !customSplit || weightTotal === 100;
  const weighted = setup.csMode === 'WEIGHTED_CATEGORIES';
  const maxScore = Number(max);
  const maxValid = max.trim() !== '' && Number.isFinite(maxScore) && maxScore > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!maxValid || !weightsValid) return;
    saveColumn(term, {
      id: existing?.id ?? crypto.randomUUID(),
      label: label.trim() || (component === 'CS' ? 'Quiz' : 'Exam'),
      maxScore,
      component,
      categoryId: component === 'CS' && categoryId ? categoryId : undefined,
      coIds: coIds.length > 0 ? coIds : undefined,
      loIds: loIds.length > 0 ? loIds : undefined,
      coWeights: customSplit ? Object.fromEntries(coIds.map((id, i) => [id, weights[i]!])) : undefined,
    });
    onClose();
  };
  const remove = async () => {
    if (!existing) return;
    if (
      hasScores(existing.id) &&
      !(await confirmAction({ title: 'Delete column?', message: `"${existing.label}" and the scores typed in it will be deleted.`, confirmLabel: 'Delete column' }))
    ) {
      return;
    }
    deleteColumn(term, existing.id);
    onClose();
  };

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid grid-cols-[1fr_8rem] gap-3">
        <Label>
          Column name
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Quiz 1" autoFocus />
        </Label>
        <Label>
          Maximum score
          <Input
            value={max}
            onChange={(e) => setMax(e.target.value)}
            inputMode="decimal"
            placeholder="50"
            aria-invalid={max !== '' && !maxValid}
            className="tabular aria-invalid:border-red-500"
          />
        </Label>
      </div>
      {max !== '' && !maxValid && <p className="text-xs text-red-600">Maximum score must be a number greater than 0 (Mastersoft rejects an empty Total Marks).</p>}
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-xs font-medium text-slate-600">Mastersoft component</legend>
        <div className="flex gap-2">
          {(['CS', 'WE'] as const).map((c) => (
            <label
              key={c}
              className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm has-checked:border-brand has-checked:bg-brand/5"
            >
              <input type="radio" name="component" checked={component === c} onChange={() => setComponent(c)} className="accent-brand" />
              {c === 'CS' ? 'Class Standing' : 'Written Exam'}
            </label>
          ))}
        </div>
      </fieldset>
      {weighted && component === 'CS' && (
        <Label>
          Category
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose a category…</option>
            {setup.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.weightPct}%)
              </option>
            ))}
          </Select>
        </Label>
      )}
      <fieldset className="grid gap-2">
        {hasCos && <legend className="mb-1 text-xs font-medium text-slate-600">OBE outcomes assessed</legend>}
        {hasCos ? (
          <>
            <TagPills label="Course Outcomes" options={obe.cos.map((c) => ({ id: c.id, code: c.code, title: c.description }))} selected={coIds} onChange={setCoIds} />
            <TagPills
              label="Learning Outcomes"
              options={obe.los.filter((l) => l.term === term).map((l) => ({ id: l.id, code: l.code, title: l.description }))}
              selected={loIds}
              onChange={setLoIds}
            />
            {coIds.length >= 2 && (
              <div className="grid gap-2">
                <div role="radiogroup" aria-label="How points are split across the COs" className="flex gap-2">
                  {(['equal', 'custom'] as const).map((v) => (
                    <label
                      key={v}
                      className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm has-checked:border-brand has-checked:bg-brand/5"
                    >
                      <input type="radio" name="coSplit" checked={split === v} onChange={() => setSplit(v)} className="accent-brand" />
                      {v === 'equal' ? 'Equal split' : 'Custom %'}
                    </label>
                  ))}
                </div>
                {customSplit ? (
                  <>
                    <div className="flex flex-wrap gap-3">
                      {(obe?.cos ?? [])
                        .filter((c) => coIds.includes(c.id))
                        .map((c) => (
                          <label key={c.id} className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                            {c.code}
                            <Input
                              value={shownWeight(c.id)}
                              onChange={(e) => setWeightText({ ...weightText, [c.id]: e.target.value })}
                              inputMode="decimal"
                              aria-label={`${c.code} weight %`}
                              className="tabular h-8 w-20"
                            />
                            %
                          </label>
                        ))}
                    </div>
                    <p className={weightTotal === 100 ? 'text-xs text-emerald-700' : 'text-xs text-amber-700'}>
                      Total: {weightsPlain ? `${weightTotal}%` : 'enter numbers above 0'} {weightTotal === 100 ? '✓' : '(must be 100%)'}
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500">Points are split equally across the tagged COs.</p>
                )}
              </div>
            )}
          </>
        ) : !obeOpen ? (
          <button type="button" onClick={() => setObeOpen(true)} className="justify-self-start text-xs font-medium text-brand underline-offset-2 hover:underline">
            Tag OBE outcomes (optional)
          </button>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
            No course outcomes set up for this class yet.
            <Button size="sm" variant="outline" onClick={() => setObeConfig(OBE_DEFAULT_CONFIG)}>
              Initialize CO1–CO3
            </Button>
          </div>
        )}
      </fieldset>
      {existing && <BulkScoreTools term={term} column={existing} hasScores={hasScores(existing.id)} />}
      <div className="mt-2 flex items-center justify-between">
        {existing ? (
          <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => void remove()}>
            <Trash2 /> Delete column
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={!maxValid || !weightsValid}>
          {existing ? 'Save' : 'Add column'}
        </Button>
      </div>
    </form>
  );
}

/** Collapsible fill / clear tools for a saved column. Fill skips students with a status in the term. */
function BulkScoreTools({ term, column, hasScores }: { term: Term; column: Column; hasScores: boolean }) {
  const { fillColumnScores, clearColumnScores } = useStore();
  const [value, setValue] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const parsed = parseScore(value, column.maxScore);
  const valid = parsed.kind === 'ok';
  const fill = () => {
    if (valid) fillColumnScores(term, column.id, value, overwrite ? 'all' : 'blanks-only');
  };
  const clear = async () => {
    if (!(await confirmAction({ title: 'Clear all scores?', message: `Every score typed in "${column.label}" will be removed. You can undo this.`, confirmLabel: 'Clear scores' }))) return;
    clearColumnScores(term, column.id);
  };
  return (
    <details className="rounded-md border border-slate-200 px-3 py-2 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-slate-600">Bulk score tools</summary>
      <div className="mt-3 grid gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Label className="w-32">
            Fill value (0–{column.maxScore})
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  fill();
                }
              }}
              inputMode="decimal"
              placeholder={String(column.maxScore)}
              aria-invalid={value.trim() !== '' && !valid}
              className="tabular aria-invalid:border-red-500"
            />
          </Label>
          <Button variant="outline" disabled={!valid} onClick={fill}>
            Fill empty cells
          </Button>
        </div>
        {value.trim() !== '' && parsed.kind === 'invalid' && <p className="text-xs text-red-600">{parsed.message}.</p>}
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="accent-brand" />
          Also replace scores already typed
        </label>
        <p className="text-[11px] text-slate-500">Students with a status (INC, ABS, HNA, DRP, WP) in this term are skipped. Undo restores the old scores.</p>
        <Button variant="ghost" className="justify-self-start text-red-600 hover:bg-red-50" disabled={!hasScores} onClick={() => void clear()}>
          <Trash2 /> Clear all scores in column
        </Button>
      </div>
    </details>
  );
}

interface TagPillsProps {
  label: string;
  options: { id: string; code: string; title: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

/** Multi-select pill checkboxes for CO / LO tags. */
function TagPills({ label, options, selected, onChange }: TagPillsProps) {
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  return (
    <div>
      <div className="mb-1 text-[11px] text-slate-500">{label}</div>
      {options.length === 0 ? (
        <p className="text-[11px] text-slate-400">None for this term.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => (
            <label
              key={o.id}
              title={o.title}
              className={cn(
                'cursor-pointer rounded-full border px-2.5 py-0.5 text-xs font-medium',
                selected.includes(o.id) ? 'border-brand bg-brand/10 text-brand' : 'border-slate-300 text-slate-600 hover:bg-slate-50',
              )}
            >
              <input type="checkbox" className="sr-only" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
              {o.code}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Class Standing categories for weighted mode (D5, D25): weights must add up to 100%. */
export function CategoriesDialog({ term, setup, open, onOpenChange }: { term: Term; setup: TermSetup; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Class Standing categories" description="Each term has its own categories. The weights must add up to 100%.">
        {open && <CategoriesForm term={term} setup={setup} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CategoriesForm({ term, setup, onClose }: { term: Term; setup: TermSetup; onClose: () => void }) {
  const setCategories = useStore((s) => s.setCategories);
  const [rows, setRows] = useState(setup.categories.map((c) => ({ ...c, weight: String(c.weightPct) })));
  const weights = rows.map((r) => Number(r.weight));
  const allNumbers = rows.every((row, i) => row.weight.trim() !== '' && isWeight(weights[i]!));
  const total = allNumbers ? sumMarks(weights) : NaN;

  const update = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((row, j) => (i === j ? { ...row, ...patch } : row)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!allNumbers) return;
    const categories: Category[] = rows.map((row) => ({ id: row.id, name: row.name.trim() || 'Category', weightPct: Number(row.weight) }));
    setCategories(term, categories);
    onClose();
  };

  return (
    <form onSubmit={submit} className="grid gap-3">
      {rows.map((row, i) => (
        <div key={row.id} className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
          <Label>
            {i === 0 && 'Category'}
            <Input value={row.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Quiz" />
          </Label>
          <Label>
            {i === 0 && 'Weight %'}
            <Input value={row.weight} onChange={(e) => update(i, { weight: e.target.value })} inputMode="decimal" className="tabular" />
          </Label>
          <Button variant="ghost" size="icon" aria-label={`Remove ${row.name}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setRows([...rows, { id: crypto.randomUUID(), name: '', weightPct: 0, weight: '' }])}>
        <Plus /> Add category
      </Button>
      <p className={total === 100 ? 'text-sm text-emerald-700' : 'text-sm text-amber-700'}>
        Total: {allNumbers ? `${total}%` : 'enter numbers'} {total === 100 ? '✓' : '(must be 100%)'}
      </p>
      <div className="flex justify-end">
        <Button type="submit" disabled={!allNumbers}>
          Save categories
        </Button>
      </div>
    </form>
  );
}

const isWeight = (w: number) => Number.isFinite(w) && w >= 0;
