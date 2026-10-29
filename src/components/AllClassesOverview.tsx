import { AlertTriangle, Archive, ArchiveRestore, CheckCircle2, DatabaseBackup, LayoutGrid, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { subjectTypeLabel, TERM_LABEL } from '../app/labels';
import { backUpWorkspace } from '../app/backupActions';
import { classOverview, type TermProgress } from '../app/progress';
import { isLiveClass, useStore } from '../app/store';
import type { ClassRecord, View } from '../app/types';
import { TERMS } from '../engine';
import { cn } from '../lib/utils';
import { confirmAction } from './ConfirmDialog';
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

type Tab = 'active' | 'archived' | 'trash';

const classTitle = (c: ClassRecord) => [c.subjectCode, c.section].filter(Boolean).join(' · ') || 'this class';

function IconAction({ label, onClick, className, children }: { label: string; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <Button size="icon" variant="ghost" onClick={onClick} aria-label={label} title={label} className={className}>
      {children}
    </Button>
  );
}

/** Every class at a glance: setup, scores and backup, with a click through to the right gradebook. */
export function AllClassesOverview() {
  const { classes, backedUp, selectClass, setView, trashClass, archiveClass, unarchiveClass, restoreClassFromTrash, deleteClassPermanent, emptyTrash } = useStore();
  const [tab, setTab] = useState<Tab>('active');

  const groups = useMemo(
    () => ({
      active: classes.filter(isLiveClass),
      archived: classes.filter((c) => c.archived === true && !c.deletedAt),
      trash: classes.filter((c) => c.deletedAt !== undefined).sort((a, b) => b.deletedAt! - a.deletedAt!),
    }),
    [classes],
  );
  const rows = useMemo(() => (tab === 'trash' ? [] : groups[tab].map((c) => ({ c, o: classOverview(c, backedUp[c.id]) }))), [groups, tab, backedUp]);
  const activeRows = useMemo(() => (tab === 'active' ? rows : groups.active.map((c) => ({ c, o: classOverview(c, backedUp[c.id]) }))), [tab, rows, groups.active, backedUp]);
  const students = activeRows.reduce((n, r) => n + r.o.students, 0);
  const complete = activeRows.reduce((n, r) => n + TERMS.filter((t) => r.o.terms[t].complete).length, 0);
  const open = (id: string, view: View) => {
    selectClass(id);
    setView(view);
  };

  const moveToTrash = async (c: ClassRecord) => {
    const ok = await confirmAction({ title: 'Move class to trash?', message: `You can restore this class at any time from the Trash tab. (${classTitle(c)})`, confirmLabel: 'Move to Trash' });
    if (ok) trashClass(c.id);
  };
  const deleteForever = async (c: ClassRecord) => {
    const ok = await confirmAction({
      title: `Permanently delete ${classTitle(c)}?`,
      message: 'This will permanently remove this class and all student scores from IndexedDB. This cannot be undone.',
      confirmLabel: 'Delete permanently',
    });
    if (ok) deleteClassPermanent(c.id);
  };
  const confirmEmptyTrash = async () => {
    const ok = await confirmAction({
      title: 'Empty Trash?',
      message: `This will permanently remove ${groups.trash.length} ${groups.trash.length === 1 ? 'class' : 'classes'} and all their student scores from IndexedDB. This cannot be undone.`,
      confirmLabel: 'Empty Trash',
    });
    if (ok) emptyTrash();
  };

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'active', label: 'Active', count: groups.active.length },
    { id: 'archived', label: 'Archived', count: groups.archived.length },
    { id: 'trash', label: 'Trash', count: groups.trash.length },
  ];
  const th = 'px-3 py-2';

  return (
    <div className="flex-1 overflow-auto">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <LayoutGrid className="size-4 text-brand" />
        <h2 className="text-base font-semibold">All classes overview</h2>
      </div>
      {classes.length === 0 ? (
        <p className="m-auto max-w-md px-6 py-16 text-center text-sm text-slate-500">
          No classes yet. Create a class or import one from Mastersoft, and its progress will show here.
        </p>
      ) : (
        <div className="space-y-4 p-4">
          <div role="tablist" aria-label="Class list" className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5 text-sm">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn('rounded px-3 py-1 font-medium', tab === t.id ? 'bg-white text-brand shadow-sm' : 'text-slate-600 hover:text-slate-900')}
              >
                {t.label} ({t.count})
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Stat label="Classes">{groups.active.length}</Stat>
            <Stat label="Students">{students}</Stat>
            <Stat label="Term gradebooks complete">
              {complete} <span className="text-base font-normal text-slate-400">of {groups.active.length * TERMS.length}</span>
            </Stat>
            {tab === 'trash' ? (
              <Button variant="outline" className="ml-auto self-center text-red-600 hover:bg-red-50" disabled={groups.trash.length === 0} onClick={() => void confirmEmptyTrash()}>
                <Trash2 /> Empty Trash
              </Button>
            ) : (
              <Button variant="outline" className="ml-auto self-center" onClick={() => void backUpWorkspace()} title="Download every class and your saved import templates as one file">
                <DatabaseBackup /> Backup Workspace
              </Button>
            )}
          </div>

          {tab === 'trash' ? (
            groups.trash.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">Trash is empty.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className={th}>Class</th>
                      <th className={th}>Students</th>
                      <th className={th}>Deleted On</th>
                      <th className={cn(th, 'text-right')}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {groups.trash.map((c) => (
                      <tr key={c.id}>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-700">{c.subjectCode || 'Untitled'}</div>
                          <div className="text-xs text-slate-500">{[c.subjectName, c.section, subjectTypeLabel(c.subjectType)].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="tabular px-3 py-2">{c.students.length}</td>
                        <td className="px-3 py-2 text-slate-600">{new Date(c.deletedAt!).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => restoreClassFromTrash(c.id)}>
                              <RotateCcw className="size-4" /> Restore
                            </Button>
                            <IconAction label="Delete permanently" onClick={() => void deleteForever(c)} className="hover:bg-red-50">
                              <Trash2 className="size-4 text-red-600" />
                            </IconAction>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : rows.length === 0 ? (
            <p className="rounded-md border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
              {tab === 'archived' ? 'No archived classes.' : 'No active classes. Restore one from the Archived or Trash tab, or create a new class.'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className={th}>Class</th>
                    <th className={th}>Students</th>
                    {TERMS.map((t) => (
                      <th key={t} className={th}>
                        {TERM_LABEL[t]}
                      </th>
                    ))}
                    <th className={th}>Backup</th>
                    <th className={cn(th, 'text-right')}>Actions</th>
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
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-0.5">
                          {tab === 'active' ? (
                            <IconAction label="Archive class" onClick={() => archiveClass(c.id)}>
                              <Archive className="size-4" />
                            </IconAction>
                          ) : (
                            <IconAction label="Restore to active classes" onClick={() => unarchiveClass(c.id)}>
                              <ArchiveRestore className="size-4" />
                            </IconAction>
                          )}
                          <IconAction label="Move to trash" onClick={() => void moveToTrash(c)} className="hover:bg-red-50">
                            <Trash2 className="size-4 text-red-600" />
                          </IconAction>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
