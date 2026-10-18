import { finalOutcome, formatPoint, termOutcome } from '../app/gradebook';
import { STATUS_NAME, subjectTypeLabel, TERM_LABEL } from '../app/labels';
import { useStore } from '../app/store';
import type { ClassRecord } from '../app/types';
import type { ComponentResult } from '../engine';
import { FinalCell } from './FinalRatingSummary';
import { Badge } from './ui/badge';
import { Dialog, DialogContent } from './ui/dialog';

/** Step-by-step breakdown for one student and term, from the engine's `trace`. */
export function BreakdownDrawer({ record }: { record: ClassRecord }) {
  const { drawer, openDrawer } = useStore();
  const student = drawer && record.students.find((s) => s.id === drawer.studentId);
  const open = !!(drawer && student);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && openDrawer(null)}>
      {drawer && student && (
        <DialogContent
          side="sheet"
          title={`${student.name || 'Unnamed student'} · ${TERM_LABEL[drawer.term]}`}
          description={`${student.studentId || 'No ID'} · ${record.subjectCode} · ${subjectTypeLabel(record.subjectType)}`}
        >
          <Breakdown record={record} studentId={student.id} term={drawer.term} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function Breakdown({ record, studentId, term }: { record: ClassRecord; studentId: string; term: 'PRELIM' | 'MIDTERM' | 'FINAL' }) {
  const student = record.students.find((s) => s.id === studentId)!;
  const outcome = termOutcome(record, student, term);
  const final = finalOutcome(record, student);

  let body;
  switch (outcome.kind) {
    case 'status':
      body = (
        <p className="text-sm">
          <Badge variant="brand">{outcome.status}</Badge> {STATUS_NAME[outcome.status]}
          {outcome.carried && ' (carried forward from an earlier term)'}. Mastersoft skips this term's grade and shows the status instead.
        </p>
      );
      break;
    case 'setup':
      body = <p className="text-sm text-slate-600">Finish this term's column setup (see the warning above the grid).</p>;
      break;
    case 'incomplete':
      body = <p className="text-sm text-slate-600">{outcome.missing} score(s) still missing for this term.</p>;
      break;
    case 'invalid':
      body = (
        <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
          {outcome.messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      );
      break;
    case 'ok': {
      const { result } = outcome;
      body = (
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Encode in Mastersoft</h3>
            <div className="grid grid-cols-2 gap-2">
              <EncodeBox label="Class Standing" c={result.cs} />
              <EncodeBox label="Written Exam" c={result.we} />
            </div>
          </section>

          {outcome.categories && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Weighted categories → CS mark</h3>
              <table className="tabular w-full text-sm">
                <tbody>
                  {outcome.categories.map((c) => (
                    <tr key={c.name} className="border-b border-slate-100">
                      <td className="py-1">{c.name}</td>
                      <td className="py-1 text-right text-slate-500">{c.weightPct}%</td>
                      <td className="py-1 text-right">
                        {c.raw} / {c.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-slate-500">
                CS mark = weighted CS % rounded half-up = <strong>{result.cs.raw} / 100</strong>. The plain raw sum would give a term grade of{' '}
                <strong>{outcome.rawSumResult?.termGrade}</strong>.
              </p>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Step by step</h3>
            <ol className="space-y-1.5">
              {result.trace.map((line) => (
                <li key={line} className="tabular rounded bg-slate-50 px-3 py-2 font-mono text-[13px] text-slate-800">
                  {line}
                </li>
              ))}
            </ol>
            <table className="tabular mt-3 w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="py-1 text-left font-medium" />
                  <th className="py-1 text-right font-medium">Scaled %</th>
                  <th className="py-1 text-right font-medium">Rounded</th>
                  <th className="py-1 text-right font-medium">Transmuted</th>
                  <th className="py-1 text-right font-medium">Weighted</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['CS', result.cs],
                    ['WE', result.we],
                  ] as const
                ).map(([label, c]) => (
                  <tr key={label} className="border-t border-slate-100">
                    <td className="py-1 font-medium">{label}</td>
                    <td className="py-1 text-right">{(c.scaledHundredths / 100).toFixed(2)}</td>
                    <td className="py-1 text-right">{c.roundedPct}</td>
                    <td className="py-1 text-right">{c.transmuted}</td>
                    <td className="py-1 text-right">{c.weighted.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="flex items-center gap-6 rounded-md border border-brand/20 bg-brand/5 px-4 py-3">
            <div>
              <div className="text-xs text-slate-500">Term grade</div>
              <div className="tabular text-2xl font-semibold">{result.termGrade}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Point grade</div>
              <div className="tabular text-2xl font-semibold">{formatPoint(result.termPointGrade.point)}</div>
            </div>
          </section>

          <Warnings outcome={outcome} />
        </div>
      );
    }
  }

  return (
    <div className="space-y-5">
      {body}
      <section className="border-t border-slate-200 pt-4">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Final Rating</h3>
        <div className="text-sm">
          <FinalCell outcome={final} long />
        </div>
      </section>
    </div>
  );
}

function EncodeBox({ label, c }: { label: string; c: ComponentResult }) {
  return (
    <div className="rounded-md border border-slate-200 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="tabular text-lg font-semibold">
        {c.raw} <span className="text-sm font-normal text-slate-500">/ {c.total}</span>
      </div>
      <div className="tabular text-xs text-slate-500">Scaled 100%: {(c.scaledHundredths / 100).toFixed(2)}</div>
    </div>
  );
}

function Warnings({ outcome }: { outcome: Extract<ReturnType<typeof termOutcome>, { kind: 'ok' }> }) {
  const { result } = outcome;
  const items: string[] = [];
  for (const [label, c] of [
    ['Class Standing', result.cs],
    ['Written Exam', result.we],
  ] as const) {
    if (c.unverifiedBoundary) items.push(`${label}: the raw % is between x.495 and x.499. Rounding twice (as assumed) and once give different whole percents; not yet confirmed in Mastersoft (D20).`);
    if (c.unverifiedLowPct) items.push(`${label}: below 38%, the whole-number transmutation ranges are not yet confirmed in Mastersoft (D30).`);
  }
  if (!result.termPointGrade.verified) items.push('The term point grade comes from the sheet and is not yet confirmed in Mastersoft (D31, D32). It does not affect the Final Rating.');
  if (outcome.decimalWarning) items.push(`Decimal marks: if Mastersoft only accepts whole numbers, rounding them gives a term grade of ${outcome.decimalWarning.roundedGrade}. Consider a larger Total Marks (e.g. 1000).`);
  if (items.length === 0) return null;
  return (
    <section className="space-y-1.5">
      {items.map((i) => (
        <p key={i} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <Badge variant="amber" className="mr-1.5">
            Unverified
          </Badge>
          {i}
        </p>
      ))}
    </section>
  );
}
