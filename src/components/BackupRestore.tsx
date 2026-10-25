import { ArchiveRestore, Download } from 'lucide-react';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { BackupError, backupFileName, backupFingerprint, parseBackup, serializeBackup, type BackupFile } from '../app/backup';
import { useActiveClass, useStore } from '../app/store';
import { downloadFile } from '../lib/download';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';

/** Header buttons: download the open class as a JSON backup, or restore one (D9). */
export function BackupRestore() {
  const active = useActiveClass();
  const { classes, restoreClass, backedUp, markBackedUp } = useStore();
  const input = useRef<HTMLInputElement>(null);
  // The open class has students and changed since its last backup (or was never backed up).
  const fingerprint = useMemo(() => (active ? backupFingerprint(active) : null), [active]);
  const needsBackup = !!active && active.students.length > 0 && backedUp[active.id] !== fingerprint;
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const existing = pending && classes.find((c) => c.id === pending.classRecord.id);
  const done = (mode: 'replace' | 'copy') => {
    if (pending) restoreClass(pending.classRecord, mode);
    setPending(null);
  };
  const c = pending?.classRecord;

  return (
    <>
      <button
        onClick={() => {
          if (!active) return;
          downloadFile(serializeBackup(active), backupFileName(active), 'application/json');
          markBackedUp(active);
        }}
        disabled={!active}
        className="flex items-center gap-1 text-xs text-white/85 hover:text-white disabled:opacity-50"
        title={
          needsBackup
            ? 'This class changed since its last backup. Download a backup file: it is your only copy outside this browser.'
            : 'Download the open class as a backup file'
        }
      >
        <Download className="size-4" /> Backup
        {needsBackup && <span className="rounded bg-amber-300 px-1.5 py-px text-[10px] font-semibold text-amber-950">Not backed up</span>}
      </button>
      <button onClick={() => input.current?.click()} className="flex items-center gap-1 text-xs text-white/85 hover:text-white" title="Restore a class from a backup file">
        <ArchiveRestore className="size-4" /> Restore
      </button>
      <input ref={input} type="file" accept=".json,application/json" className="sr-only" onChange={(e) => void choose(e)} aria-label="Backup file to restore" />

      <Dialog open={!!pending || !!error} onOpenChange={(o) => !o && (setPending(null), setError(null))}>
        <DialogContent title="Restore a backup" description="Backups are JSON files downloaded from this app.">
          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {c && (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 rounded-md bg-slate-50 px-3 py-2">
                <dt className="text-slate-500">Class</dt>
                <dd>{[c.subjectCode, c.subjectName, c.section].filter(Boolean).join(' · ') || 'Untitled'}</dd>
                <dt className="text-slate-500">Students</dt>
                <dd>{c.students.length}</dd>
                <dt className="text-slate-500">Backed up</dt>
                <dd>{new Date(pending.exportedAt).toLocaleString()}</dd>
              </dl>
              {existing ? (
                <>
                  <p className="text-slate-700">This class is already in this browser. Replace it with the backup, or keep both?</p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => done('copy')}>
                      Keep both
                    </Button>
                    <Button variant="destructive" onClick={() => done('replace')}>
                      Replace current
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex justify-end">
                  <Button onClick={() => done('replace')}>Restore class</Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
