import { AlertTriangle, Check, LoaderCircle, RotateCw } from 'lucide-react';
import { useStore } from '../app/store';
import { Button } from './ui/button';

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Header indicator: every change is confirmed as saved, or reported if it failed (TC-026/027). */
export function SaveIndicator() {
  const { saveStatus, retrySave } = useStore();
  switch (saveStatus.state) {
    case 'idle':
      return null;
    case 'saving':
      return (
        <span className="flex items-center gap-1 text-xs text-white/85" role="status">
          <LoaderCircle className="size-3.5 animate-spin" /> Saving…
        </span>
      );
    case 'saved':
      return (
        <span className="flex items-center gap-1 text-xs text-white/85" role="status" title={`Saved in this browser at ${new Date(saveStatus.at).toLocaleString()}`}>
          <Check className="size-3.5" /> Saved {time(saveStatus.at)}
        </span>
      );
    case 'error':
      return (
        <button onClick={retrySave} className="flex items-center gap-1 rounded bg-white px-2 py-0.5 text-xs font-semibold text-brand" role="alert">
          <AlertTriangle className="size-3.5" /> Not saved · Retry
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
