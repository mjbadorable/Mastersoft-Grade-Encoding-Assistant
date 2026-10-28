import { DatabaseBackup } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { backupReminderDue } from '../app/backup';
import { backUpWorkspace } from '../app/backupActions';
import { useStore } from '../app/store';
import { Button } from './ui/button';

const DISMISSED_KEY = 'backupReminderDismissed';

const readDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * A gentle reminder that grades live only in this browser. It appears when the teacher
 * switches class or opens the Overview, and only until a backup is taken or it is dismissed
 * (for this browser session).
 */
export function BackupReminder() {
  const { classes, activeClassId, view, sessionBackupTaken } = useStore();
  const students = classes.reduce((n, c) => n + c.students.length, 0);
  const [armed, setArmed] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);
  const last = useRef({ activeClassId, view });

  useEffect(() => {
    const before = last.current;
    last.current = { activeClassId, view };
    const switchedClass = before.activeClassId !== null && activeClassId !== before.activeClassId;
    const openedOverview = view === 'OVERVIEW' && before.view !== 'OVERVIEW';
    if (switchedClass || openedOverview) setArmed(true);
  }, [activeClassId, view]);

  if (!backupReminderDue({ students, sessionBackupTaken, dismissed, armed })) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode: the reminder just comes back after a reload.
    }
  };

  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <DatabaseBackup className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">Remember to download a workspace backup before closing your browser so your grades are safe on your computer.</span>
      <Button size="sm" onClick={() => void backUpWorkspace()}>
        Download All Classes (.json)
      </Button>
      <Button size="sm" variant="ghost" onClick={dismiss}>
        Dismiss
      </Button>
    </div>
  );
}
