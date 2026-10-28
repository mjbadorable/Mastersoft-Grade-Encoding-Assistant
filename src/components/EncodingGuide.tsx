import { FileDown, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildGuide, guideCells, guideFileName, guideHeaders, guideWorkbook, type Guide } from '../app/encodingGuide';
import { TERM_LABEL } from '../app/labels';
import type { ClassRecord } from '../app/types';
import type { Term } from '../engine';
import { downloadFile, XLSX_TYPE } from '../lib/download';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';

/** Opens the browser's print dialog once the print copy of a guide is on the page. */
export function usePrinting() {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    // Let the print copy render before the browser's print dialog opens.
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);
  return [printing, setPrinting] as const;
}

/** Encoding Guide per term (D13): preview, print / save as PDF, or download .xlsx. */
export function EncodingGuideDialog({ record, term, open, onOpenChange }: { record: ClassRecord; term: Term; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [printing, setPrinting] = usePrinting();
  const guide = open ? buildGuide(record, term) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {guide && (
        <DialogContent
          title={`${TERM_LABEL[term]} Encoding Guide`}
          description="Print it, save it as PDF from the print dialog, or download it as Excel."
          className="w-[min(64rem,calc(100vw-2rem))]"
        >
          <div className="mb-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => downloadFile(guideWorkbook(guide) as BlobPart, guideFileName(record, term, 'xlsx'), XLSX_TYPE)}>
              <FileDown /> Download .xlsx
            </Button>
            <Button onClick={() => setPrinting(true)}>
              <Printer /> Print / Save as PDF
            </Button>
          </div>
          <GuideView guide={guide} />
          {printing &&
            createPortal(
              <div className="print-root" data-testid="print-root">
                <GuideView guide={guide} print />
              </div>,
              document.body,
            )}
        </DialogContent>
      )}
    </Dialog>
  );
}

export function GuideView({ guide, print }: { guide: Guide; print?: boolean }) {
  const term = TERM_LABEL[guide.term];
  return (
    <article className={cn('text-sm text-slate-900', print && 'text-[11px]')}>
      <header className="mb-3 border-b-2 border-brand pb-2">
        <h1 className="text-lg font-semibold">{guide.title}</h1>
        <p className="text-slate-600">{guide.classLine}</p>
      </header>

      <section className="mb-4">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Mastersoft Assessment Component</h2>
        <div className="flex gap-3">
          {[
            ['Class Standing', guide.csTotal],
            ['Written Exam', guide.weTotal],
          ].map(([label, total]) => (
            <div key={label} className="rounded border border-slate-300 px-3 py-1.5">
              <div className="text-xs text-slate-500">
                {term} – {label} · Total Marks
              </div>
              <div className="tabular text-xl font-semibold">{total ?? '—'}</div>
            </div>
          ))}
        </div>
        {guide.setupIssues.length > 0 && (
          <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">Setup incomplete: {guide.setupIssues.join(' ')}</p>
        )}
      </section>

      <table className="tabular w-full border-collapse text-left">
        <thead>
          <tr className="bg-slate-100 text-xs">
            {guideHeaders(guide).map((h, i) => (
              <th key={h} className={cn('border border-slate-300 px-2 py-1 font-semibold', i >= 3 && i <= 6 && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {guide.rows.map((row) => {
            const cells = guideCells(row);
            return (
              <tr key={row.no} className="break-inside-avoid">
                {cells.map((v, i) => (
                  <td
                    key={i}
                    className={cn(
                      'border border-slate-300 px-2 py-0.5',
                      i >= 3 && i <= 6 && 'text-right font-medium',
                      row.status && i >= 3 && i <= 6 && 'font-semibold text-brand',
                      i === 7 && 'text-xs',
                      i === 7 && row.notes.some((n) => n.startsWith('Unverified')) && 'bg-amber-50 text-amber-900',
                      i === 7 && row.problem && 'text-red-700',
                    )}
                  >
                    {v}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[10px] text-slate-500">
        Predicted by the Mastersoft Grade Encoding Assistant (not an official University system). “Unverified” notes mark rules not yet confirmed against
        Mastersoft. Status flags are shown in place of marks and grades.
      </p>
    </article>
  );
}
