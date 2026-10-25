// Offline support: registers the service worker (src/sw.js) in the built app and reports
// whether the browser is online and whether a new version is waiting to be loaded.
import { create } from 'zustand';

interface OfflineState {
  online: boolean;
  /** The app's files are saved in this browser, so it opens without internet. */
  ready: boolean;
  /** A new version is downloaded and waits for the teacher to reload. */
  update: ServiceWorker | null;
}

export const useOffline = create<OfflineState>()(() => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  ready: false,
  update: null,
}));

let reloading = false;

/** Switches to the waiting version and reloads (the save guard in store.ts still applies). */
export function applyUpdate() {
  const update = useOffline.getState().update;
  if (!update) return;
  reloading = true;
  update.postMessage('SKIP_WAITING');
}

export function registerOffline() {
  window.addEventListener('online', () => useOffline.setState({ online: true }));
  window.addEventListener('offline', () => useOffline.setState({ online: false }));
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) window.location.reload();
  });
  window.addEventListener('load', () => void setUp());
  async function setUp() {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      // A worker that finishes installing while another one controls this tab is an update.
      const watch = (sw: ServiceWorker | null) => {
        if (!sw) return;
        const check = () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) useOffline.setState({ update: sw });
        };
        sw.addEventListener('statechange', check);
        check();
      };
      watch(reg.waiting);
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      void navigator.serviceWorker.ready.then(() => useOffline.setState({ ready: true }));
      // Teachers keep the tab open for days: look for a new version when they come back to it.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {});
      });
    } catch (e) {
      // The app still works online; it just won't open without internet.
      console.error('Offline support could not be set up', e);
    }
  }
}
