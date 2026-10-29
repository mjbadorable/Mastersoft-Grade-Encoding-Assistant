import { Trash2, X } from 'lucide-react';
import { useEffect } from 'react';
import { useStore } from '../app/store';
import { Button } from './ui/button';

const SHOW_MS = 10000;

/** "Moved to Trash · Undo" toast, shown right after a class is trashed. Rendered once in App. */
export function TrashNotice() {
  const notice = useStore((s) => s.trashNotice);
  const { restoreClassFromTrash, dismissTrashNotice } = useStore();
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismissTrashNotice, SHOW_MS);
    return () => clearTimeout(timer);
  }, [notice, dismissTrashNotice]);
  if (!notice) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-md bg-slate-800 px-3 py-2 text-sm text-white shadow-lg">
      <Trash2 className="size-4 shrink-0 text-slate-300" />
      <span className="min-w-0 truncate">{notice.label} moved to Trash.</span>
      <Button size="sm" variant="outline" className="h-7 border-white/30 bg-transparent px-2 text-xs text-white hover:bg-white/10 hover:text-white" onClick={() => restoreClassFromTrash(notice.id)}>
        Undo
      </Button>
      <button type="button" onClick={dismissTrashNotice} aria-label="Dismiss" className="text-slate-300 hover:text-white">
        <X className="size-4" />
      </button>
    </div>
  );
}
