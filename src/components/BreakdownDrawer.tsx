import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { finalOutcome, formatPoint, termOutcome } from '../app/gradebook';
import { STATUS_NAME, subjectTypeLabel, TERM_LABEL } from '../app/labels';
import { obeReport } from '../app/obe';
import { useStore } from '../app/store';
import type { ClassRecord } from '../app/types';
import { BP, rules, type ComponentResult, type OutcomeAttainment, type Term, type TermResult } from '../engine';
import { cn } from '../lib/utils';
import { FinalCell } from './FinalRatingSummary';
import { Badge } from './ui/badge';
import { Dialog, DialogContent } from './ui/dialog';

/** Step-by-step breakdown for one student and term, explained in plain words from the engine's result. */
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
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Weighted categories → Class Standing mark</h3>
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
                Class Standing mark = weighted Class Standing % rounded half-up = <strong>{result.cs.raw} / 100</strong>. The plain raw sum would give a term grade of{' '}
                <strong>{outcome.rawSumResult?.termGrade}</strong>.
              </p>
            </section>
          )}

          <StepCards result={result} />


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
      <ObeSection record={record} studentId={studentId} term={term} />
    </div>
  );
}

/** A weight in basis points as a plain percent: 5000 → "50", 3333 → "33.33". */
const pctOf = (bp: number) => String(Number(((bp / BP) * 100).toFixed(2)));

/** One line of a step card: a small grey label, then the sentence. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="text-sm leading-relaxed text-slate-800">
      <span className="font-medium text-slate-500">{label}:</span> {children}
    </p>
  );
}

/** Class Standing or Written Exam: the score, its table value, and the points it adds to the term grade. */
function ComponentCard({ title, weightPct, c, tone }: { title: string; weightPct: string; c: ComponentResult; tone: 'sky' | 'violet' }) {
  return (
    <section className={cn('space-y-1.5 rounded-xl border p-3', tone === 'sky' ? 'border-sky-200 bg-sky-50/60' : 'border-violet-200 bg-violet-50/60')}>
      <h4 className={cn('text-sm font-semibold', tone === 'sky' ? 'text-sky-900' : 'text-violet-900')}>
        {title} <span className="font-normal">({weightPct}% of Term Grade)</span>
      </h4>
      <Line label="Score">
        Earned{' '}
        <strong>
          {c.raw} out of {c.total}
        </strong>{' '}
        (<strong>{(c.scaledHundredths / 100).toFixed(2)}%</strong>, rounded to <strong>{c.roundedPct}%</strong>).
      </Line>
      <Line label="Transmutation table">
        In Mastersoft's table, <strong>{c.roundedPct}%</strong> converts to <strong>{c.transmuted}</strong>.
      </Line>
      <Line label="Points earned">
        <strong>{weightPct}%</strong> of <strong>{c.transmuted}</strong> = <strong>{c.weighted.toFixed(2)} points</strong>.
      </Line>
    </section>
  );
}

/** The term grade in three plain steps, plus the raw numbers behind a toggle for coordinators. */
function StepCards({ result }: { result: TermResult }) {
  const [showNumbers, setShowNumbers] = useState(false);
  const w = rules.weightBp[result.subjectType];
  const csPct = pctOf(w.cs);
  const wePct = pctOf(w.we);
  const sum = (result.cs.weighted + result.we.weighted).toFixed(2);
  const passed = result.termGrade >= rules.passingGrade;
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step by step</h3>
      <ComponentCard title="Class Standing" weightPct={csPct} c={result.cs} tone="sky" />
      <ComponentCard title="Written Exam" weightPct={wePct} c={result.we} tone="violet" />
      <section className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <h4 className="text-sm font-semibold text-slate-900">Combined Term Grade</h4>
        <Line label="Add the points">
          <strong>{result.cs.weighted.toFixed(2)}</strong> + <strong>{result.we.weighted.toFixed(2)}</strong> = <strong>{sum}</strong>
        </Line>
        <Line label="Round to whole grade">
          <strong>{sum}</strong> rounds to <strong>{result.termGrade}</strong>
        </Line>
        <Line label="Point grade">
          <strong>{formatPoint(result.termPointGrade.point)}</strong>{' '}
          <span className={cn('font-medium', passed ? 'text-emerald-700' : 'text-red-600')}>({passed ? `Passed: ${rules.passingGrade} or above` : `Failed: below ${rules.passingGrade}`})</span>
        </Line>
      </section>

      <button
        type="button"
        onClick={() => setShowNumbers((o) => !o)}
        aria-expanded={showNumbers}
        className="flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors duration-150 hover:text-brand"
      >
        {showNumbers ? 'Hide number table' : 'Show number table'} {showNumbers ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>
      {showNumbers && (
        <table className="tabular w-full text-sm">
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
                ['Class Standing', result.cs],
                ['Written Exam', result.we],
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
      )}
    </section>
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

/** The student's CO / LO attainment in this term and over the semester. */
function ObeSection({ record, studentId, term }: { record: ClassRecord; studentId: string; term: Term }) {
  const report = useMemo(() => obeReport(record), [record]);
  const obe = record.obe;
  const student = report?.students.find((s) => s.studentId === studentId);
  if (!obe || !student || obe.cos.length === 0) return null;
  const now = student.scopes[term];
  const overall = student.scopes.OVERALL;
  const lacking = [
    ...obe.cos.map((c) => ({ code: c.code, a: now.cos[c.id]! })),
    ...obe.los.map((l) => ({ code: l.code, a: now.los[l.id]! })),
  ].filter(({ a }) => a.attained === false);
  return (
    <section className="border-t border-slate-200 pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">OBE Attainment (CLOs &amp; LOs)</h3>
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500">
            <th className="py-1 text-left font-medium">CO</th>
            <th className="py-1 text-right font-medium">{TERM_LABEL[term]}</th>
            <th className="py-1 text-right font-medium">Semester</th>
          </tr>
        </thead>
        <tbody>
          {obe.cos.map((c) => (
            <tr key={c.id} className="border-t border-slate-100" title={c.description}>
              <td className="py-1 font-medium">{c.code}</td>
              <td className="py-1 text-right">
                <AttainmentCell a={now.cos[c.id]!} />
              </td>
              <td className="py-1 text-right">
                <AttainmentCell a={overall.cos[c.id]!} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {lacking.length > 0 && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <p className="mb-1 font-semibold">Lacking in {TERM_LABEL[term]}</p>
          <ul className="space-y-0.5">
            {lacking.map(({ code, a }) => (
              <li key={code}>
                <strong>{code}</strong> ({a.rawPct?.toFixed(2)}%){a.lowColumns.length > 0 && ` — below the pass mark in ${a.lowColumns.join(', ')}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function AttainmentCell({ a }: { a: OutcomeAttainment }) {
  if (a.rawPct === null) return <span className="text-xs text-slate-400">No scores yet</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-slate-500">
        {a.rawEarned} / {a.rawMax} =
      </span>
      {a.rawPct.toFixed(2)}%
      <Badge variant={a.attained ? 'green' : 'red'}>{a.attained ? 'Attained' : 'Lacking'}</Badge>
    </span>
  );
}
