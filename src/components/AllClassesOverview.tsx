import { AlertTriangle, CheckCircle2, DatabaseBackup, LayoutGrid } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { subjectTypeLabel, TERM_LABEL } from '../app/labels';
import { backUpWorkspace } from '../app/backupActions';
import { classOverview, type TermProgress } from '../app/progress';
import { useStore } from '../app/store';
import type { View } from '../app/types';
import { TERMS } from '../engine';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

const badge = 'inline-flex flex-wrap items-center gap-x-1.5 rounded-full px-2 py-0.5 text-xs font-medium';

/** One term of one class: what is left to do, as a single badge. */
function TermBadge({ p }: { p: TermProgress }) {
  if (p.students === 0 || p.setupIssues.length > 0) return <span className={cn(badge, 'bg-slate-100 text-slate-600')}>Needs setup</span>;
  if (p.complete) {
    return (
      <span className={cn(badge, 'bg-emerald-50 text-emerald-800')}>
        <CheckCircle2 className="size-3.5" /> Ready ({p.ready})
      </span>
    );
  }
  return (
    <span className={cn(badge, p.invalid > 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800')}>
      {p.ready} / {p.students} graded
      {p.missing > 0 && <span>· {p.missing} blank</span>}
      {p.invalid > 0 && <span>· {p.invalid} to fix</span>}
    </span>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-2 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="tabular text-2xl font-semibold text-slate-900">{children}</div>
    </div>
  );
}

/** Every class at a glance: setup, scores and backup, with a click through to the right gradebook. */
export function AllClassesOverview() {
  const { classes, backedUp, selectClass, setView } = useStore();
  const rows = useMemo(() => classes.map((c) => ({ c, o: classOverview(c, backedUp[c.id]) })), [classes, backedUp]);
  const students = rows.reduce((n, r) => n + r.o.students, 0);
  const complete = rows.reduce((n, r) => n + TERMS.filter((t) => r.o.terms[t].complete).length, 0);
  const open = (id: string, view: View) => {
    selectClass(id);
    setView(view);
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <LayoutGrid className="size-4 text-brand" />
        <h2 className="text-base font-semibold">All classes overview</h2>
      </div>
      {rows.length === 0 ? (
        <p className="m-auto max-w-md px-6 py-16 text-center text-sm text-slate-500">
          No classes yet. Create a class or import one from Mastersoft, and its progress will show here.
        </p>
      ) : (
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap gap-3">
            <Stat label="Classes">{classes.length}</Stat>
            <Stat label="Students">{students}</Stat>
            <Stat label="Term gradebooks complete">
              {complete} <span className="text-base font-normal text-slate-400">of {classes.length * TERMS.length}</span>
            </Stat>
            <Button variant="outline" className="ml-auto self-center" onClick={() => void backUpWorkspace()} title="Download every class and your saved import templates as one file">
              <DatabaseBackup /> Backup Workspace
            </Button>
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Class</th>
                  <th className="px-3 py-2">Students</th>
                  {TERMS.map((t) => (
                    <th key={t} className="px-3 py-2">
                      {TERM_LABEL[t]}
                    </th>
                  ))}
                  <th className="px-3 py-2">Backup</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ c, o }) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2">
                      <button onClick={() => open(c.id, 'PRELIM')} className="text-left hover:text-brand">
                        <div className="font-semibold">{c.subjectCode || 'Untitled'}</div>
                        <div className="text-xs text-slate-500">{[c.subjectName, c.section, subjectTypeLabel(c.subjectType)].filter(Boolean).join(' · ')}</div>
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <span className="tabular">{o.students}</span>
                      {o.duplicateIds > 0 && (
                        <span className={cn(badge, 'ml-2 bg-red-50 text-red-700')} title="Students sharing a Student ID">
                          <AlertTriangle className="size-3.5" /> {o.duplicateIds} duplicate ID{o.duplicateIds === 1 ? '' : 's'}
                        </span>
                      )}
                    </td>
                    {TERMS.map((t) => (
                      <td key={t} className="px-3 py-2">
                        <button
                          onClick={() => open(c.id, t)}
                          aria-label={`Open ${c.subjectCode} ${TERM_LABEL[t]}`}
                          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                        >
                          <TermBadge p={o.terms[t]} />
                        </button>
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      {o.students === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : o.needsBackup ? (
                        <span className={cn(badge, 'bg-amber-50 text-amber-800')}>Not backed up</span>
                      ) : (
                        <span className={cn(badge, 'bg-emerald-50 text-emerald-800')}>Backed up</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
