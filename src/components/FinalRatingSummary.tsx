import { finalOutcome, formatPoint, termOutcome, type FinalOutcome } from '../app/gradebook';
import { TERM_LABEL, termWeightLabel } from '../app/labels';
import { useStore } from '../app/store';
import type { ClassRecord } from '../app/types';
import { rules, TERMS } from '../engine';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';

export function FinalRatingSummary({ record }: { record: ClassRecord }) {
  const openDrawer = useStore((s) => s.openDrawer);
  const th = 'border-b border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs font-semibold text-slate-600';
  const td = 'border-b border-slate-200 px-3 py-1.5';
  return (
    <>
      <div className="border-b border-slate-200 bg-white px-4 py-2.5">
        <h2 className="text-base font-semibold">Final Rating summary</h2>
        <p className="text-xs text-slate-500">
          FR = {TERMS.map((t) => `${termWeightLabel(t)} ${TERM_LABEL[t]}`).join(' + ')}, rounded half-up, then the transcript point grade (below 75 = 5.0).
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white">
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
              <th className={cn(th, 'bg-brand/10 text-brand')}>Final Rating</th>
            </tr>
          </thead>
          <tbody>
            {record.students.map((s, i) => (
              <tr key={s.id}>
                <td className={cn(td, 'text-xs text-slate-500')}>{i + 1}</td>
                <td className={td}>{s.studentId}</td>
                <td className={td}>{s.name}</td>
                {TERMS.map((t) => {
                  const o = termOutcome(record, s, t);
                  return (
                    <td key={t} className={cn(td, 'p-0 text-right')}>
                      <button className="w-full px-3 py-1.5 text-right hover:bg-brand/5" onClick={() => openDrawer({ studentId: s.id, term: t })}>
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
                <td className={cn(td, 'bg-[#fdf6f6]')}>
                  <FinalCell outcome={finalOutcome(record, s)} />
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
