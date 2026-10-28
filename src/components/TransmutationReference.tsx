import { useMemo, useState, type ReactNode } from 'react';
import { formatPoint } from '../app/gradebook';
import { SUBJECT_TYPES, subjectSplitLabel, subjectTypeName, TERM_LABEL, termWeightLabel } from '../app/labels';
import { pointGrade, rules, scale, TERMS, transmute } from '../engine';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Input } from './ui/input';

interface Row {
  pct: number;
  transmuted: number;
  termPoint: number;
  termVerified: boolean;
  transcriptPoint: number;
  passed: boolean;
  unverifiedPct: boolean;
}

function buildRow(pct: number): Row {
  const transmuted = transmute(pct);
  const term = pointGrade(transmuted, 'term');
  return {
    pct,
    transmuted,
    termPoint: term.point,
    termVerified: term.verified,
    transcriptPoint: pointGrade(transmuted, 'transcript').point,
    passed: transmuted >= rules.passingGrade,
    unverifiedPct: pct < rules.unverifiedBelowPct,
  };
}

const ROWS: Row[] = rules.transmutation.map((r) => buildRow(r.pct)).sort((a, b) => b.pct - a.pct);

const PASSING_POINT = formatPoint(pointGrade(rules.passingGrade, 'transcript').point);

type RangeKey = 'ALL' | 'PASSING' | 'CONDITIONAL' | 'LOW';
const RANGES: { key: RangeKey; label: string; test: (pct: number) => boolean }[] = [
  { key: 'ALL', label: 'All (100–0)', test: () => true },
  { key: 'PASSING', label: 'Passing grades (100–75)', test: (p) => p >= 75 },
  { key: 'CONDITIONAL', label: 'Conditional / Below 75 (74–60)', test: (p) => p >= 60 && p < 75 },
  { key: 'LOW', label: 'Low scores (<60)', test: (p) => p < 60 },
];

const rowText = (r: Row) => [r.pct, r.transmuted, formatPoint(r.termPoint), formatPoint(r.transcriptPoint)].map(String);

const UNVERIFIED_PCT_TITLE = 'Whole-number range below 38% not yet confirmed in Mastersoft (D30)';
const UNVERIFIED_TERM_TITLE = 'From the sheet, not yet confirmed in Mastersoft (D31, D32)';

const RANGE_ERROR = 'Enter a number from 0 to 100.';

function Step({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 ring-1 ring-slate-200">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
      {children}
    </span>
  );
}

const Arrow = () => (
  <span aria-hidden className="text-slate-400">
    →
  </span>
);

function QuickLookup() {
  const [value, setValue] = useState('');
  const result = useMemo(() => {
    if (value.trim() === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { error: RANGE_ERROR, row: null, scaled: 0 };
    try {
      const { scaledHundredths, roundedPct } = scale(n, 100);
      return { error: null, scaled: scaledHundredths / 100, row: buildRow(roundedPct) };
    } catch {
      return { error: RANGE_ERROR, row: null, scaled: 0 };
    }
  }, [value]);

  return (
    <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <label htmlFor="quick-lookup" className="text-sm font-semibold text-slate-800">
        Quick Lookup
      </label>
      <p className="mb-2 text-xs text-slate-500">Enter a % or score (e.g. 84 or 83.6)</p>
      <Input
        id="quick-lookup"
        type="number"
        inputMode="decimal"
        min={0}
        max={100}
        step="any"
        placeholder="e.g. 83.6"
        className="max-w-48"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div aria-live="polite">
        {result?.error && <p className="mt-3 text-sm text-red-700">{result.error}</p>}
        {result?.row && (
          <div className="tabular mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
            <Step label="Scaled %" value={String(result.scaled)} />
            <Arrow />
            <Step label="Rounded" value={`${result.row.pct}%`} />
            <Arrow />
            <Step label="Transmuted" value={String(result.row.transmuted)} />
            <Arrow />
            <Step label="Term Point" value={formatPoint(result.row.termPoint)}>
              {!result.row.termVerified && (
                <Badge variant="amber" title={UNVERIFIED_TERM_TITLE}>
                  unverified
                </Badge>
              )}
            </Step>
            <Arrow />
            <Step label="Transcript Point" value={formatPoint(result.row.transcriptPoint)} />
            <span className="text-slate-400">·</span>
            <Badge variant={result.row.passed ? 'green' : 'red'} className="text-xs">
              {result.row.passed ? 'Passed' : 'Failed'}
            </Badge>
            {result.row.unverifiedPct && (
              <Badge variant="amber" title={UNVERIFIED_PCT_TITLE}>
                unverified
              </Badge>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function FormulaBadges() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {SUBJECT_TYPES.map((t) => (
        <Badge key={t} variant="neutral" className="px-2 py-1 text-xs">
          {subjectTypeName(t)} ({subjectSplitLabel(t)})
        </Badge>
      ))}
      <Badge variant="brand" className="px-2 py-1 text-xs">
        Final Rating: {TERMS.map((t) => `${termWeightLabel(t)} ${TERM_LABEL[t]}`).join(' + ')}
      </Badge>
      <Badge variant="green" className="px-2 py-1 text-xs">
        Passing Grade: {rules.passingGrade} (Point Grade {PASSING_POINT})
      </Badge>
    </div>
  );
}

/** Read-only view of the rules file (rules.v1.json). */
export function TransmutationReference() {
  const [range, setRange] = useState<RangeKey>('PASSING');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const inRange = RANGES.find((r) => r.key === range)!.test;
    const q = query.trim();
    return ROWS.filter((r) => inRange(r.pct) && (q === '' || rowText(r).some((cell) => cell.includes(q))));
  }, [range, query]);

  const th =
    'sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs font-semibold text-slate-600';
  const td = 'border-b border-slate-100 px-3 py-1.5';

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <h2 className="text-base font-semibold">Transmutation table and rules</h2>
      <p className="mb-3 text-xs text-slate-500">Rules version {rules.version}.</p>
      <FormulaBadges />
      <QuickLookup />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Scaled % range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                'h-8 rounded-md border px-3 text-xs font-medium transition-colors',
                range === r.key
                  ? 'border-brand bg-brand text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <Input
          type="search"
          aria-label="Filter table by % or grade"
          placeholder="Filter table by % or grade..."
          className="h-8 max-w-64"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="mb-2 text-xs text-slate-500">
        Ranges use Scaled %. Passed or Below {rules.passingGrade} follows the transmuted grade (pass at{' '}
        {rules.passingGrade}), so a scaled score as low as 60% already passes.
      </p>

      <div className="max-h-[60vh] overflow-auto rounded-md border border-slate-200 bg-white">
        <table className="tabular w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={th}>Scaled %</th>
              <th className={th}>Transmuted Grade</th>
              <th className={th}>Term Point Grade</th>
              <th className={th}>Transcript Point Grade</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const mark = r.pct === rules.passingGrade ? 'border-y-2 border-emerald-500 bg-emerald-50' : '';
              return (
                <tr key={r.pct} className="even:bg-slate-50">
                  <td className={cn(td, mark, mark && 'border-l-2 font-semibold')}>
                    <span className="inline-flex items-center gap-1.5">
                      {r.pct}%
                      {r.unverifiedPct && (
                        <Badge variant="amber" title={UNVERIFIED_PCT_TITLE}>
                          unverified
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className={cn(td, mark)}>{r.transmuted}</td>
                  <td className={cn(td, mark)}>
                    <span className="inline-flex items-center gap-1.5">
                      {formatPoint(r.termPoint)}
                      {!r.termVerified && (
                        <Badge variant="amber" title={UNVERIFIED_TERM_TITLE}>
                          unverified
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className={cn(td, mark)}>{formatPoint(r.transcriptPoint)}</td>
                  <td className={cn(td, mark, mark && 'border-r-2')}>
                    {r.passed ? (
                      <Badge variant="green">Passed (1.0–3.0)</Badge>
                    ) : (
                      <Badge variant="red">Below {rules.passingGrade}</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                  No rows match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
