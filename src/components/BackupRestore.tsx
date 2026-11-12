import { ArchiveRestore, ChevronDown, Download } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  BackupError,
  backupFileName,
  backupFingerprint,
  parseBackup,
  serializeBackup,
  type ParsedBackup,
} from '../app/backup';
import { backUpWorkspace } from '../app/backupActions';
import { useActiveClass, useStore } from '../app/store';
import { downloadFile } from '../lib/download';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';

const classTitle = (c: { subjectCode: string; subjectName: string; section: string }) =>
  [c.subjectCode, c.subjectName, c.section].filter(Boolean).join(' · ') || 'Untitled';

const row =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-xs text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-brand disabled:opacity-50';

/** Sidebar buttons: download the open class or every class as a JSON backup, or restore one (D9). `compact` is icons only (collapsed sidebar). */
export function BackupRestore({ compact = false }: { compact?: boolean }) {
  const active = useActiveClass();
  const { classes, restoreClass, restoreWorkspace, backedUp, markBackedUp } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState({ left: 0, bottom: 0 });
  // The open class has students and changed since its last backup (or was never backed up).
  const fingerprint = useMemo(() => (active ? backupFingerprint(active) : null), [active]);
  const needsBackup = !!active && active.students.length > 0 && backedUp[active.id] !== fingerprint;
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menu.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    // The menu is fixed to the screen, so it closes when the sidebar scrolls or the window changes size.
    const dismiss = () => setMenuOpen(false);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [menuOpen]);

  const backUpActive = () => {
    setMenuOpen(false);
    if (!active) return;
    downloadFile(serializeBackup(active), backupFileName(active), 'application/json');
    markBackedUp(active);
  };
  const backUpAll = () => {
    setMenuOpen(false);
    void backUpWorkspace();
  };

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      setPending(parseBackup(await f.text()));
      setError(null);
    } catch (err) {
      if (!(err instanceof BackupError)) throw err;
      setPending(null);
      setError(err.message);
    }
  };

  const doneSingle = (mode: 'replace' | 'copy') => {
    if (pending?.type === 'single') restoreClass(pending.classRecord, mode);
    setPending(null);
  };
  const doneWorkspace = (mode: 'merge' | 'replace') => {
    if (pending?.type === 'workspace') restoreWorkspace(pending.classes, pending.templates, mode);
    setPending(null);
  };

  return (
    <>
      <div ref={menu} className={compact ? undefined : 'w-full'}>
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            // The sidebar scrolls, so the menu is fixed to the screen: above the button, or beside it in the narrow rail.
            setAnchor(compact ? { left: r.right + 8, bottom: window.innerHeight - r.bottom } : { left: r.left, bottom: window.innerHeight - r.top + 4 });
            setMenuOpen((o) => !o);
          }}
          disabled={!active}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={compact ? 'Backup' : undefined}
          className={cn(row, compact && 'relative size-9 justify-center px-0')}
          title={
            needsBackup
              ? 'This class changed since its last backup. Download a backup file: it is your only copy outside this browser.'
              : 'Download a backup file'
          }
        >
          <Download className="size-4" />
          {compact ? (
            needsBackup && <span aria-hidden className="absolute right-1 top-1 size-2 rounded-full bg-amber-500 ring-2 ring-white" />
          ) : (
            <>
              Backup
              <ChevronDown className="size-3 text-slate-400" />
              {needsBackup && <span className="ml-auto whitespace-nowrap rounded-full bg-amber-100 px-2 py-px text-[10px] font-semibold text-amber-800">Not backed up</span>}
            </>
          )}
        </button>
        {menuOpen && active && (
          <div
            role="menu"
            style={{ left: anchor.left, bottom: anchor.bottom }}
            className="fixed z-50 w-64 rounded-md border border-slate-200 bg-white py-1 text-sm text-slate-800 shadow-lg"
          >
            <button role="menuitem" onClick={backUpActive} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
              Back up active class ({active.subjectCode || 'Untitled'})
            </button>
            <button role="menuitem" onClick={backUpAll} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
              Back up all classes ({classes.length} {classes.length === 1 ? 'class' : 'classes'})
            </button>
          </div>
        )}
      </div>
      <button
        onClick={() => input.current?.click()}
        aria-label={compact ? 'Restore' : undefined}
        className={cn(row, compact && 'size-9 justify-center px-0')}
        title="Restore from a backup file"
      >
        <ArchiveRestore className="size-4" /> {!compact && 'Restore'}
      </button>
      <input ref={input} type="file" accept=".json,application/json" className="sr-only" onChange={(e) => void choose(e)} aria-label="Backup file to restore" />

      <Dialog open={!!pending || !!error} onOpenChange={(o) => !o && (setPending(null), setError(null))}>
        <DialogContent title="Restore a backup" description="Backups are JSON files downloaded from this app.">
          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {pending?.type === 'single' && <SingleRestore pending={pending} onDone={doneSingle} />}
          {pending?.type === 'workspace' && <WorkspaceRestore pending={pending} onDone={doneWorkspace} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SingleRestore({ pending, onDone }: { pending: Extract<ParsedBackup, { type: 'single' }>; onDone: (mode: 'replace' | 'copy') => void }) {
  const classes = useStore((s) => s.classes);
  const c = pending.classRecord;
  const existing = classes.find((x) => x.id === c.id);
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 rounded-md bg-slate-50 px-3 py-2">
        <dt className="text-slate-500">Class</dt>
        <dd>{classTitle(c)}</dd>
        <dt className="text-slate-500">Students</dt>
        <dd>{c.students.length}</dd>
        <dt className="text-slate-500">Backed up</dt>
        <dd>{new Date(pending.exportedAt).toLocaleString()}</dd>
      </dl>
      {existing ? (
        <>
          <p className="text-slate-700">This class is already in this browser. Replace it with the backup, or keep both?</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onDone('copy')}>
              Keep both
            </Button>
            <Button variant="destructive" onClick={() => onDone('replace')}>
              Replace current
            </Button>
          </div>
        </>
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => onDone('replace')}>Restore class</Button>
        </div>
      )}
    </div>
  );
}

function WorkspaceRestore({ pending, onDone }: { pending: Extract<ParsedBackup, { type: 'workspace' }>; onDone: (mode: 'merge' | 'replace') => void }) {
  const current = useStore((s) => s.classes);
  const templateCount = pending.templates?.length ?? 0;
  const matching = pending.classes.filter((c) => current.some((x) => x.id === c.id)).length;
  const lost = current.filter((x) => !pending.classes.some((c) => c.id === x.id)).length;
  const students = pending.classes.reduce((n, c) => n + c.students.length, 0);
  return (
    <div className="space-y-4 text-sm">
      <p className="font-medium text-slate-800">
        Found {pending.classes.length} {pending.classes.length === 1 ? 'class' : 'classes'} and {templateCount} {templateCount === 1 ? 'template' : 'templates'}.
      </p>
      <div className="max-h-40 overflow-y-auto rounded-md bg-slate-50 px-3 py-2">
        <ul className="space-y-0.5">
          {pending.classes.map((c) => (
            <li key={c.id} className="flex justify-between gap-3">
              <span className="truncate">{classTitle(c)}</span>
              <span className="shrink-0 text-xs text-slate-500">{c.students.length} students</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-slate-500">
        {students} students in all · backed up {new Date(pending.exportedAt).toLocaleString()} · {matching} already in this browser
      </p>
      <div className="space-y-2 text-slate-700">
        <p>
          <strong>Merge with existing</strong> keeps your current classes and updates the {matching} that match by ID; the rest are added.
        </p>
        <p>
          <strong>Replace all workspace classes</strong> makes your workspace exactly this backup
          {lost > 0 ? ` and removes the ${lost} ${lost === 1 ? 'class' : 'classes'} that ${lost === 1 ? 'is' : 'are'} not in it` : ''}.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => onDone('merge')}>Merge with existing</Button>
        <Button variant="destructive" onClick={() => onDone('replace')}>
          Replace all workspace classes
        </Button>
      </div>
    </div>
  );
}
