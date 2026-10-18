import { AlertTriangle, Check, Copy, FileDown, Plus, SlidersHorizontal, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { assessmentTotals, termSetupIssues } from '../app/gradebook';
import { SUBJECT_TYPES, subjectTypeLabel, TERM_LABEL, termWeightLabel } from '../app/labels';
import { useStore } from '../app/store';
import type { ClassRecord, Column, CsMode } from '../app/types';
import type { SubjectType, Term } from '../engine';
import { CategoriesDialog, ColumnDialog } from './ColumnDialogs';
import { GradebookGrid } from './GradebookGrid';
import { MastersoftExportDialog } from './MastersoftDialogs';
import { Button } from './ui/button';
import { Select } from './ui/input';

export function TermGradebook({ record, term }: { record: ClassRecord; term: Term }) {
  const { updateClassInfo, setCsMode, addStudent } = useStore();
  const setup = record.terms[term];
  const [columnDialog, setColumnDialog] = useState<Column | 'new' | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const weighted = setup.csMode === 'WEIGHTED_CATEGORIES';

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <h2 className="mr-2 text-base font-semibold">
          {TERM_LABEL[term]} Gradebook <span className="text-sm font-normal text-slate-400">({termWeightLabel(term)} of FR)</span>
        </h2>
        <Select
          aria-label="Subject type"
          value={record.subjectType}
          onChange={(e) => updateClassInfo({ ...record, subjectType: e.target.value as SubjectType })}
          className="h-8 rounded-full bg-slate-50 text-xs font-medium"
        >
          {SUBJECT_TYPES.map((t) => (
            <option key={t} value={t}>
              {subjectTypeLabel(t)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Class Standing mode"
          value={setup.csMode}
          onChange={(e) => setCsMode(term, e.target.value as CsMode)}
          className="h-8 rounded-full bg-slate-50 text-xs font-medium"
        >
          <option value="RAW_SUM">CS: Raw sum (Mastersoft default)</option>
          <option value="WEIGHTED_CATEGORIES">CS: Weighted categories</option>
        </Select>
        {weighted && (
          <Button size="sm" variant="outline" onClick={() => setCategoriesOpen(true)}>
            <SlidersHorizontal /> Categories ({setup.categories.length})
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setExportOpen(true)}>
            <FileDown /> Export for Mastersoft
          </Button>
          <Button size="sm" variant="outline" onClick={addStudent}>
            <UserPlus /> Add student
          </Button>
          <Button size="sm" onClick={() => setColumnDialog('new')}>
            <Plus /> Add column
          </Button>
        </div>
      </div>

      <AssessmentBanner record={record} term={term} />

      <GradebookGrid record={record} term={term} onEditColumn={setColumnDialog} onAddColumn={() => setColumnDialog('new')} />

      <ColumnDialog
        term={term}
        setup={setup}
        column={columnDialog}
        onClose={() => setColumnDialog(null)}
        hasScores={(id) => record.students.some((s) => (s.scores[id] ?? '').trim() !== '')}
      />
      <MastersoftExportDialog record={record} term={term} open={exportOpen} onOpenChange={setExportOpen} />
      <CategoriesDialog term={term} setup={setup} open={categoriesOpen} onOpenChange={setCategoriesOpen} />
    </>
  );
}

/** Mirrors Mastersoft's Assessment Component screen: the Total Marks to encode. */
function AssessmentBanner({ record, term }: { record: ClassRecord; term: Term }) {
  const setup = record.terms[term];
  const totals = assessmentTotals(setup);
  const issues = termSetupIssues(setup);
  return (
    <div className="border-b border-slate-200 bg-surface px-4 py-3">
      <div className="flex flex-wrap items-stretch gap-3">
        <div className="flex items-center text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-500">
          Mastersoft
          <br />
          Assessment Component
        </div>
        <TotalCard label={`${TERM_LABEL[term]} – Class Standing`} value={totals.cs} note={setup.csMode === 'WEIGHTED_CATEGORIES' ? 'Weighted categories: always 100' : undefined} />
        <TotalCard label={`${TERM_LABEL[term]} – Written Exam`} value={totals.we} />
        {issues.length > 0 && (
          <div className="flex min-w-64 flex-1 items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <ul className="space-y-0.5">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function TotalCard({ label, value, note }: { label: string; value: number | null; note?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (value === null) return;
    void navigator.clipboard?.writeText(String(value)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div>
        <div className="text-xs font-medium text-slate-600">{label}</div>
        <div className="text-[11px] text-slate-400">{note ?? 'Total Marks'}</div>
      </div>
      <div className="tabular text-2xl font-semibold text-slate-900" aria-label={`${label} Total Marks`}>
        {value ?? '—'}
      </div>
      {value !== null && (
        <Button variant="ghost" size="icon" onClick={copy} aria-label={`Copy ${label} Total Marks`} title="Copy">
          {copied ? <Check className="text-emerald-600" /> : <Copy />}
        </Button>
      )}
    </div>
  );
}
