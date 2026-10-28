import { Fragment } from 'react';
import { Dialog, DialogContent } from './ui/dialog';

const GROUPS: { title: string; items: { keys: string[][]; action: string }[] }[] = [
  {
    title: 'Grid navigation',
    items: [
      { keys: [['Enter']], action: 'Next row (adds a student on the last row)' },
      { keys: [['Shift', 'Enter']], action: 'Previous row' },
      { keys: [['↑'], ['↓'], ['←'], ['→']], action: 'Move between cells' },
      { keys: [['Tab']], action: 'Next column' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: [['Ctrl', 'Z']], action: 'Undo' },
      { keys: [['Ctrl', 'Y'], ['Ctrl', 'Shift', 'Z']], action: 'Redo' },
      { keys: [['Ctrl', 'V']], action: 'Paste a block copied from Excel' },
    ],
  },
  {
    title: 'Search & view',
    items: [
      { keys: [['Ctrl', 'F']], action: 'Find a student in the grid' },
      { keys: [['[']], action: 'Collapse or expand the sidebar' },
      { keys: [['?']], action: 'Show this list' },
    ],
  },
  {
    title: 'Grade breakdown',
    items: [{ keys: [['Click any grade cell']], action: 'Open the step-by-step calculation' }],
  },
];

export const kbdClass = 'rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 shadow-sm';

/** Cheat-sheet of the grid's keyboard shortcuts, opened with "?" or from the status bar. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" description="On a Mac, use ⌘ in place of Ctrl.">
        <div className="space-y-5">
          {GROUPS.map((g) => (
            <section key={g.title} aria-labelledby={`sc-${g.title}`}>
              <h3 id={`sc-${g.title}`} className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {g.title}
              </h3>
              <ul className="divide-y divide-slate-100 text-sm">
                {g.items.map((item) => (
                  <li key={item.action} className="flex items-center justify-between gap-4 py-1.5">
                    <span className="text-slate-700">{item.action}</span>
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
                      {item.keys.map((combo, i) => (
                        <Fragment key={combo.join('+')}>
                          {i > 0 && <span className="text-xs text-slate-400">or</span>}
                          <span className="flex items-center gap-0.5">
                            {combo.map((k, j) => (
                              <Fragment key={k}>
                                {j > 0 && <span className="text-xs text-slate-400">+</span>}
                                <kbd className={kbdClass}>{k}</kbd>
                              </Fragment>
                            ))}
                          </span>
                        </Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
