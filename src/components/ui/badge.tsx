import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

const badgeVariants = cva('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none', {
  variants: {
    variant: {
      neutral: 'bg-slate-100 text-slate-700',
      amber: 'bg-amber-100 text-amber-800 ring-1 ring-amber-300',
      green: 'bg-emerald-100 text-emerald-800',
      red: 'bg-red-100 text-red-700',
      brand: 'bg-brand/10 text-brand',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
