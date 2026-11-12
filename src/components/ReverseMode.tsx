import { BookOpenCheck, CheckCircle2, Check, FileDown, UserPlus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { formatPoint, reverseOutcome } from '../app/gradebook';
import { subjectTypeLabel } from '../app/labels';
import { useStore } from '../app/store';
import type { ClassRecord, ReverseInput } from '../app/types';
import { rules } from '../engine';
import { cn } from '../lib/utils';
import { MastersoftExportDialog } from './MastersoftDialogs';
import { ReverseGuideDialog } from './ReverseGuide';
import { TotalCard } from './TermGradebook';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

const POINT_OPTIONS = [...new Set(rules.transcriptPointGrades.map((r) => r.point)), rules.transcriptFailingPoint].sort((a, b) => a - b);

/** One numbered card of the three-step flow; the current step wears the brand colour, finished ones turn green. */
function StepCard({ n, title, state, badge, badgeTone, children }: { n: number; title: string; state: 'todo' | 'now' | 'done'; badge: string; badgeTone?: 'red'; children: ReactNode }) {
  return (
    <li aria-current={state === 'now' ? 'step' : undefined} className={cn('rounded-xl border bg-white p-3 shadow-sm', state === 'now' ? 'border-brand/40' : 'border-slate-200')}>
      <div className="flex items-center gap-2">
        <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold', state === 'done' ? 'bg-emerald-100 text-emerald-700' : state === 'now' ? 'bg-brand text-white' : 'bg-slate-100 text-slate-500')}>
          {state === 'done' ? <Check className="size-3.5" aria-label="Done" /> : n}
        </span>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <Badge variant={badgeTone === 'red' ? 'red' : state === 'done' ? 'green' : 'neutral'} className="ml-auto">
          {badge}
        </Badge>
      </div>
      <div className="mt-2">{children}</div>
    </li>
  );
}

/** Final Rating Only mode, internally "reverse mode" (D11, D28, D38): target Final Rating → the marks to encode in all 3 terms. */
export function ReverseMode({ record }: { record: ClassRecord }) {
  const { setReverse, setStudentField, addStudent } = useStore();
  const [guideOpen, setGuideOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const outcomes = record.students.map((s) => reverseOutcome(record, s));
  const total = record.students.length;
  const solved = outcomes.filter((o) => o.kind === 'ok').length;
  const invalid = outcomes.filter((o) => o.kind === 'invalid').length;
  const entered = solved + invalid;
  const th = 'border-b border-slate-200 bg-slate-100 px-2 py-2 text-left text-xs font-semibold text-slate-600';
  const td = 'border-b border-slate-200 px-2 py-1';
  const input = 'h-8 rounded border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

  return (
    <>
      <div className="border-b border-slate-200 bg-white px-4 py-2.5">
        <h2 className="text-base font-semibold">Final Rating Only mode</h2>
        <p className="text-xs text-slate-500">
          For classes where only the Final Rating is encoded (internship, thesis): enter each student's Final Rating, and get the Class
          Standing and Written Exam marks to encode in every term so Mastersoft produces it. Uses the class's {subjectTypeLabel(record.subjectType)}{' '}
          weightage.
        </p>
      </div>

      <ol aria-label="Final Rating Only steps" className="grid gap-3 px-4 pt-3 lg:grid-cols-3">
        <StepCard n={1} title="Enter Target Final Rating" state={total === 0 ? 'todo' : entered === total ? 'done' : 'now'} badge={total === 0 ? 'No students' : `${entered} of ${total} entered`}>
          <p className="text-xs text-slate-600">Type each student's target below, as a grade (60–100) or a point grade.</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={addStudent}>
            <UserPlus /> Add student
          </Button>
        </StepCard>
        <StepCard n={2} title="Review Generated CS & WE Marks" state={solved === 0 && invalid === 0 ? 'todo' : invalid > 0 ? 'now' : solved === total ? 'done' : 'now'} badge={invalid > 0 ? `${invalid} to fix` : `${solved} generated`} badgeTone={invalid > 0 ? 'red' : undefined}>
          <p className="text-xs text-slate-600">The marks are the same for Class Standing and Written Exam in every term. “Check (forward)” confirms Mastersoft will produce the target.</p>
        </StepCard>
        <StepCard n={3} title="Export / Copy to Mastersoft" state={solved > 0 && invalid === 0 && solved === total ? 'now' : 'todo'} badge="Total Marks 100 / 100">
          <div className="flex flex-wrap items-center gap-2">
            <TotalCard label="Class Standing" value={100} />
            <TotalCard label="Written Exam" value={100} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setGuideOpen(true)}>
              <BookOpenCheck /> Encoding guide
            </Button>
            <Button size="sm" onClick={() => setExportOpen(true)}>
              <FileDown /> Export for Mastersoft
            </Button>
          </div>
        </StepCard>
      </ol>
      <ReverseGuideDialog record={record} open={guideOpen} onOpenChange={setGuideOpen} />
      <MastersoftExportDialog record={record} term="PRELIM" reverse open={exportOpen} onOpenChange={setExportOpen} />
      <div className="mx-4 mb-3 mt-3 min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="tabular w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={cn(th, 'w-10')}>#</th>
              <th className={th}>Student ID</th>
              <th className={th}>Student Name</th>
              <th className={th}>Target Final Rating</th>
              <th className={cn(th, 'bg-[#fef2f2] text-right text-brand')}>CS Marks / 100</th>
              <th className={cn(th, 'bg-[#fef2f2] text-right text-brand')}>WE Marks / 100</th>
              <th className={cn(th, 'bg-[#fef2f2] text-brand')}>Check (forward)</th>
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
                      <td className={cn(td, 'bg-[#fff7f7] text-right text-base font-semibold')}>{outcome.solved.mark}</td>
                      <td className={cn(td, 'bg-[#fff7f7] text-right text-base font-semibold')}>{outcome.solved.mark}</td>
                      <td className={cn(td, 'bg-[#fff7f7] text-xs')}>
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
                    <td colSpan={3} className={cn(td, 'bg-[#fff7f7] text-xs', outcome.kind === 'invalid' ? 'text-red-600' : 'text-slate-400')}>
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
