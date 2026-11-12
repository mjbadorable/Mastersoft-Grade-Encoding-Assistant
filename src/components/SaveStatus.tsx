import { AlertTriangle, Check, LoaderCircle, RotateCw } from 'lucide-react';
import { useStore } from '../app/store';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * Save-state pill: every change is confirmed as saved, or reported if it failed (TC-026/027).
 * `compact` is a single icon (collapsed sidebar); `showIdle` shows a calm "Autosave on" before the first change.
 */
export function SaveIndicator({ compact = false, showIdle = false }: { compact?: boolean; showIdle?: boolean }) {
  const { saveStatus, retrySave } = useStore();
  const pill = compact ? 'flex size-9 items-center justify-center rounded-md' : 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium';
  switch (saveStatus.state) {
    case 'idle':
      return showIdle ? (
        <span className={cn(pill, 'bg-slate-100 text-slate-600')} role="status" title="Changes are saved in this browser as you type">
          <Check className="size-3.5" /> {!compact && 'Autosave on'}
        </span>
      ) : null;
    case 'saving':
      return (
        <span className={cn(pill, 'bg-amber-50 text-amber-800')} role="status" title="Saving…">
          <LoaderCircle className="size-3.5 animate-spin" /> {!compact && 'Saving…'}
        </span>
      );
    case 'saved':
      return (
        <span className={cn(pill, 'bg-emerald-50 text-emerald-800')} role="status" title={`Autosaved in this browser at ${new Date(saveStatus.at).toLocaleString()}`}>
          <Check className="size-3.5" />
          {!compact && (
            <>
              Autosaved <span className="font-normal text-emerald-700/80">· {time(saveStatus.at)}</span>
            </>
          )}
        </span>
      );
    case 'error':
      return (
        <button onClick={retrySave} title="Not saved. Click to retry." className={cn(pill, 'bg-red-50 font-semibold text-red-700 ring-1 ring-red-300 hover:bg-red-100')} role="alert">
          <AlertTriangle className="size-3.5" /> {!compact && 'Not saved · Retry'}
        </button>
      );
  }
}

/** Full-width warning under the header while changes are not saved. */
export function SaveErrorBanner() {
  const { saveStatus, retrySave, storageError } = useStore();
  if (storageError)
    return (
      <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
        <AlertTriangle className="size-4 shrink-0" />
        <span>{storageError}</span>
      </div>
    );
  if (saveStatus.state !== 'error') return null;
  return (
    <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
      <AlertTriangle className="size-4 shrink-0" />
      <span>
        {saveStatus.message} Don't close this tab. Try again, or download a backup to keep a copy.
      </span>
      <Button size="sm" variant="destructive" className="ml-auto" onClick={retrySave}>
        <RotateCw /> Try again
      </Button>
    </div>
  );
}
