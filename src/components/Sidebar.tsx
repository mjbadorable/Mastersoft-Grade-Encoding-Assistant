import { BookOpen, BookOpenCheck, Calculator, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, ClipboardList, FileUp, Keyboard, LayoutGrid, PanelLeftClose, PanelLeftOpen, Pencil, Plus, ShieldCheck, Table2, Target } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import pkg from '../../package.json';
import logo from '../assets/logo.png';
import logoMark from '../assets/logo-mark.png';
import { TERM_LABEL, termWeightLabel } from '../app/labels';
import { termProgress } from '../app/progress';
import { isLiveClass, useActiveClass, useStore } from '../app/store';
import type { ClassRecord, View } from '../app/types';
import { rules, TERMS, type Term } from '../engine';
import { cn } from '../lib/utils';
import { BackupRestore, sidebarRow, useNeedsBackup } from './BackupRestore';
import { ClassDialog } from './ClassDialog';
import { EncodingGuideDialog } from './EncodingGuide';
import { MastersoftImportDialog } from './MastersoftDialogs';
import { OfflineIndicator } from './OfflineStatus';
import { SaveIndicator } from './SaveStatus';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Button } from './ui/button';
import { Select } from './ui/input';

const COLLAPSED_KEY = 'sidebarCollapsed';
const HELP_OPEN_KEY = 'sidebarHelpOpen';
const WORKSPACE_OPEN_KEY = 'sidebarWorkspaceOpen';
const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

export function Sidebar({ onPrivacy }: { onPrivacy: () => void }) {
  const { classes, view, setView, selectClass } = useStore();
  const active = useActiveClass();
  // Archived and trashed classes stay out of the list; an archived class opened from the overview is shown so the selector isn't blank.
  const listed = classes.filter((c) => isLiveClass(c) || (c.id === active?.id && !c.deletedAt));
  const [dialog, setDialog] = useState<'new' | 'edit' | 'import' | null>(null);
  const [collapsed, setCollapsed] = useState(() => readFlag(COLLAPSED_KEY));
  const [helpOpen, setHelpOpen] = useState(() => readFlag(HELP_OPEN_KEY));
  const [workspaceOpen, setWorkspaceOpen] = useState(() => readFlag(WORKSPACE_OPEN_KEY));
  const needsBackup = useNeedsBackup();
  const [guideOpen, setGuideOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** The Encoding Guide is per term: the open term, or Prelim from any other screen. */
  const guideTerm: Term = (TERMS as readonly string[]).includes(view) ? (view as Term) : 'PRELIM';

  const remember = (key: string, open: boolean) => {
    try {
      localStorage.setItem(key, open ? '1' : '0');
    } catch {
      // Not saved; the section starts collapsed again next time.
    }
  };
  const toggleHelp = () => {
    setHelpOpen(!helpOpen);
    remember(HELP_OPEN_KEY, !helpOpen);
  };
  const toggleWorkspace = () => {
    setWorkspaceOpen(!workspaceOpen);
    remember(WORKSPACE_OPEN_KEY, !workspaceOpen);
  };

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // Not saved; the sidebar just opens again next time.
    }
  };

  // "[" toggles the sidebar, unless the teacher is typing or a dialog is open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.matches('input, textarea, select, [contenteditable]')) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      toggleCollapsed();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const item = (v: View, icon: ReactNode, label: ReactNode, enabled = !!active) => (
    <button
      key={v}
      onClick={() => setView(v)}
      disabled={!enabled}
      aria-current={view === v ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-100 disabled:opacity-50',
        (enabled || v === 'TABLE') && view === v && 'bg-brand/10 font-semibold text-brand shadow-[inset_3px_0_0_0_var(--color-brand)] hover:bg-brand/10',
      )}
    >
      {icon}
      {label}
    </button>
  );

  /** Collapsed rail: an icon with a tooltip, and a dot for term progress. */
  const railItem = (v: View, icon: ReactNode, label: string, enabled = !!active, dot?: ReactNode) => (
    <button
      key={v}
      onClick={() => setView(v)}
      disabled={!enabled}
      title={label}
      aria-label={label}
      aria-current={view === v ? 'page' : undefined}
      className={cn(
        'relative flex size-9 items-center justify-center rounded-md text-slate-700 transition-colors duration-150 hover:bg-slate-100 disabled:opacity-50',
        (enabled || v === 'TABLE') && view === v && 'bg-brand/10 text-brand hover:bg-brand/10',
      )}
    >
      {icon}
      {dot}
    </button>
  );

  if (collapsed) {
    const rail = 'size-4';
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white py-2">
        <img src={logoMark} alt="Mastersoft Grade Assistant" className="mb-1 size-9 rounded-lg" />
        <button
          onClick={toggleCollapsed}
          title="Expand sidebar ([)"
          aria-label="Expand sidebar"
          className="flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-brand"
        >
          <PanelLeftOpen className={rail} />
        </button>
        <button
          onClick={toggleCollapsed}
          disabled={!active}
          title={active ? `${[active.subjectCode, active.subjectName, active.section].filter(Boolean).join(' · ')}: click to open the sidebar and switch classes` : 'No class yet'}
          className="mb-1 max-w-12 truncate rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand hover:bg-brand/20 disabled:opacity-50"
        >
          {(active?.subjectCode || 'CLS').slice(0, 4)}
        </button>
        <nav className="flex flex-1 flex-col items-center gap-0.5">
          {railItem('OVERVIEW', <LayoutGrid className={rail} />, 'All classes overview', classes.length > 0)}
          {TERMS.map((t) =>
            railItem(t, <ClipboardList className={rail} />, `${TERM_LABEL[t]} (${termWeightLabel(t)})`, !!active, active && <TermDot record={active} term={t} />),
          )}
          {railItem('SUMMARY', <BookOpen className={rail} />, 'Final Rating summary')}
          {railItem('OBE', <Target className={rail} />, 'OBE Attainment')}
          <span className="my-1 h-px w-6 bg-slate-200" />
          {railItem('REVERSE', <Calculator className={rail} />, 'Final Rating Only')}
          {railItem('TABLE', <Table2 className={rail} />, 'Transmutation table')}
        </nav>
        <div className="flex flex-col items-center gap-0.5 border-t border-slate-200 pt-1">
          <SaveIndicator compact showIdle />
          <OfflineIndicator compact />
          <BackupRestore compact />
          <button
            onClick={() => {
              setHelpOpen(true);
              toggleCollapsed();
            }}
            title="Help: Encoding Guide, keyboard shortcuts (opens the sidebar)"
            aria-label="Help"
            className="flex size-9 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-brand"
          >
            <CircleHelp className={rail} />
          </button>
          <button onClick={onPrivacy} title="Data Privacy Notice" aria-label="Data Privacy Notice" className="flex size-9 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-brand">
            <ShieldCheck className={rail} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <img src={logo} alt="Mastersoft Grade Assistant: grade encoding made easy" className="h-12 w-auto min-w-0 object-contain object-left" />
        <button
          onClick={toggleCollapsed}
          title="Collapse sidebar ([)"
          aria-label="Collapse sidebar"
          className="shrink-0 rounded p-1 text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-brand"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>
      <div className="space-y-2 border-b border-slate-200 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">My classes</p>
        {listed.length > 0 && (
          <Select className="w-full" value={active?.id ?? ''} onChange={(e) => selectClass(e.target.value)} aria-label="Class">
            {listed.map((c) => (
              <option key={c.id} value={c.id}>
                {c.subjectCode || 'Untitled'}
                {c.section ? ` · ${c.section}` : ''}
                {c.archived ? ' (archived)' : ''}
              </option>
            ))}
          </Select>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => setDialog('new')}>
            <Plus /> New class
          </Button>
          {active && (
            <Button size="sm" variant="outline" onClick={() => setDialog('edit')} aria-label="Edit class">
              <Pencil />
            </Button>
          )}
        </div>
        <Button size="sm" variant="outline" className="w-full" onClick={() => setDialog('import')}>
          <FileUp /> Import from Mastersoft
        </Button>
      </div>

      <nav className="flex-1 space-y-0.5 p-2">
        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Gradebook</p>
        {item('OVERVIEW', <LayoutGrid className="size-4" />, 'All classes overview', classes.length > 0)}
        {TERMS.map((t) =>
          item(
            t,
            <ClipboardList className="size-4" />,
            <span className="flex flex-1 items-center justify-between gap-2">
              {TERM_LABEL[t]}
              <span className="flex items-center gap-1.5">
                {active && <TermMark record={active} term={t} />}
                <span className="text-xs font-normal text-slate-400">{termWeightLabel(t)}</span>
              </span>
            </span>,
          ),
        )}
        {item('SUMMARY', <BookOpen className="size-4" />, 'Final Rating summary')}
        {item('OBE', <Target className="size-4" />, 'OBE Attainment')}
        <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tools</p>
        {item('REVERSE', <Calculator className="size-4" />, 'Final Rating Only')}
        {item('TABLE', <Table2 className="size-4" />, 'Transmutation table')}
      </nav>

      <div className="sticky bottom-0 mt-auto space-y-1 border-t border-slate-200 bg-slate-50 p-2">
        <div className="flex flex-wrap items-center gap-2 px-2 py-1" aria-label="Status">
          <SaveIndicator showIdle />
          <OfflineIndicator />
        </div>

        <FooterSection title="Workspace & backup" open={workspaceOpen} onToggle={toggleWorkspace} badge={needsBackup && !workspaceOpen ? 'Due' : undefined}>
          <BackupRestore />
          <button onClick={onPrivacy} className={sidebarRow}>
            <ShieldCheck className="size-4" /> Data Privacy Notice
          </button>
        </FooterSection>

        <FooterSection title="Help" open={helpOpen} onToggle={toggleHelp}>
          {active && (
            <button onClick={() => setGuideOpen(true)} className={sidebarRow}>
              <BookOpenCheck className="size-4" /> Encoding Guide
            </button>
          )}
          <button onClick={() => setShortcutsOpen(true)} className={sidebarRow}>
            <Keyboard className="size-4" /> Keyboard shortcuts
          </button>
          <p className="px-3 pb-1 pt-1 text-[11px] text-slate-400" title="App version · version of the Mastersoft rules file">
            v{pkg.version} · Rules v{rules.version}
          </p>
        </FooterSection>
      </div>


      {active && <EncodingGuideDialog record={active} term={guideTerm} open={guideOpen} onOpenChange={setGuideOpen} />}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <MastersoftImportDialog open={dialog === 'import'} onOpenChange={(o) => !o && setDialog(null)} />
      <ClassDialog open={dialog === 'new' || dialog === 'edit'} onOpenChange={(o) => !o && setDialog(null)} record={dialog === 'edit' ? (active ?? undefined) : undefined} />
    </aside>
  );
}

/** Corner dot on a collapsed term button: green when all scores are in, amber while students still need scores. */
function TermDot({ record, term }: { record: ClassRecord; term: Term }) {
  const p = termProgress(record, term);
  const left = p.missing + p.invalid;
  if (!p.complete && (p.setupIssues.length > 0 || left === 0)) return null;
  return (
    <span
      aria-hidden
      className={cn('absolute right-1 top-1 size-2 rounded-full ring-2 ring-white', p.complete ? 'bg-emerald-500' : 'bg-amber-500')}
    />
  );
}

/** Green check when a term is done; amber count of students still needing scores. */
function TermMark({ record, term }: { record: ClassRecord; term: Term }) {
  const p = termProgress(record, term);
  if (p.complete) return <CheckCircle2 className="size-3.5 text-emerald-600" aria-label="All scores in" />;
  const left = p.missing + p.invalid;
  if (p.setupIssues.length > 0 || left === 0) return null;
  return (
    <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800" title={`${left} student(s) still need scores`}>
      {left}
    </span>
  );
}

/** Footer accordion: a quiet header with a chevron; `badge` stays visible while the section is folded. */
function FooterSection({ title, open, onToggle, badge, children }: { title: string; open: boolean; onToggle: () => void; badge?: string; children: ReactNode }) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700"
      >
        <span>{title}</span>
        {badge && <span className="rounded-full bg-amber-100 px-2 py-px text-[10px] font-semibold normal-case tracking-normal text-amber-800">{badge}</span>}
        {open ? <ChevronDown className="ml-auto size-3.5" /> : <ChevronRight className="ml-auto size-3.5" />}
      </button>
      {open && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </div>
  );
}
