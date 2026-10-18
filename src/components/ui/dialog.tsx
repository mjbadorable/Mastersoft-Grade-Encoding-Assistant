import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

interface ContentProps extends Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** 'sheet' slides in from the right (breakdown drawer). */
  side?: 'center' | 'sheet';
  hideClose?: boolean;
}

export function DialogContent({ title, description, side = 'center', hideClose, className, children, ...props }: ContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col bg-white shadow-xl focus:outline-none',
          side === 'center'
            ? 'left-1/2 top-1/2 max-h-[90vh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg'
            : 'inset-y-0 right-0 w-[min(30rem,100vw)] border-l border-slate-200',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <DialogPrimitive.Title className="text-base font-semibold text-slate-900">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-sm text-slate-500">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          {!hideClose && (
            <DialogPrimitive.Close className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
              <X className="size-4" />
            </DialogPrimitive.Close>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
