import { AlertTriangle, CheckCircle2, FileSpreadsheet, Save } from 'lucide-react';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { getMeta, setMeta } from '../app/db';
import {
  applyMapping,
  cellText,
  columnLetter,
  ExcelImportError,
  fromTemplate,
  readWorkbook,
  suggestMapping,
  toTemplate,
  type ImportMapping,
  type ImportTemplate,
  type MergeScoresResult,
  type Workbook,
} from '../app/excelImport';
import { TERM_LABEL } from '../app/labels';
import { useStore } from '../app/store';
import type { Component } from '../app/types';
import type { Term } from '../engine';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';
import { Input, Label, Select } from './ui/input';

const TEMPLATES_KEY = 'importTemplates';

/** Smart Excel import (D7): sheet → name/ID columns → CS/WE columns and max scores. */
export function ExcelImportDialog({ term, open, onOpenChange }: { term: Term; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Import ${TERM_LABEL[term]} scores from Excel`}
        description="Read your own class record. Nothing is uploaded; the file is read in this browser."
        className="w-[min(72rem,calc(100vw-2rem))]"
      >
        {open && <ImportFlow term={term} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ImportFlow({ term, onDone }: { term: Term; onDone: () => void }) {
  const importScores = useStore((s) => s.importScores);
  const [book, setBook] = useState<{ name: string; wb: Workbook } | null>(null);
  const [sheet, setSheet] = useState('');
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ImportTemplate[]>([]);
  const [templateNote, setTemplateNote] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [result, setResult] = useState<MergeScoresResult | null>(null);

  useEffect(() => {
    void getMeta<ImportTemplate[]>(TEMPLATES_KEY).then((t) => setTemplates(t ?? []));
  }, []);

  const grid = useMemo(() => (book && sheet ? book.wb.grid(sheet) : []), [book, sheet]);
  const preview = useMemo(() => (mapping ? applyMapping(grid, mapping) : null), [grid, mapping]);

  const pickSheet = (wb: Workbook, name: string) => {
    setSheet(name);
    setMapping(suggestMapping(wb.grid(name)));
    setTemplateNote(null);
  };

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    try {
      const wb = readWorkbook(await f.arrayBuffer());
      setBook({ name: f.name, wb });
      // Start on the sheet named after this term when there is one.
      const named = wb.sheetNames.find((n) => n.toLowerCase().replace(/\s/g, '').includes(TERM_LABEL[term].toLowerCase()));
      pickSheet(wb, named ?? wb.sheetNames[0]!);
    } catch (err) {
      if (err instanceof ExcelImportError) setError(err.message);
      else throw err;
    }
  };

  const applyTemplate = (name: string) => {
    const t = templates.find((x) => x.name === name);
    if (!t) return;
    const { mapping: m, missing } = fromTemplate(grid, t);
    setMapping(m);
    setTemplateNote(missing.length ? `Template "${t.name}": these headers weren't found in this sheet: ${missing.join(', ')}.` : `Template "${t.name}" applied.`);
  };

  const saveTemplate = () => {
    if (!mapping || !templateName.trim()) return;
    const t = toTemplate(templateName.trim(), grid, mapping);
    const next = [...templates.filter((x) => x.name !== t.name), t];
    setTemplates(next);
    void setMeta(TEMPLATES_KEY, next);
    setTemplateNote(`Saved template "${t.name}".`);
    setTemplateName('');
  };

  if (result) {
    return (
      <div className="space-y-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-emerald-700">
          <CheckCircle2 className="size-4" /> Scores imported into the {TERM_LABEL[term]} gradebook.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-slate-700">
          <li>{result.matched} student(s) matched by Student ID or name</li>
          <li>{result.added} student(s) added</li>
          <li>{result.columnsAdded} column(s) added; columns with the same name were updated</li>
        </ul>
        <p className="text-xs text-slate-500">Blank or invalid cells stay highlighted in the grid until you fix them.</p>
        <div className="flex justify-end">
          <Button onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  const headers = (grid[mapping?.headerRow ?? 0] ?? []).map(cellText);
  const colOptions = headers.map((h, i) => ({ i, label: `${columnLetter(i)}${h ? ` – ${h}` : ''}` })).filter((o) => headers[o.i] !== '');
  const candidates = colOptions.filter((o) => o.i !== mapping?.idCol && o.i !== mapping?.nameCol);
  const issueAt = new Map(preview?.issues.map((i) => [`${i.row}:${i.col}`, i]));
  const counts = { blank: 0, bad: 0 };
  preview?.issues.forEach((i) => (i.kind === 'blank' ? counts.blank++ : counts.bad++));

  const update = (patch: Partial<ImportMapping>) => mapping && setMapping({ ...mapping, ...patch });
  const setColumn = (col: number, patch: { include?: boolean; component?: Component; maxScore?: number }) => {
    if (!mapping) return;
    const existing = mapping.columns.find((c) => c.col === col);
    let columns = mapping.columns;
    if (patch.include === false) columns = columns.filter((c) => c.col !== col);
    else if (!existing) columns = [...columns, { col, header: headers[col] ?? '', component: patch.component ?? 'CS', maxScore: patch.maxScore ?? 0 }].sort((a, b) => a.col - b.col);
    else columns = columns.map((c) => (c.col === col ? { ...c, ...patch } : c));
    setMapping({ ...mapping, columns });
  };
  const rowOptions = Array.from({ length: Math.min(grid.length, 30) }, (_, r) => r);

  return (
    <div className="space-y-4 text-sm">
      <label className="flex cursor-pointer items-center gap-3 rounded-md border-2 border-dashed border-slate-300 px-4 py-3 hover:border-brand hover:bg-brand/5">
        <FileSpreadsheet className="size-5 text-slate-400" />
        <span className="font-medium text-slate-700">{book ? book.name : 'Choose your class record (.xlsx, .xls or .csv)'}</span>
        <input type="file" accept=".xlsx,.xls,.xlsm,.csv" className="sr-only" onChange={(e) => void choose(e)} />
      </label>
      {error && (
        <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}

      {book && mapping && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Label>
              1. Sheet
              <Select value={sheet} onChange={(e) => pickSheet(book.wb, e.target.value)}>
                {book.wb.sheetNames.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
            </Label>
            <Label>
              2. Header row
              <Select value={mapping.headerRow} onChange={(e) => update({ headerRow: Number(e.target.value), columns: [] })}>
                {rowOptions.map((r) => (
                  <option key={r} value={r}>
                    Row {r + 1}: {(grid[r] ?? []).map(cellText).filter(Boolean).slice(0, 3).join(', ').slice(0, 40)}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Highest possible scores row
              <Select value={mapping.maxRow ?? ''} onChange={(e) => update({ maxRow: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">None</option>
                {rowOptions
                  .filter((r) => r > mapping.headerRow)
                  .map((r) => (
                    <option key={r} value={r}>
                      Row {r + 1}
                    </option>
                  ))}
              </Select>
            </Label>
            <Label>
              3. Student name column
              <Select value={mapping.nameCol ?? ''} onChange={(e) => update({ nameCol: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">Choose…</option>
                {colOptions.map((o) => (
                  <option key={o.i} value={o.i}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Student ID column
              <Select value={mapping.idCol ?? ''} onChange={(e) => update({ idCol: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">None</option>
                {colOptions.map((o) => (
                  <option key={o.i} value={o.i}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Label>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            {templates.length > 0 && (
              <Label>
                Use a saved template
                <Select value="" onChange={(e) => applyTemplate(e.target.value)}>
                  <option value="">Choose…</option>
                  {templates.map((t) => (
                    <option key={t.name}>{t.name}</option>
                  ))}
                </Select>
              </Label>
            )}
            <Label className="ml-auto">
              Save this mapping as a template
              <div className="flex gap-2">
                <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. My class record" className="h-9 w-52" />
                <Button variant="outline" onClick={saveTemplate} disabled={!templateName.trim()}>
                  <Save /> Save
                </Button>
              </div>
            </Label>
          </div>
          {templateNote && <p className="text-xs text-slate-600">{templateNote}</p>}

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">4. Score columns</h3>
            <p className="mb-2 text-xs text-slate-500">Tick the raw score columns only (not totals or computed grades), tag each as CS or WE, and check its maximum score.</p>
            <div className="max-h-56 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs text-slate-600">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Import</th>
                    <th className="px-2 py-1.5 text-left">Column</th>
                    <th className="px-2 py-1.5 text-left">Component</th>
                    <th className="px-2 py-1.5 text-left">Max score</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((o) => {
                    const m = mapping.columns.find((c) => c.col === o.i);
                    return (
                      <tr key={o.i} className={cn('border-t border-slate-100', !m && 'text-slate-400')}>
                        <td className="px-2 py-1">
                          <input type="checkbox" className="accent-brand" checked={!!m} onChange={(e) => setColumn(o.i, { include: e.target.checked })} aria-label={`Import ${o.label}`} />
                        </td>
                        <td className="px-2 py-1">{o.label}</td>
                        <td className="px-2 py-1">
                          <Select className="h-8" disabled={!m} value={m?.component ?? 'CS'} onChange={(e) => setColumn(o.i, { component: e.target.value as Component })} aria-label={`Component for ${o.label}`}>
                            <option value="CS">Class Standing</option>
                            <option value="WE">Written Exam</option>
                          </Select>
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            className={cn('tabular h-8 w-24', m && !(m.maxScore > 0) && 'border-red-500')}
                            disabled={!m}
                            inputMode="decimal"
                            value={m ? (m.maxScore || '') : ''}
                            onChange={(e) => setColumn(o.i, { maxScore: Number(e.target.value) })}
                            aria-label={`Max score for ${o.label}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {preview && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">5. Check</h3>
              {preview.setupIssues.length > 0 ? (
                <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {preview.setupIssues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              ) : (
                <>
                  <p className="mb-2 text-xs text-slate-600">
                    {preview.rows.length} students.{' '}
                    {counts.bad > 0 && <span className="font-medium text-red-700">{counts.bad} invalid cell(s) (red). </span>}
                    {counts.blank > 0 && <span className="font-medium text-amber-800">{counts.blank} blank cell(s) (amber). </span>}
                    {counts.bad + counts.blank > 0 ? 'They are imported as-is and stay highlighted in the grid.' : 'No problems found.'}
                  </p>
                  <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
                    <table className="tabular w-full text-xs">
                      <thead className="sticky top-0 bg-slate-100 text-slate-600">
                        <tr>
                          <th className="px-2 py-1 text-left">Row</th>
                          <th className="px-2 py-1 text-left">ID</th>
                          <th className="px-2 py-1 text-left">Name</th>
                          {mapping.columns.map((c) => (
                            <th key={c.col} className="px-2 py-1 text-right">
                              {c.header} <span className="font-normal text-slate-400">{c.component} /{c.maxScore}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((r) => (
                          <tr key={r.row} className="border-t border-slate-100">
                            <td className="px-2 py-1 text-slate-400">{r.row + 1}</td>
                            <td className="px-2 py-1">{r.studentId}</td>
                            <td className="px-2 py-1">{r.name}</td>
                            {mapping.columns.map((c, i) => {
                              const issue = issueAt.get(`${r.row}:${c.col}`);
                              return (
                                <td
                                  key={c.col}
                                  title={issue?.message}
                                  className={cn(
                                    'px-2 py-1 text-right',
                                    issue?.kind === 'blank' && 'bg-amber-50 ring-1 ring-inset ring-amber-300',
                                    issue && issue.kind !== 'blank' && 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-400',
                                  )}
                                >
                                  {r.scores[i] || '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}

          <div className="flex items-center justify-end gap-3">
            <span className="text-xs text-slate-500">Students are matched by Student ID, then by name. Existing scores in the same columns are replaced.</span>
            <Button disabled={!preview || preview.setupIssues.length > 0} onClick={() => preview && setResult(importScores(term, mapping, preview.rows))}>
              Import into {TERM_LABEL[term]}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
