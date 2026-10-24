import { RefreshCw, WifiOff } from 'lucide-react';
import { applyUpdate, useOffline } from '../app/offline';

/** Header indicators: working offline, and a new version ready to load. */
export function OfflineIndicator() {
  const { online, ready, update } = useOffline();
  return (
    <>
      {!online && (
        <span
          className="flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 text-xs"
          role="status"
          title={
            ready
              ? 'No internet. You can keep working: changes are saved in this browser.'
              : "No internet. Changes are saved in this browser, but don't reload: the app isn't saved for offline use yet."
          }
        >
          <WifiOff className="size-3.5" /> Offline
        </span>
      )}
      {update && (
        <button
          onClick={applyUpdate}
          className="flex items-center gap-1 rounded bg-white px-2 py-0.5 text-xs font-semibold text-brand"
          title="A new version of the app is ready. Your saved classes are kept."
        >
          <RefreshCw className="size-3.5" /> Update ready · Reload
        </button>
      )}
    </>
  );
}
