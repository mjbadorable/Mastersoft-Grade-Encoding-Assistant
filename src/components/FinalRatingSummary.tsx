import { Download } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { buildBatchZip, planAllTermsExport } from '../app/mastersoftFile';
import { downloadFile, ZIP_TYPE } from '../lib/download';
import { finalOutcome, formatPoint, termOutcome, type FinalOutcome } from '../app/gradebook';
import { TERM_LABEL, termWeightLabel } from '../app/labels';
import { useStore } from '../app/store';
import type { ClassRecord } from '../app/types';
import { rules, TERMS } from '../engine';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

type Filter = 'all' | 'passed' | 'failed' | 'attention';

/** Passed or failed on the Final Rating; everything else (a status, or a Final Rating not yet possible) needs a look. */
const resultOf = (o: FinalOutcome): Exclude<Filter, 'all'> => (o.kind !== 'rating' ? 'attention' : o.rating.grade >= rules.passingGrade ? 'passed' : 'failed');

function Kpi({ label, tone, children, note }: { label: string; tone?: 'green' | 'red' | 'amber'; children: ReactNode; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cn('tabular text-2xl font-semibold', tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900')}>{children}</div>
      {note && <div className="text-[11px] text-slate-400">{note}</div>}
    </div>
  );
}

export function FinalRatingSummary({ record }: { record: ClassRecord }) {
  const openDrawer = useStore((s) => s.openDrawer);
  const [filter, setFilter] = useState<Filter>('all');
  const batch = planAllTermsExport(record);
  const ready = batch.files.length;
  const blockedTitle = batch.blocked.map((b) => `${b.fileName}: ${b.reasons.join(' ')}`).join('\n');
  const rows = record.students.map((s, i) => ({ s, i, final: finalOutcome(record, s) }));
  const count = (f: Exclude<Filter, 'all'>) => rows.filter((r) => resultOf(r.final) === f).length;
  const shown = filter === 'all' ? rows : rows.filter((r) => resultOf(r.final) === filter);
  const allReady = batch.totalFiles > 0 && ready === batch.totalFiles;
  const th = 'border-b border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs font-semibold text-slate-600';
  const td = 'border-b border-slate-200 px-3 py-1.5';
  const pills: { id: Filter; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: rows.length },
    { id: 'passed', label: 'Passed', n: count('passed') },
    { id: 'failed', label: 'Failed', n: count('failed') },
    { id: 'attention', label: 'Needs Attention', n: count('attention') },
  ];
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div>
          <h2 className="text-base font-semibold">Final Rating summary</h2>
          <p className="text-xs text-slate-500">
            FR = {TERMS.map((t) => `${termWeightLabel(t)} ${TERM_LABEL[t]}`).join(' + ')}, rounded half-up, then the transcript point grade (below 75 = 5.0).
          </p>
        </div>
        <Button
          disabled={ready === 0}
          title={blockedTitle || 'Download Mastersoft upload files (.zip)'}
          onClick={() => downloadFile(buildBatchZip(batch) as BlobPart, batch.zipName, ZIP_TYPE)}
        >
          <Download /> {ready === batch.totalFiles ? `Download ${ready} files (.zip)` : `Download ${ready} ready files (.zip)`}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 pt-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Total Students">{rows.length}</Kpi>
        <Kpi label="Passed" tone="green">
          {count('passed')}
        </Kpi>
        <Kpi label="Failed" tone={count('failed') > 0 ? 'red' : undefined}>
          {count('failed')}
        </Kpi>
        <Kpi label="Incomplete / Status" tone={count('attention') > 0 ? 'amber' : undefined} note="No Final Rating yet, or INC, DRP, …">
          {count('attention')}
        </Kpi>
        <Kpi label="Export Readiness" tone={allReady ? 'green' : 'amber'} note={allReady ? 'Every file is ready' : blockedTitle ? 'Hover the download button for what is missing' : undefined}>
          {ready} <span className="text-base font-normal text-slate-400">of {batch.totalFiles} files</span>
        </Kpi>
      </div>

      <div role="tablist" aria-label="Show" className="flex flex-wrap gap-2 px-4 pt-3">
        {pills.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={filter === p.id}
            onClick={() => setFilter(p.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm font-medium transition-colors duration-150',
              filter === p.id ? 'border-brand bg-brand text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100',
            )}
          >
            {p.label} <span className={cn('text-xs font-normal', filter === p.id ? 'text-white/80' : 'text-slate-400')}>({p.n})</span>
          </button>
        ))}
      </div>

      <div className="mx-4 mb-3 mt-3 min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="tabular w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0">
            <tr>
              <th className={cn(th, 'w-10')}>#</th>
              <th className={th}>Student ID</th>
              <th className={th}>Student Name</th>
              {TERMS.map((t) => (
                <th key={t} className={cn(th, 'text-right')}>
                  {TERM_LABEL[t]} <span className="font-normal text-slate-400">{termWeightLabel(t)}</span>
                </th>
              ))}
              <th className={cn(th, 'bg-[#fef2f2] text-brand')}>Final Rating</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ s, i, final }) => (
              <tr key={s.id}>
                <td className={cn(td, 'text-xs text-slate-500')}>{i + 1}</td>
                <td className={td}>{s.studentId}</td>
                <td className={td}>{s.name}</td>
                {TERMS.map((t) => {
                  const o = termOutcome(record, s, t);
                  return (
                    <td key={t} className={cn(td, 'p-0 text-right')}>
                      <button className="w-full px-3 py-1.5 text-right transition-colors duration-150 hover:bg-brand/5" onClick={() => openDrawer({ studentId: s.id, term: t })}>
                        {o.kind === 'ok' ? (
                          <span className={cn(o.result.termGrade < rules.passingGrade && 'text-red-600')}>
                            {o.result.termGrade} <span className="text-xs text-slate-400">({formatPoint(o.result.termPointGrade.point)})</span>
                          </span>
                        ) : o.kind === 'status' ? (
                          <span className="text-xs font-semibold text-brand">{o.status}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </button>
                    </td>
                  );
                })}
                <td className={cn(td, 'bg-[#fff7f7]')}>
                  <FinalCell outcome={final} />
                </td>
              </tr>
            ))}
            {record.students.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                  No students yet. Add them in a term gradebook.
                </td>
              </tr>
            )}
            {record.students.length > 0 && shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                  No students in this group.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Final Rating, status, or the minimum Final term grade needed (D8, D26). */
export function FinalCell({ outcome, long }: { outcome: FinalOutcome; long?: boolean }) {
  switch (outcome.kind) {
    case 'status':
      return <Badge variant="brand">{outcome.status}</Badge>;
    case 'rating': {
      const { rating } = outcome;
      const passed = rating.grade >= rules.passingGrade;
      return (
        <span className="tabular inline-flex items-center gap-2">
          <span className="text-slate-500">{rating.raw.toFixed(2)} →</span>
          <strong>{rating.grade}</strong>
          <strong className={cn(!passed && 'text-red-600')}>{formatPoint(rating.point.point)}</strong>
          <Badge variant={passed ? 'green' : 'red'}>{passed ? 'Passed' : 'Failed'}</Badge>
        </span>
      );
    }
    case 'minFinal': {
      const n = outcome.needed;
      const text =
        n.kind === 'impossible'
          ? 'Cannot reach 75 even with a perfect Final'
          : n.kind === 'any'
            ? 'Passes with any Final grade'
            : `Needs a Final term grade of at least ${n.grade} to pass`;
      return <span className={cn('text-xs', n.kind === 'impossible' ? 'text-red-600' : 'text-slate-600')}>{text}</span>;
    }
    case 'pending':
      return <span className="text-xs text-slate-400">{long ? 'Shown once Prelim and Midterm are complete.' : '—'}</span>;
  }
}
