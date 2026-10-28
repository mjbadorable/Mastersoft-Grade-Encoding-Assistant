import { FileDown, Printer } from 'lucide-react';
import { createPortal } from 'react-dom';
import { buildReverseGuide, reverseGuideCells, reverseGuideFileName, reverseGuideHeaders, reverseGuideWorkbook, type ReverseGuide } from '../app/encodingGuide';
import type { ClassRecord } from '../app/types';
import { downloadFile, XLSX_TYPE } from '../lib/download';
import { cn } from '../lib/utils';
import { usePrinting } from './EncodingGuide';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';

/** Encoding Guide for Final Rating Only mode: one set of marks for all three terms. */
export function ReverseGuideDialog({ record, open, onOpenChange }: { record: ClassRecord; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [printing, setPrinting] = usePrinting();
  const guide = open ? buildReverseGuide(record) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {guide && (
        <DialogContent
          title="Final Rating Only Encoding Guide"
          description="Print it, save it as PDF from the print dialog, or download it as Excel."
          className="w-[min(64rem,calc(100vw-2rem))]"
        >
          <div className="mb-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => downloadFile(reverseGuideWorkbook(guide) as BlobPart, reverseGuideFileName(record, 'xlsx'), XLSX_TYPE)}>
              <FileDown /> Download .xlsx
            </Button>
            <Button onClick={() => setPrinting(true)}>
              <Printer /> Print / Save as PDF
            </Button>
          </div>
          <ReverseGuideView guide={guide} />
          {printing &&
            createPortal(
              <div className="print-root" data-testid="print-root">
                <ReverseGuideView guide={guide} print />
              </div>,
              document.body,
            )}
        </DialogContent>
      )}
    </Dialog>
  );
}

export function ReverseGuideView({ guide, print }: { guide: ReverseGuide; print?: boolean }) {
  return (
    <article className={cn('text-sm text-slate-900', print && 'text-[11px]')}>
      <header className="mb-3 border-b-2 border-brand pb-2">
        <h1 className="text-lg font-semibold">{guide.title}</h1>
        <p className="text-slate-600">{guide.classLine}</p>
      </header>

      <section className="mb-4">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Mastersoft Assessment Component</h2>
        <div className="flex gap-3">
          {['Class Standing', 'Written Exam'].map((label) => (
            <div key={label} className="rounded border border-slate-300 px-3 py-1.5">
              <div className="text-xs text-slate-500">Prelim, Midterm and Final – {label} · Total Marks</div>
              <div className="tabular text-xl font-semibold">{guide.total}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-600">Encode the same CS and WE marks in each term.</p>
      </section>

      <table className="tabular w-full border-collapse text-left">
        <thead>
          <tr className="bg-slate-100 text-xs">
            {reverseGuideHeaders(guide).map((h, i) => (
              <th key={h} className={cn('border border-slate-300 px-2 py-1 font-semibold', i >= 3 && i <= 7 && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {guide.rows.map((row) => (
            <tr key={row.no} className="break-inside-avoid">
              {reverseGuideCells(row).map((v, i) => (
                <td
                  key={i}
                  className={cn(
                    'border border-slate-300 px-2 py-0.5',
                    i >= 3 && i <= 7 && 'text-right font-medium',
                    i === 8 && 'text-xs',
                    i === 8 && row.notes.some((n) => n.startsWith('Unverified')) && 'bg-amber-50 text-amber-900',
                    i === 8 && row.problem && 'text-red-700',
                  )}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[10px] text-slate-500">
        Predicted by the Mastersoft Grade Encoding Assistant (not an official University system). The marks are solved backwards from each target and checked
        by running them forward through the same engine.
      </p>
    </article>
  );
}
