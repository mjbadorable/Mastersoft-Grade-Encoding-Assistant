import { useStore } from '../app/store';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';

/** Data Privacy Notice (blueprint §9, D27). "Continue" only, no consent checkbox. */
export function PrivacyNotice({ open, onContinue, firstLaunch }: { open: boolean; onContinue: () => void; firstLaunch: boolean }) {
  const block = (e: Event) => firstLaunch && e.preventDefault();
  const storageKept = useStore((s) => s.storageKept);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !firstLaunch && onContinue()}>
      <DialogContent
        title="DATA PRIVACY NOTICE"
        hideClose={firstLaunch}
        onEscapeKeyDown={block}
        onPointerDownOutside={block}
        onInteractOutside={block}
      >
        <div className="space-y-3 text-sm leading-relaxed text-slate-700">
          <p>
            This app helps you preview how Mastersoft will compute your students' grades. It is a personal project and{' '}
            <strong>not an official system of the University of San Agustin</strong>.
          </p>
          <p>
            <strong>Your data stays on this computer.</strong> Student names, IDs and scores are processed and saved only in
            this browser (IndexedDB). The app has no server and no login, and it does not upload, collect or share any data.
            After your first visit it also works without internet.
          </p>
          <p>
            <strong>Keep your own backup.</strong> Your classes exist only in this browser on this computer. They are lost if
            you clear this browser's data (history, cookies and site data), work in a private or incognito window, or lose
            or reset the computer, and they don't appear in another browser or on another computer. Download a{' '}
            <strong>Backup</strong> of each class regularly, especially before encoding.
          </p>
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs" role="note">
            {storageKept === true &&
              'This browser has agreed to keep your saved classes even when the disk is low on space. Clearing browser data yourself still deletes them.'}
            {storageKept === false &&
              "This browser hasn't agreed to keep your saved classes permanently, so it may delete them if the computer runs low on disk space. Browsers decide this on their own (using the app often, bookmarking it or installing it can help). A backup file is the only copy you control."}
            {storageKept === null &&
              "Your classes are saved in this browser. Browsers can delete saved site data when the disk is low on space or when you clear browsing data, so keep a backup file."}
          </p>
          <p>
            <strong>You remain responsible for the data you enter.</strong> Student records are personal information under{' '}
            <strong>Republic Act No. 10173 (Data Privacy Act of 2012)</strong>. Please:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>use the app only on a computer you trust;</li>
            <li>store exported files (PDF, Excel, backup) securely and delete them when you no longer need them;</li>
            <li>clear the app's saved data if you use a shared computer.</li>
          </ul>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={onContinue} autoFocus>
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
