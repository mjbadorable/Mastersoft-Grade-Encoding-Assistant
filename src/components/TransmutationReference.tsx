import { formatPoint } from '../app/gradebook';
import { SUBJECT_TYPES, subjectTypeLabel, TERM_LABEL, termWeightLabel } from '../app/labels';
import { rules, TERMS } from '../engine';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';

/** Read-only view of the rules file (rules.v1.json). */
export function TransmutationReference() {
  const th = 'border-b border-slate-200 bg-slate-100 px-3 py-1.5 text-left text-xs font-semibold text-slate-600';
  const td = 'border-b border-slate-100 px-3 py-1';
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <h2 className="text-base font-semibold">Transmutation table and rules</h2>
      <p className="mb-4 text-xs text-slate-500">
        Rules version {rules.version}. Weightage: {SUBJECT_TYPES.map(subjectTypeLabel).join(' · ')}. Final Rating:{' '}
        {TERMS.map((t) => `${termWeightLabel(t)} ${TERM_LABEL[t]}`).join(' + ')}.
      </p>
      <div className="flex flex-wrap items-start gap-4">
        <table className="tabular rounded-md border border-slate-200 bg-white text-sm">
          <caption className="pb-1 text-left text-xs font-semibold text-slate-600">Scaled % → transmuted grade</caption>
          <thead>
            <tr>
              <th className={th}>Rounded %</th>
              <th className={th}>Transmuted</th>
            </tr>
          </thead>
          <tbody>
            {rules.transmutation.map((r) => (
              <tr key={r.pct}>
                <td className={td}>{r.pct}</td>
                <td className={cn(td, 'flex items-center gap-1.5')}>
                  {r.transmuted}
                  {r.pct < rules.unverifiedBelowPct && <Badge variant="amber" title="Whole-number range below 38% not yet confirmed in Mastersoft (D30)">unverified</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="tabular rounded-md border border-slate-200 bg-white text-sm">
          <caption className="pb-1 text-left text-xs font-semibold text-slate-600">Term point grades</caption>
          <thead>
            <tr>
              <th className={th}>Term grade</th>
              <th className={th}>Point</th>
            </tr>
          </thead>
          <tbody>
            {rules.termPointGrades.map((r) => (
              <tr key={r.grade}>
                <td className={td}>{r.grade}</td>
                <td className={cn(td, 'flex items-center gap-1.5')}>
                  {formatPoint(r.point)}
                  {!r.verified && <Badge variant="amber" title="From the sheet, not yet confirmed in Mastersoft (D31, D32)">unverified</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="tabular rounded-md border border-slate-200 bg-white text-sm">
          <caption className="pb-1 text-left text-xs font-semibold text-slate-600">Final Rating (transcript) point grades</caption>
          <thead>
            <tr>
              <th className={th}>Final Rating</th>
              <th className={th}>Point</th>
            </tr>
          </thead>
          <tbody>
            {rules.transcriptPointGrades.map((r) => (
              <tr key={r.grade}>
                <td className={td}>{r.grade}</td>
                <td className={td}>{formatPoint(r.point)}</td>
              </tr>
            ))}
            <tr>
              <td className={td}>below {rules.passingGrade}</td>
              <td className={td}>{formatPoint(rules.transcriptFailingPoint)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
