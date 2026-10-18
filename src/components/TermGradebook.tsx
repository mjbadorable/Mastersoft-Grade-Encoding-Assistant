import { AlertTriangle, BookOpenCheck, Check, Copy, Crosshair, FileDown, FileSpreadsheet, FileUp, Keyboard, Plus, SlidersHorizontal, UserPlus } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { assessmentTotals, termSetupIssues } from '../app/gradebook';
import { SUBJECT_TYPES, subjectTypeLabel, TERM_LABEL, termWeightLabel } from '../app/labels';
import { nextProblem, termProgress, type TermProgress } from '../app/progress';
import { useStore } from '../app/store';
import type { ClassRecord, Column, Component, CsMode } from '../app/types';
import { withCarryForward, type SubjectType, type Term } from '../engine';
import { CategoriesDialog, ColumnDialog } from './ColumnDialogs';
import { EncodingGuideDialog } from './EncodingGuide';
import { ExcelImportDialog } from './ExcelImportDialog';
import { focusGridCell, GradebookGrid, lastFocusedCell } from './GradebookGrid';
import { MastersoftExportDialog, MastersoftImportDialog } from './MastersoftDialogs';
import { Button } from './ui/button';
import { Select } from './ui/input';
import { WorkflowGuide } from './WorkflowGuide';

export function TermGradebook({ record, term }: { record: ClassRecord; term: Term }) {
  const { updateClassInfo, setCsMode, addStudent, setView } = useStore();
  const setup = record.terms[term];
  const [columnDialog, setColumnDialog] = useState<Column | 'new' | null>(null);
  const [newComponent, setNewComponent] = useState<Component>('CS');
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [mastersoftOpen, setMastersoftOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const weighted = setup.csMode === 'WEIGHTED_CATEGORIES';
  const progress = useMemo(() => termProgress(record, term), [record, term]);
  const totals = assessmentTotals(setup);

  const addColumn = (component: Component = 'CS') => {
    setNewComponent(component);
    setColumnDialog('new');
  };
  const addStudentAndFocus = () => {
    addStudent();
    setTimeout(() => focusGridCell(record.students.length, 0));
  };
  /** Grid cells each status-bar button cycles through, in grid order (column = grid column). */
  const targets = useMemo(() => {
    const cell = (row: number, column: number, focus: number | 'status' = column): JumpTarget => ({ row, column, focus });
    const problems = (kinds: string[]) => progress.problems.filter((p) => kinds.includes(p.kind)).map((p) => cell(p.row, p.column + 2));
    return {
      graded: progress.readyRows.map((row) => cell(row, 1)),
      status: progress.statusRows.map((row) => cell(row, 1, 'status')),
      blank: problems(['blank']),
      invalid: problems(['invalid']),
      duplicate: problems(['duplicate']),
      all: problems(['blank', 'invalid', 'duplicate']),
    } satisfies Record<JumpKind, JumpTarget[]>;
  }, [progress]);
  /** Jumps to the next cell of this kind after the one the teacher is on, and flashes its row. */
  const jump = (kind: JumpKind) => {
    const last = lastFocusedCell();
    const t = nextProblem(targets[kind], last && { row: last.row, column: last.col });
    if (t) focusGridCell(t.row, t.focus, true);
  };
  const goToNextProblem = () => jump('all');

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <h2 className="mr-1 text-base font-semibold">
          {TERM_LABEL[term]} Gradebook <span className="text-sm font-normal text-slate-400">({termWeightLabel(term)} of FR)</span>
        </h2>
        <Select
          aria-label="Subject type"
          title="Subject type: sets the CS / WE weightage"
          value={record.subjectType}
          onChange={(e) => updateClassInfo({ ...record, subjectType: e.target.value as SubjectType })}
          className="h-8 rounded-full bg-slate-50 text-xs font-medium"
        >
          {SUBJECT_TYPES.map((t) => (
            <option key={t} value={t}>
              {subjectTypeLabel(t)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Class Standing mode"
          title="How Class Standing columns are combined"
          value={setup.csMode}
          onChange={(e) => setCsMode(term, e.target.value as CsMode)}
          className="h-8 rounded-full bg-slate-50 text-xs font-medium"
        >
          <option value="RAW_SUM">CS: Raw sum (Mastersoft default)</option>
          <option value="WEIGHTED_CATEGORIES">CS: Weighted categories</option>
        </Select>
        {weighted && (
          <Button size="sm" variant="outline" onClick={() => setCategoriesOpen(true)}>
            <SlidersHorizontal /> Categories ({setup.categories.length})
          </Button>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <FileUp /> Import Excel
          </Button>
          <Button size="sm" variant="outline" onClick={addStudentAndFocus}>
            <UserPlus /> Add student
          </Button>
          <Button size="sm" onClick={() => addColumn()}>
            <Plus /> Add column
          </Button>
        </div>
      </div>

      <WorkflowGuide
        progress={progress}
        totals={totals}
        actions={{
          students: [
            { label: 'Mastersoft list', icon: <FileSpreadsheet />, onClick: () => setMastersoftOpen(true) },
            { label: 'Excel', icon: <FileUp />, onClick: () => setImportOpen(true) },
            { label: 'Type in', icon: <UserPlus />, onClick: addStudentAndFocus },
          ],
          columns: [
            { label: 'Add CS column', icon: <Plus />, onClick: () => addColumn('CS') },
            { label: 'Add WE column', icon: <Plus />, onClick: () => addColumn('WE') },
            ...(weighted ? [{ label: 'Categories', icon: <SlidersHorizontal />, onClick: () => setCategoriesOpen(true) }] : []),
          ],
          scores: [
            { label: 'Go to next blank', icon: <Crosshair />, onClick: goToNextProblem },
            { label: 'Import Excel', icon: <FileUp />, onClick: () => setImportOpen(true) },
          ],
          encode: [
            { label: 'Export for Mastersoft', icon: <FileDown />, onClick: () => setExportOpen(true) },
            { label: 'Encoding guide', icon: <BookOpenCheck />, onClick: () => setGuideOpen(true) },
          ],
        }}
      />

      <AssessmentBanner record={record} term={term}>
        <Button size="sm" variant="outline" onClick={() => setGuideOpen(true)}>
          <BookOpenCheck /> Encoding guide
        </Button>
        <Button size="sm" variant={progress.complete ? 'default' : 'outline'} onClick={() => setExportOpen(true)}>
          <FileDown /> Export for Mastersoft
        </Button>
      </AssessmentBanner>

      <GradebookGrid
        record={record}
        term={term}
        onEditColumn={setColumnDialog}
        onAddColumn={addColumn}
        onAddStudent={addStudentAndFocus}
        onImportMastersoft={() => setMastersoftOpen(true)}
        onImportExcel={() => setImportOpen(true)}
      />

      <StatusBar progress={progress} record={record} term={term} targets={targets} onJump={jump} onSummary={() => setView('SUMMARY')} />

      <ColumnDialog
        term={term}
        setup={setup}
        column={columnDialog}
        defaultComponent={newComponent}
        onClose={() => setColumnDialog(null)}
        hasScores={(id) => record.students.some((s) => (s.scores[id] ?? '').trim() !== '')}
      />
      <MastersoftImportDialog open={mastersoftOpen} onOpenChange={setMastersoftOpen} />
      <ExcelImportDialog term={term} open={importOpen} onOpenChange={setImportOpen} />
      <EncodingGuideDialog record={record} term={term} open={guideOpen} onOpenChange={setGuideOpen} />
      <MastersoftExportDialog record={record} term={term} open={exportOpen} onOpenChange={setExportOpen} />
      <CategoriesDialog term={term} setup={setup} open={categoriesOpen} onOpenChange={setCategoriesOpen} />
    </>
  );
}

/** Spreadsheet-style status bar: progress, a jump to the next problem, and how-to tips. */
type JumpKind = 'graded' | 'status' | 'blank' | 'invalid' | 'duplicate' | 'all';
interface JumpTarget {
  row: number;
  column: number;
  focus: number | 'status';
}

interface StatusBarProps {
  progress: TermProgress;
  record: ClassRecord;
  term: Term;
  targets: Record<JumpKind, JumpTarget[]>;
  onJump: (kind: JumpKind) => void;
  onSummary: () => void;
}

function StatusBar({ progress: p, record, term, targets, onJump, onSummary }: StatusBarProps) {
  const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium transition hover:ring-2 hover:ring-current/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/50';
  /** Tooltip listing who a button points to. */
  const who = (kind: JumpKind, heading: string) => {
    const names = [...new Set(targets[kind].map((t) => t.row))].map((r) => {
      const s = record.students[r]!;
      const name = s.name || s.studentId || `Row ${r + 1}`;
      const status = kind === 'status' ? withCarryForward(s.statuses)[term] : undefined;
      return status ? `${name} (${status})` : name;
    });
    const list = names.slice(0, 12).join(', ') + (names.length > 12 ? `, and ${names.length - 12} more` : '');
    return `${heading}: ${list}. Click to go to the next one.`;
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-600">
      {p.students > 0 && p.setupIssues.length === 0 ? (
        <>
          <button className={`${chip} bg-emerald-50 text-emerald-800`} onClick={() => onJump('graded')} disabled={p.ready === 0} title={who('graded', 'Graded')}>
            <Check className="size-3" /> {p.ready} graded
          </button>
          {p.withStatus > 0 && (
            <button className={`${chip} bg-brand/10 text-brand`} onClick={() => onJump('status')} title={who('status', 'With a status (INC, ABS, HNA, DRP or WP)')}>
              {p.withStatus} with status
            </button>
          )}
          {p.missing > 0 && (
            <button className={`${chip} bg-amber-50 text-amber-800`} onClick={() => onJump('blank')} title={who('blank', 'Blank scores')}>
              {p.missing} with blanks
            </button>
          )}
          {p.invalid > 0 && (
            <button className={`${chip} bg-red-50 text-red-700`} onClick={() => onJump('invalid')} title={who('invalid', 'Scores to fix')}>
              {p.invalid} to fix
            </button>
          )}
          {p.duplicateIds > 0 && (
            <button className={`${chip} bg-red-50 text-red-700`} onClick={() => onJump('duplicate')} title={who('duplicate', 'Same Student ID')}>
              {p.duplicateIds} with a duplicate ID
            </button>
          )}
          {p.problems.length > 0 ? (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-brand" onClick={() => onJump('all')}>
              <Crosshair className="size-3.5" /> Next blank or error
            </Button>
          ) : (
            p.complete && (
              <button onClick={onSummary} className="text-emerald-700 underline-offset-2 hover:underline">
                All done for this term. See the Final Rating summary →
              </button>
            )
          )}
        </>
      ) : (
        <span>Follow the steps above to start.</span>
      )}
      <span className="ml-auto flex items-center gap-1.5 text-slate-400">
        <Keyboard className="size-3.5" />
        Enter or ↓ next row · ← → move · paste a block from Excel · click a grade for its breakdown
      </span>
    </div>
  );
}

/** Mirrors Mastersoft's Assessment Component screen: the Total Marks to encode. */
function AssessmentBanner({ record, term, children }: { record: ClassRecord; term: Term; children?: ReactNode }) {
  const setup = record.terms[term];
  const totals = assessmentTotals(setup);
  const issues = termSetupIssues(setup);
  return (
    <div className="border-b border-slate-200 bg-surface px-4 py-3">
      <div className="flex flex-wrap items-stretch gap-3">
        <div className="flex items-center text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-500">
          Mastersoft
          <br />
          Assessment Component
        </div>
        <TotalCard label={`${TERM_LABEL[term]} – Class Standing`} value={totals.cs} note={setup.csMode === 'WEIGHTED_CATEGORIES' ? 'Weighted categories: always 100' : undefined} />
        <TotalCard label={`${TERM_LABEL[term]} – Written Exam`} value={totals.we} />
        {issues.length > 0 && (
          <div className="flex min-w-64 flex-1 items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <ul className="space-y-0.5">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        )}
        {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

function TotalCard({ label, value, note }: { label: string; value: number | null; note?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (value === null) return;
    void navigator.clipboard?.writeText(String(value)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div>
        <div className="text-xs font-medium text-slate-600">{label}</div>
        <div className="text-[11px] text-slate-400">{note ?? 'Total Marks'}</div>
      </div>
      <div className="tabular text-2xl font-semibold text-slate-900" aria-label={`${label} Total Marks`}>
        {value ?? '—'}
      </div>
      {value !== null && (
        <Button variant="ghost" size="icon" onClick={copy} aria-label={`Copy ${label} Total Marks`} title="Copy">
          {copied ? <Check className="text-emerald-600" /> : <Copy />}
        </Button>
      )}
    </div>
  );
}
