import { BookOpen, CheckCircle2, Crosshair, FileDown, PanelRightClose } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TermProgress } from '../app/progress';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

interface Props {
  progress: TermProgress;
  totals: { cs: number | null; we: number | null };
  onNextProblem: () => void;
  onExport: () => void;
  onSummary: () => void;
  onClose: () => void;
}

interface Todo {
  text: ReactNode;
  action?: { label: string; onClick: () => void };
}

/** Short "what to do next" list, taken from where the term stands right now. */
function nextSteps(p: TermProgress, totals: Props['totals'], onNextProblem: () => void, onExport: () => void, onSummary: () => void): Todo[] {
  const toFix = p.missing + p.invalid;
  if (p.students === 0) {
    return [
      { text: 'Add your students: import the Mastersoft list or an Excel class record, or type them in.' },
      { text: 'Set up the Class Standing and Written Exam columns.' },
      { text: 'Type or paste the scores.' },
    ];
  }
  if (p.setupIssues.length > 0) {
    return [{ text: <>{p.setupIssues[0]}</> }, { text: 'Type or paste the scores for every student.' }, { text: 'Export the grades to Mastersoft.' }];
  }
  if (p.duplicateIds > 0 || toFix > 0) {
    const todo: Todo[] = [];
    if (p.duplicateIds > 0) todo.push({ text: `Fix the ${p.duplicateIds} Student ID${p.duplicateIds === 1 ? '' : 's'} shared by more than one student (red cells).`, action: { label: 'Go to it', onClick: onNextProblem } });
    if (p.missing > 0) todo.push({ text: `Enter the missing scores for ${p.missing} student${p.missing === 1 ? '' : 's'}.`, action: { label: 'Next blank', onClick: onNextProblem } });
    if (p.invalid > 0) todo.push({ text: `Correct the invalid scores of ${p.invalid} student${p.invalid === 1 ? '' : 's'} (red cells).`, action: { label: 'Next error', onClick: onNextProblem } });
    todo.push({ text: 'Export the grades to Mastersoft once everything is green.' });
    return todo.slice(0, 3);
  }
  return [
    { text: `In Mastersoft, set the Total Marks to Class Standing ${totals.cs ?? '—'} and Written Exam ${totals.we ?? '—'}.` },
    { text: 'Export the grades and upload the file, or follow the Encoding Guide.', action: { label: 'Export', onClick: onExport } },
    { text: 'Check the Final Rating summary.', action: { label: 'Open', onClick: onSummary } },
  ];
}

/** Right-hand helper next to the gradebook: what to do next, how far along the term is, and the export buttons. */
export function TeacherAssistantPanel({ progress: p, totals, onNextProblem, onExport, onSummary, onClose }: Props) {
  const entered = p.ready + p.withStatus;
  const pct = p.students === 0 ? 0 : Math.round((entered / p.students) * 100);
  const todo = nextSteps(p, totals, onNextProblem, onExport, onSummary);
  const needs = p.students - entered;
  const ok = p.complete;

  return (
    <aside
      aria-label="Teacher assistant"
      className="fixed inset-y-0 right-0 z-30 flex w-80 max-w-[90vw] flex-col gap-3 overflow-y-auto border-l border-slate-200 bg-surface p-3 shadow-xl xl:static xl:z-auto xl:w-72 xl:max-w-none xl:shrink-0 xl:shadow-none"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Teacher assistant</h3>
        <button onClick={onClose} aria-label="Hide the assistant" title="Hide the assistant" className="rounded p-1 text-slate-400 transition-colors duration-150 hover:bg-slate-200/60 hover:text-brand">
          <PanelRightClose className="size-4" />
        </button>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">What to do next</h4>
        <ol className="mt-2 space-y-2.5">
          {todo.map((t, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-slate-700">
              <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', i === 0 ? 'bg-brand text-white' : 'bg-slate-100 text-slate-500')}>{i + 1}</span>
              <span className="min-w-0">
                {t.text}
                {t.action && (
                  <button onClick={t.action.onClick} className="ml-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand underline-offset-2 hover:underline">
                    <Crosshair className="size-3" /> {t.action.label}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Class progress</h4>
        <p className="mt-2 text-sm text-slate-700">
          Scores entered: <strong className="tabular">{entered}</strong> of <strong className="tabular">{p.students}</strong> students
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Scores entered">
          <div className={cn('h-full rounded-full transition-[width] duration-200', ok ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: `${pct}%` }} />
        </div>
        <p className={cn('mt-2 flex items-start gap-1.5 text-xs font-medium', ok ? 'text-emerald-700' : 'text-amber-700')}>
          {ok ? (
            <>
              <CheckCircle2 className="mt-px size-3.5 shrink-0" /> Everything is in. This term is ready to export.
            </>
          ) : p.students === 0 || p.setupIssues.length > 0 ? (
            'Add students and finish the column setup to start.'
          ) : (
            `${needs > 0 ? `${needs} student${needs === 1 ? '' : 's'} still need scores` : 'Items need attention'}${p.invalid > 0 ? `, ${p.invalid} to fix` : ''}${p.duplicateIds > 0 ? `, ${p.duplicateIds} duplicate ID${p.duplicateIds === 1 ? '' : 's'}` : ''}.`
          )}
        </p>
      </section>

      <div className="grid gap-2">
        <Button onClick={onExport} className="h-10 w-full">
          <FileDown /> Export Grades to Mastersoft
        </Button>
        <Button variant="outline" onClick={onSummary} className="h-9 w-full">
          <BookOpen /> View Final Rating Summary
        </Button>
      </div>
    </aside>
  );
}
