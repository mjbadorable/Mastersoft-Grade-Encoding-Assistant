import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { TermProgress } from '../app/progress';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

export interface StepAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}

interface Step {
  title: string;
  /** Label in the step strip. */
  short: string;
  detail: ReactNode;
  done: boolean;
  actions: StepAction[];
}

const HIDDEN_KEY = 'workflowGuideHidden';
const readHidden = () => {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
};

interface Props {
  progress: TermProgress;
  totals: { cs: number | null; we: number | null };
  actions: {
    students: StepAction[];
    columns: StepAction[];
    scores: StepAction[];
    encode: StepAction[];
  };
}

/** The four steps of encoding one term, with where the teacher is and what to do next. */
export function WorkflowGuide({ progress: p, totals, actions }: Props) {
  const [hidden, setHidden] = useState(readHidden);
  const toggle = () => {
    setHidden(!hidden);
    try {
      localStorage.setItem(HIDDEN_KEY, hidden ? '0' : '1');
    } catch {
      // Not saved; the guide just shows again next time.
    }
  };

  const toFix = p.missing + p.invalid;
  const steps: Step[] = [
    {
      title: 'Class & students',
      short: 'Class & students',
      done: p.students > 0 && p.duplicateIds === 0,
      detail:
        p.duplicateIds > 0 ? (
          <span className="text-red-600">{p.duplicateIds} students share a Student ID. Fix the red ID cells.</span>
        ) : p.students > 0 ? (
          `${p.students} student${p.students === 1 ? '' : 's'} in this class`
        ) : (
          'Import the class list from Mastersoft or Excel, or add students by hand.'
        ),
      actions: actions.students,
    },
    {
      title: 'Assessment columns',
      short: 'Assessment columns',
      done: p.setupIssues.length === 0,
      detail: p.setupIssues.length === 0 ? `${p.csColumns} Class Standing · ${p.weColumns} Written Exam column${p.weColumns === 1 ? '' : 's'}` : p.setupIssues[0],
      actions: actions.columns,
    },
    {
      title: 'Enter scores',
      short: 'Enter scores',
      done: p.complete,
      detail:
        p.students === 0 || p.setupIssues.length > 0 ? (
          'Type or paste scores once students and columns are ready.'
        ) : (
          <>
            {p.ready + p.withStatus} of {p.students} done
            {p.missing > 0 && <span className="text-amber-700"> · {p.missing} with blanks</span>}
            {p.invalid > 0 && <span className="text-red-600"> · {p.invalid} to fix</span>}
          </>
        ),
      actions: toFix > 0 ? actions.scores : actions.scores.slice(1),
    },
    {
      title: 'Review & export',
      short: 'Review & export',
      done: false,
      detail: p.complete ? `Set Total Marks to Class Standing ${totals.cs} and Written Exam ${totals.we}, then upload or copy the marks.` : 'Ready once every student has a grade or a status.',
      actions: actions.encode,
    },
  ];
  const current = steps.findIndex((s) => !s.done);
  const [picked, setPicked] = useState<number | null>(null);
  // Any step can be opened at any time; the stepper only suggests where to go next.
  const shown = steps[picked ?? current] ?? steps[0]!;
  const shownIndex = steps.indexOf(shown);

  if (hidden) {
    return (
      <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600 shadow-sm">
        <span className="font-medium">
          Step {current + 1} of 4: {steps[current]?.title}
        </span>
        <button onClick={toggle} className="ml-auto flex items-center gap-1 text-slate-500 transition-colors duration-150 hover:text-brand">
          Show steps <ChevronDown className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <section aria-label="Encoding steps" className="mx-4 mt-3 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <ol className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
          {steps.map((s, i) => {
            const isCurrent = i === current;
            const isShown = i === shownIndex;
            return (
              <li key={s.title} aria-current={isCurrent ? 'step' : undefined} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden className={cn('hidden h-px w-5 sm:block', steps[i - 1]!.done ? 'bg-emerald-300' : 'bg-slate-200')} />}
                <button
                  type="button"
                  onClick={() => setPicked(i === current ? null : i)}
                  title={`${s.title}: ${isShown ? 'shown below' : 'click to see what to do'}`}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors duration-150',
                    isCurrent ? 'bg-brand font-semibold text-white' : s.done ? 'bg-emerald-50 font-medium text-emerald-800 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                    isShown && !isCurrent && 'ring-2 ring-brand/30',
                  )}
                >
                  {s.done ? <Check className={cn('size-3.5', isCurrent ? 'text-white' : 'text-emerald-600')} aria-label="Done" /> : null}
                  {i + 1}. {s.short}
                </button>
              </li>
            );
          })}
        </ol>
        <button onClick={toggle} className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-brand" title="Hide steps">
          Hide steps <ChevronUp className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">{shown.title}</span>
        <span>{shown.detail}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          {shown.actions.map((a, j) => (
            <Button key={a.label} size="sm" variant={j === 0 ? 'default' : 'outline'} className="h-7 px-2 text-xs" onClick={a.onClick}>
              {a.icon}
              {a.label}
            </Button>
          ))}
        </span>
      </div>
    </section>
  );
}