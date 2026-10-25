import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { TERM_LABEL } from '../app/labels';
import {
  buildMastersoftFile,
  exportFileName,
  MastersoftFileError,
  parseMastersoftFile,
  planExport,
  tidy,
  type MastersoftFile,
  type MergeResult,
} from '../app/mastersoftFile';
import { useActiveClass, useStore } from '../app/store';
import type { ClassRecord, Component } from '../app/types';
import type { Term } from '../engine';
import { downloadFile, XLSX_TYPE } from '../lib/download';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';
import { Input, Label } from './ui/input';

const COMPONENT_LABEL: Record<Component, string> = { CS: 'Class Standing', WE: 'Written Exam' };

/** Import the student list from a Mastersoft "Upload Grade Encoding" file (D34). */
export function MastersoftImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Import from Mastersoft"
        description='Use any file from Grade Encoding → Upload Grade Encoding → Download Template. All six files list the same students.'
        className="sm:w-[36rem]"
      >
        {open && <ImportForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const active = useActiveClass();
  const importMastersoft = useStore((s) => s.importMastersoft);
  const [file, setFile] = useState<{ name: string; parsed: MastersoftFile } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<'new' | 'active'>('new');
  const [result, setResult] = useState<MergeResult | null>(null);

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    setFile(null);
    try {
      const parsed = parseMastersoftFile(await f.arrayBuffer(), f.name);
      setFile({ name: f.name, parsed });
      // Update the open class when it already has some of these students.
      const ids = new Set(parsed.rows.map((r) => tidy(r.studentId)));
      setTarget(active?.students.some((s) => ids.has(tidy(s.studentId))) ? 'active' : 'new');
    } catch (err) {
      if (err instanceof MastersoftFileError) setError(err.message);
      else throw err;
    }
  };

  if (result) {
    return (
      <div className="space-y-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-emerald-700">
          <CheckCircle2 className="size-4" /> Student list imported in Mastersoft's order.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-slate-700">
          <li>{result.added} student(s) added</li>
          {result.matched > 0 && <li>{result.matched} student(s) already in the class were matched by Student ID; their scores are kept</li>}
          {result.notInFile.length > 0 && (
            <li className="text-amber-800">
              {result.notInFile.length} student(s) in the class are not in this file and were moved to the end. They won't be in the export:{' '}
              {result.notInFile.map((s) => s.name || s.studentId).join(', ')}
            </li>
          )}
        </ul>
        <div className="flex justify-end">
          <Button onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  const first = file?.parsed.rows[0];
  return (
    <div className="space-y-4 text-sm">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed border-slate-300 px-4 py-6 text-center hover:border-brand hover:bg-brand/5">
        <FileSpreadsheet className="size-6 text-slate-400" />
        <span className="font-medium text-slate-700">{file ? file.name : 'Choose a Mastersoft .xlsx file'}</span>
        <span className="text-xs text-slate-500">The file is read in this browser only. Nothing is uploaded.</span>
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => void choose(e)} />
      </label>

      {error && (
        <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}

      {file && first && (
        <>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 rounded-md bg-slate-50 px-3 py-2">
            <dt className="text-slate-500">Subject</dt>
            <dd>
              {file.parsed.subjectCode && `${file.parsed.subjectCode} – `}
              {tidy(first.subject)}
            </dd>
            <dt className="text-slate-500">Section</dt>
            <dd>
              {tidy(first.section)} · {tidy(first.campus)} · {tidy(first.semester)}
            </dd>
            {file.parsed.session && (
              <>
                <dt className="text-slate-500">Session</dt>
                <dd>{file.parsed.session}</dd>
              </>
            )}
            <dt className="text-slate-500">Students</dt>
            <dd>
              {file.parsed.rows.length}, first: {file.parsed.rows.slice(0, 3).map((r) => tidy(r.studentName)).join('; ')}…
            </dd>
          </dl>
          {file.parsed.hasMarks && (
            <p className="text-xs text-slate-500">This file already has marks. Only the student list is imported; enter scores in the gradebook columns.</p>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-slate-600">Import into</legend>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-300 px-3 py-2 has-checked:border-brand has-checked:bg-brand/5">
              <input type="radio" className="mt-1 accent-brand" checked={target === 'new'} onChange={() => setTarget('new')} />
              <span>
                <span className="font-medium">A new class</span>
                <span className="block text-xs text-slate-500">Subject, section and Lecture/Lab are filled in from the file.</span>
              </span>
            </label>
            {active && (
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-300 px-3 py-2 has-checked:border-brand has-checked:bg-brand/5">
                <input type="radio" className="mt-1 accent-brand" checked={target === 'active'} onChange={() => setTarget('active')} />
                <span>
                  <span className="font-medium">
                    {active.subjectCode || 'The open class'} {active.section && `· ${active.section}`}
                  </span>
                  <span className="block text-xs text-slate-500">
                    Students are matched by Student ID (typed scores are kept) and put in the file's order.
                  </span>
                </span>
              </label>
            )}
          </fieldset>
          <div className="flex justify-end">
            <Button onClick={() => setResult(importMastersoft(file.parsed, target))}>Import {file.parsed.rows.length} students</Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Download the Class Standing and Written Exam upload files for one term (D34). */
export function MastersoftExportDialog({ record, term, open, onOpenChange }: { record: ClassRecord; term: Term; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Export ${TERM_LABEL[term]} for Mastersoft`}
        description="Upload each file in Grade Encoding → Upload Grade Encoding, on the matching row."
        className="sm:w-[40rem]"
      >
        {open && (
          <div className="space-y-4">
            <ExportCard record={record} term={term} component="CS" />
            <ExportCard record={record} term={term} component="WE" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExportCard({ record, term, component }: { record: ClassRecord; term: Term; component: Component }) {
  const plan = planExport(record, term, component);
  const [outOf, setOutOf] = useState(plan.total === null ? '' : String(plan.total));
  const outOfMatches = plan.total !== null && outOf.trim() !== '' && Number(outOf) === plan.total;
  const canDownload = plan.blockers.length === 0 && outOfMatches;
  const title = `${TERM_LABEL[term]} – ${COMPONENT_LABEL[component]}`;

  const download = () => downloadFile(buildMastersoftFile(plan.rows) as BlobPart, exportFileName(record, term, component), XLSX_TYPE);

  return (
    <section className="rounded-md border border-slate-200 p-4 text-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-xs text-slate-500">
            {plan.rows.length} student(s) · app Total Marks <span className="tabular font-medium">{plan.total ?? '—'}</span>
          </p>
        </div>
        <Label className="w-44">
          “Marks Out of” in Mastersoft
          <Input
            value={outOf}
            onChange={(e) => setOutOf(e.target.value)}
            inputMode="decimal"
            className="tabular h-8"
            aria-invalid={!outOfMatches}
            aria-label={`Marks Out of in Mastersoft for ${title}`}
          />
        </Label>
      </div>

      {plan.blockers.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {plan.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {plan.total !== null && !outOfMatches && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Mastersoft computes the grade from the marks and its own “Marks Out of”. They must equal the app's Total Marks ({plan.total}), or every grade
          will be wrong. Change “Marks Out of” for {title} in Mastersoft to {plan.total}, or change the columns here.
        </p>
      )}
      {(plan.statusStudents.length > 0 || plan.notInFile.length > 0 || plan.decimalMarks.length > 0) && (
        <ul className="mt-3 space-y-1 text-xs text-amber-900">
          {plan.statusStudents.length > 0 && (
            <li>
              <Badge variant="amber" className="mr-1">
                Blank
              </Badge>
              Marks left blank; set the status on the Grade Encoding screen: {plan.statusStudents.join(', ')}
            </li>
          )}
          {plan.notInFile.length > 0 && (
            <li>
              <Badge variant="amber" className="mr-1">
                Left out
              </Badge>
              Not in the Mastersoft list: {plan.notInFile.join(', ')}
            </li>
          )}
          {plan.decimalMarks.length > 0 && (
            <li>
              <Badge variant="amber" className="mr-1">
                Decimals
              </Badge>
              Mastersoft may only accept whole-number marks: {plan.decimalMarks.join(', ')}
            </li>
          )}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="truncate text-xs text-slate-400">{exportFileName(record, term, component)}</span>
        <Button size="sm" disabled={!canDownload} onClick={download}>
          <Download /> Download
        </Button>
      </div>
    </section>
  );
}
