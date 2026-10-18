import { BookOpen, Calculator, ClipboardList, FileUp, Pencil, Plus, ShieldCheck, Table2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { TERM_LABEL, termWeightLabel } from '../app/labels';
import { useActiveClass, useStore } from '../app/store';
import type { View } from '../app/types';
import { TERMS } from '../engine';
import { cn } from '../lib/utils';
import { ClassDialog } from './ClassDialog';
import { MastersoftImportDialog } from './MastersoftDialogs';
import { Button } from './ui/button';
import { Select } from './ui/input';

export function Sidebar({ onPrivacy }: { onPrivacy: () => void }) {
  const { classes, view, setView, selectClass } = useStore();
  const active = useActiveClass();
  const [dialog, setDialog] = useState<'new' | 'edit' | 'import' | null>(null);

  const item = (v: View, icon: ReactNode, label: ReactNode) => (
    <button
      key={v}
      onClick={() => setView(v)}
      disabled={!active}
      aria-current={view === v ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50',
        view === v && 'bg-brand/10 font-semibold text-brand hover:bg-brand/10',
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="space-y-2 border-b border-slate-200 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">My classes</p>
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
        {TERMS.map((t) =>
          item(
            t,
            <ClipboardList className="size-4" />,
            <span className="flex flex-1 justify-between">
              {TERM_LABEL[t]} <span className="text-xs font-normal text-slate-400">{termWeightLabel(t)}</span>
            </span>,
          ),
        )}
        {item('SUMMARY', <BookOpen className="size-4" />, 'Final Rating summary')}
        <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tools</p>
        {item('REVERSE', <Calculator className="size-4" />, 'Reverse mode')}
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
