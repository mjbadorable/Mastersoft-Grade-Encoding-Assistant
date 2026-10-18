import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useStore } from '../app/store';
import type { Category, Column, Component, TermSetup } from '../app/types';
import { sumMarks, type Term } from '../engine';
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
}

export function ColumnDialog({ term, setup, column, onClose, hasScores }: ColumnDialogProps) {
  return (
    <Dialog open={column !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={column === 'new' ? 'Add column' : 'Edit column'}
        description="Tag each column as Class Standing or Written Exam; the app adds them into Mastersoft's two totals."
      >
        {column !== null && <ColumnForm term={term} setup={setup} column={column} onClose={onClose} hasScores={hasScores} />}
      </DialogContent>
    </Dialog>
  );
}

function ColumnForm({ term, setup, column, onClose, hasScores }: ColumnDialogProps & { column: Column | 'new' }) {
  const { saveColumn, deleteColumn } = useStore();
  const existing = column === 'new' ? undefined : column;
  const [label, setLabel] = useState(existing?.label ?? '');
  const [max, setMax] = useState(existing ? String(existing.maxScore) : '');
  const [component, setComponent] = useState<Component>(existing?.component ?? 'CS');
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? setup.categories[0]?.id ?? '');
  const weighted = setup.csMode === 'WEIGHTED_CATEGORIES';
  const maxScore = Number(max);
  const maxValid = max.trim() !== '' && Number.isFinite(maxScore) && maxScore > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!maxValid) return;
    saveColumn(term, {
      id: existing?.id ?? crypto.randomUUID(),
      label: label.trim() || (component === 'CS' ? 'Quiz' : 'Exam'),
      maxScore,
      component,
      categoryId: component === 'CS' && categoryId ? categoryId : undefined,
    });
    onClose();
  };
  const remove = () => {
    if (!existing) return;
    if (hasScores(existing.id) && !window.confirm(`Delete "${existing.label}" and the scores typed in it?`)) return;
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
      <div className="mt-2 flex items-center justify-between">
        {existing ? (
          <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={remove}>
            <Trash2 /> Delete column
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={!maxValid}>
          {existing ? 'Save' : 'Add column'}
        </Button>
      </div>
    </form>
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
