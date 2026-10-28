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
      title: 'Add students',
      short: 'Students',
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
      title: 'Set up columns',
      short: 'Columns',
      done: p.setupIssues.length === 0,
      detail: p.setupIssues.length === 0 ? `${p.csColumns} Class Standing · ${p.weColumns} Written Exam column${p.weColumns === 1 ? '' : 's'}` : p.setupIssues[0],
      actions: actions.columns,
    },
    {
      title: 'Enter scores',
      short: 'Scores',
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
      title: 'Encode in Mastersoft',
      short: 'Encode',
      done: false,
      detail: p.complete ? `Set Total Marks to CS ${totals.cs} and WE ${totals.we}, then upload or copy the marks.` : 'Ready once every student has a grade or a status.',
      actions: actions.encode,
    },
  ];
  const current = steps.findIndex((s) => !s.done);

  if (hidden) {
    return (
      <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-1.5 text-xs text-slate-600">
        <span className="font-medium">
          Step {current + 1} of 4: {steps[current]?.title}
        </span>
        <button onClick={toggle} className="ml-auto flex items-center gap-1 text-slate-500 hover:text-brand">
          Show steps <ChevronDown className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2">
      <ol className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1.5" aria-label="Encoding steps">
        {steps.map((s, i) => {
          const isCurrent = i === current;
          return (
            <li key={s.title} aria-current={isCurrent ? 'step' : undefined} className="flex flex-wrap items-center gap-2">
              <span
                title={s.title}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                  isCurrent ? 'bg-brand font-semibold text-white' : s.done ? 'text-slate-500' : 'text-slate-400',
                )}
              >
                {s.done && <Check className="size-3 text-emerald-600" aria-label="Done" />}
                {i + 1}. {s.short}
              </span>
              {isCurrent && (
                <>
                  <span className="text-xs text-slate-600">{s.detail}</span>
                  {s.actions.map((a, j) => (
                    <Button key={a.label} size="sm" variant={j === 0 ? 'default' : 'outline'} className="h-7 px-2 text-xs" onClick={a.onClick}>
                      {a.icon}
                      {a.label}
                    </Button>
                  ))}
                </>
              )}
            </li>
          );
        })}
      </ol>
      <button onClick={toggle} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand" title="Hide steps" aria-label="Hide steps">
        <ChevronUp className="size-4" />
      </button>
    </div>
  );
}
