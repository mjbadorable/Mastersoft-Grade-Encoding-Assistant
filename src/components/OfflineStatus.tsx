import { RefreshCw, WifiOff } from 'lucide-react';
import { applyUpdate, useOffline } from '../app/offline';

/** Sidebar indicators: working offline, and a new version ready to load. `compact` shows icons only (collapsed sidebar). */
export function OfflineIndicator({ compact = false }: { compact?: boolean }) {
  const { online, ready, update } = useOffline();
  return (
    <>
      {!online && (
        <span
          className={compact ? 'flex size-9 items-center justify-center rounded-md bg-slate-100 text-slate-600' : 'flex items-center gap-1 whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700'}
          role="status"
          title={
            ready
              ? 'No internet. You can keep working: changes are saved in this browser.'
              : "No internet. Changes are saved in this browser, but don't reload: the app isn't saved for offline use yet."
          }
        >
          <WifiOff className="size-3.5" /> {!compact && 'Offline'}
        </span>
      )}
      {update && (
        <button
          onClick={applyUpdate}
          aria-label="Update ready: reload"
          className={compact ? 'flex size-9 items-center justify-center rounded-md bg-brand text-white' : 'flex items-center gap-1 whitespace-nowrap rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-brand-dark'}
          title="A new version of the app is ready. Your saved classes are kept."
        >
          <RefreshCw className="size-3.5" /> {!compact && 'Update ready · Reload'}
        </button>
      )}
    </>
  );
}
