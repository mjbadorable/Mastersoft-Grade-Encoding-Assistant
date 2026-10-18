import { CheckCircle2, UserPlus } from 'lucide-react';
import { formatPoint, reverseOutcome } from '../app/gradebook';
import { subjectTypeLabel } from '../app/labels';
import { useStore } from '../app/store';
import type { ClassRecord, ReverseInput } from '../app/types';
import { rules } from '../engine';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

const POINT_OPTIONS = [...new Set(rules.transcriptPointGrades.map((r) => r.point)), rules.transcriptFailingPoint].sort((a, b) => a - b);

/** Reverse mode (D11, D28): target Final Rating → the marks to encode in all 3 terms. */
export function ReverseMode({ record }: { record: ClassRecord }) {
  const { setReverse, setStudentField, addStudent } = useStore();
  const th = 'border-b border-slate-200 bg-slate-100 px-2 py-2 text-left text-xs font-semibold text-slate-600';
  const td = 'border-b border-slate-200 px-2 py-1';
  const input = 'h-8 rounded border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div>
          <h2 className="text-base font-semibold">Reverse mode</h2>
          <p className="text-xs text-slate-500">
            For internship or thesis: enter the Final Rating you want, and get the marks that make Mastersoft produce it. Uses the class's{' '}
            {subjectTypeLabel(record.subjectType)} weightage.
          </p>
        </div>
        <Button size="sm" variant="outline" className="ml-auto" onClick={addStudent}>
          <UserPlus /> Add student
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-surface px-4 py-3">
        <div className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-500">
          Mastersoft
          <br />
          Assessment Component
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
          Prelim, Midterm and Final – Class Standing Total Marks <strong className="tabular ml-1 text-lg">100</strong>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
          Prelim, Midterm and Final – Written Exam Total Marks <strong className="tabular ml-1 text-lg">100</strong>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <table className="tabular w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={cn(th, 'w-10')}>#</th>
              <th className={th}>Student ID</th>
              <th className={th}>Student Name</th>
              <th className={th}>Target Final Rating</th>
              <th className={cn(th, 'bg-brand/10 text-right text-brand')}>CS Marks / 100</th>
              <th className={cn(th, 'bg-brand/10 text-right text-brand')}>WE Marks / 100</th>
              <th className={cn(th, 'bg-brand/10 text-brand')}>Check (forward)</th>
            </tr>
          </thead>
          <tbody>
            {record.students.map((s, i) => {
              const target: ReverseInput = s.reverse ?? { kind: 'transmuted', grade: '' };
              const outcome = reverseOutcome(record, s);
              return (
                <tr key={s.id}>
                  <td className={cn(td, 'text-xs text-slate-500')}>{i + 1}</td>
                  <td className={td}>
                    <input className={cn(input, 'w-28')} value={s.studentId} aria-label={`Student ID, row ${i + 1}`} onChange={(e) => setStudentField(s.id, 'studentId', e.target.value)} />
                  </td>
                  <td className={td}>
                    <input className={cn(input, 'w-52')} value={s.name} aria-label={`Student name, row ${i + 1}`} onChange={(e) => setStudentField(s.id, 'name', e.target.value)} />
                  </td>
                  <td className={td}>
                    <div className="flex items-center gap-1.5">
                      <select
                        className={input}
                        value={target.kind}
                        aria-label="Target type"
                        onChange={(e) =>
                          setReverse(s.id, e.target.value === 'point' ? { kind: 'point', point: '', transmuted: '' } : { kind: 'transmuted', grade: '' })
                        }
                      >
                        <option value="transmuted">Grade (60–100)</option>
                        <option value="point">Point grade</option>
                      </select>
                      {target.kind === 'transmuted' ? (
                        <input
                          className={cn(input, 'w-20 text-right')}
                          inputMode="numeric"
                          placeholder="e.g. 90"
                          aria-label={`Target grade for ${s.name || `row ${i + 1}`}`}
                          value={target.grade}
                          onChange={(e) => setReverse(s.id, { kind: 'transmuted', grade: e.target.value })}
                        />
                      ) : (
                        <>
                          <select
                            className={input}
                            aria-label={`Target point grade for ${s.name || `row ${i + 1}`}`}
                            value={target.point}
                            onChange={(e) => setReverse(s.id, { ...target, point: e.target.value })}
                          >
                            <option value="">Choose…</option>
                            {POINT_OPTIONS.map((p) => (
                              <option key={p} value={String(p)}>
                                {formatPoint(p)}
                              </option>
                            ))}
                          </select>
                          {Number(target.point) === rules.transcriptFailingPoint && (
                            <input
                              className={cn(input, 'w-20 text-right')}
                              inputMode="numeric"
                              placeholder="60–74"
                              title="A 5.0 target needs the exact grade (60–74)"
                              aria-label="Exact grade for 5.0"
                              value={target.transmuted}
                              onChange={(e) => setReverse(s.id, { ...target, transmuted: e.target.value })}
                            />
                          )}
                        </>
                      )}
                    </div>
                  </td>
                  {outcome.kind === 'ok' ? (
                    <>
                      <td className={cn(td, 'bg-[#fdf6f6] text-right text-base font-semibold')}>{outcome.solved.mark}</td>
                      <td className={cn(td, 'bg-[#fdf6f6] text-right text-base font-semibold')}>{outcome.solved.mark}</td>
                      <td className={cn(td, 'bg-[#fdf6f6] text-xs')}>
                        <span className="inline-flex items-center gap-1.5">
                          Each term {outcome.check.termGrade} → FR {outcome.rating.grade} ({formatPoint(outcome.rating.point.point)})
                          {outcome.rating.grade === outcome.solved.transmuted && outcome.check.termGrade === outcome.solved.transmuted && (
                            <Badge variant="green" title="Running the marks forward through the engine gives the target">
                              <CheckCircle2 className="mr-0.5 size-3" /> matches
                            </Badge>
                          )}
                        </span>
                      </td>
                    </>
                  ) : (
                    <td colSpan={3} className={cn(td, 'bg-[#fdf6f6] text-xs', outcome.kind === 'invalid' ? 'text-red-600' : 'text-slate-400')}>
                      {outcome.kind === 'invalid' ? outcome.message : 'Enter a target'}
                    </td>
                  )}
                </tr>
              );
            })}
            {record.students.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                  No students yet. Use “Add student”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
