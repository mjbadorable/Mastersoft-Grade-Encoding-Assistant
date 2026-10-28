import { BookOpen, Calculator, CheckCircle2, ClipboardList, FileUp, LayoutGrid, PanelLeftClose, PanelLeftOpen, Pencil, Plus, ShieldCheck, Table2, Target } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { TERM_LABEL, termWeightLabel } from '../app/labels';
import { termProgress } from '../app/progress';
import { useActiveClass, useStore } from '../app/store';
import type { ClassRecord, View } from '../app/types';
import { TERMS, type Term } from '../engine';
import { cn } from '../lib/utils';
import { ClassDialog } from './ClassDialog';
import { MastersoftImportDialog } from './MastersoftDialogs';
import { Button } from './ui/button';
import { Select } from './ui/input';

const COLLAPSED_KEY = 'sidebarCollapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

export function Sidebar({ onPrivacy }: { onPrivacy: () => void }) {
  const { classes, view, setView, selectClass } = useStore();
  const active = useActiveClass();
  const [dialog, setDialog] = useState<'new' | 'edit' | 'import' | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // Not saved; the sidebar just opens again next time.
    }
  };

  // "[" toggles the sidebar, unless the teacher is typing or a dialog is open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.matches('input, textarea, select, [contenteditable]')) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      toggleCollapsed();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const item = (v: View, icon: ReactNode, label: ReactNode, enabled = !!active) => (
    <button
      key={v}
      onClick={() => setView(v)}
      disabled={!enabled}
      aria-current={view === v ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50',
        (enabled || v === 'TABLE') && view === v && 'bg-brand/10 font-semibold text-brand hover:bg-brand/10',
      )}
    >
      {icon}
      {label}
    </button>
  );

  /** Collapsed rail: an icon with a tooltip, and a dot for term progress. */
  const railItem = (v: View, icon: ReactNode, label: string, enabled = !!active, dot?: ReactNode) => (
    <button
      key={v}
      onClick={() => setView(v)}
      disabled={!enabled}
      title={label}
      aria-label={label}
      aria-current={view === v ? 'page' : undefined}
      className={cn(
        'relative flex size-9 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 disabled:opacity-50',
        (enabled || v === 'TABLE') && view === v && 'bg-brand/10 text-brand hover:bg-brand/10',
      )}
    >
      {icon}
      {dot}
    </button>
  );

  if (collapsed) {
    const rail = 'size-4';
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white py-2">
        <button
          onClick={toggleCollapsed}
          title="Expand sidebar ([)"
          aria-label="Expand sidebar"
          className="flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-brand"
        >
          <PanelLeftOpen className={rail} />
        </button>
        <button
          onClick={toggleCollapsed}
          disabled={!active}
          title={active ? `${[active.subjectCode, active.subjectName, active.section].filter(Boolean).join(' · ')}: click to open the sidebar and switch classes` : 'No class yet'}
          className="mb-1 max-w-12 truncate rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand hover:bg-brand/20 disabled:opacity-50"
        >
          {(active?.subjectCode || 'CLS').slice(0, 4)}
        </button>
        <nav className="flex flex-1 flex-col items-center gap-0.5">
          {railItem('OVERVIEW', <LayoutGrid className={rail} />, 'All classes overview', classes.length > 0)}
          {TERMS.map((t) =>
            railItem(t, <ClipboardList className={rail} />, `${TERM_LABEL[t]} (${termWeightLabel(t)})`, !!active, active && <TermDot record={active} term={t} />),
          )}
          {railItem('SUMMARY', <BookOpen className={rail} />, 'Final Rating summary')}
          {railItem('OBE', <Target className={rail} />, 'OBE Attainment')}
          <span className="my-1 h-px w-6 bg-slate-200" />
          {railItem('REVERSE', <Calculator className={rail} />, 'Final Rating Only')}
          {railItem('TABLE', <Table2 className={rail} />, 'Transmutation table')}
        </nav>
        <button onClick={onPrivacy} title="Data Privacy Notice" aria-label="Data Privacy Notice" className="flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-brand">
          <ShieldCheck className={rail} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="space-y-2 border-b border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">My classes</p>
          <button
            onClick={toggleCollapsed}
            title="Collapse sidebar ([)"
            aria-label="Collapse sidebar"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>
        {classes.length > 0 && (
          <Select className="w-full" value={active?.id ?? ''} onChange={(e) => selectClass(e.target.value)} aria-label="Class">
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.subjectCode || 'Untitled'}
                {c.section ? ` · ${c.section}` : ''}
              </option>
            ))}
          </Select>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => setDialog('new')}>
            <Plus /> New class
          </Button>
          {active && (
            <Button size="sm" variant="outline" onClick={() => setDialog('edit')} aria-label="Edit class">
              <Pencil />
            </Button>
          )}
        </div>
        <Button size="sm" variant="outline" className="w-full" onClick={() => setDialog('import')}>
          <FileUp /> Import from Mastersoft
        </Button>
      </div>

      <nav className="flex-1 space-y-0.5 p-2">
        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Gradebook</p>
        {item('OVERVIEW', <LayoutGrid className="size-4" />, 'All classes overview', classes.length > 0)}
        {TERMS.map((t) =>
          item(
            t,
            <ClipboardList className="size-4" />,
            <span className="flex flex-1 items-center justify-between gap-2">
              {TERM_LABEL[t]}
              <span className="flex items-center gap-1.5">
                {active && <TermMark record={active} term={t} />}
                <span className="text-xs font-normal text-slate-400">{termWeightLabel(t)}</span>
              </span>
            </span>,
          ),
        )}
        {item('SUMMARY', <BookOpen className="size-4" />, 'Final Rating summary')}
        {item('OBE', <Target className="size-4" />, 'OBE Attainment')}
        <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tools</p>
        {item('REVERSE', <Calculator className="size-4" />, 'Final Rating Only')}
        {item('TABLE', <Table2 className="size-4" />, 'Transmutation table')}
      </nav>

      <button onClick={onPrivacy} className="flex items-center gap-2 border-t border-slate-200 px-5 py-3 text-xs text-slate-500 hover:text-brand">
        <ShieldCheck className="size-4" /> Data Privacy Notice
      </button>

      <MastersoftImportDialog open={dialog === 'import'} onOpenChange={(o) => !o && setDialog(null)} />
      <ClassDialog open={dialog === 'new' || dialog === 'edit'} onOpenChange={(o) => !o && setDialog(null)} record={dialog === 'edit' ? (active ?? undefined) : undefined} />
    </aside>
  );
}

/** Corner dot on a collapsed term button: green when all scores are in, amber while students still need scores. */
function TermDot({ record, term }: { record: ClassRecord; term: Term }) {
  const p = termProgress(record, term);
  const left = p.missing + p.invalid;
  if (!p.complete && (p.setupIssues.length > 0 || left === 0)) return null;
  return (
    <span
      aria-hidden
      className={cn('absolute right-1 top-1 size-2 rounded-full ring-2 ring-white', p.complete ? 'bg-emerald-500' : 'bg-amber-500')}
    />
  );
}

/** Green check when a term is done; amber count of students still needing scores. */
function TermMark({ record, term }: { record: ClassRecord; term: Term }) {
  const p = termProgress(record, term);
  if (p.complete) return <CheckCircle2 className="size-3.5 text-emerald-600" aria-label="All scores in" />;
  const left = p.missing + p.invalid;
  if (p.setupIssues.length > 0 || left === 0) return null;
  return (
    <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800" title={`${left} student(s) still need scores`}>
      {left}
    </span>
  );
}
