// In-app confirmation for destructive actions. The browser's own window.confirm is
// blocked or auto-cancelled in some embedded browsers, which made "Delete class" do nothing.
import { AlertTriangle } from 'lucide-react';
import { create } from 'zustand';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ request: ConfirmRequest | null }>()(() => ({ request: null }));

/** Asks the teacher to confirm; resolves true only when they press the confirm button. */
export function confirmAction(options: { title: string; message: string; confirmLabel: string }): Promise<boolean> {
  useConfirmStore.getState().request?.resolve(false);
  return new Promise((resolve) => useConfirmStore.setState({ request: { ...options, resolve } }));
}

/** Rendered once in App. */
export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  const close = (ok: boolean) => {
    request?.resolve(ok);
    useConfirmStore.setState({ request: null });
  };
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && close(false)}>
      {request && (
        <DialogContent title={request.title} role="alertdialog" className="w-[min(28rem,calc(100vw-2rem))]">
          <p className="flex items-start gap-2 text-sm text-slate-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" />
            {request.message}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => close(false)} autoFocus>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => close(true)}>
              {request.confirmLabel}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
