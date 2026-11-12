import { useEffect, useState } from 'react';
import { useActiveClass, useStore } from './app/store';
import { AllClassesOverview } from './components/AllClassesOverview';
import { BackupReminder } from './components/BackupReminder';
import { DemoBanner } from './components/DemoBanner';
import { BreakdownDrawer } from './components/BreakdownDrawer';
import { ClassDialog } from './components/ClassDialog';
import { ConfirmHost } from './components/ConfirmDialog';
import { MastersoftImportDialog } from './components/MastersoftDialogs';
import { ObeDashboard } from './components/ObeDashboard';
import { FinalRatingSummary } from './components/FinalRatingSummary';
import { PrivacyNotice } from './components/PrivacyNotice';
import { ReverseMode } from './components/ReverseMode';
import { SaveErrorBanner } from './components/SaveStatus';
import { Sidebar } from './components/Sidebar';
import { TermGradebook } from './components/TermGradebook';
import { TransmutationReference } from './components/TransmutationReference';
import { TrashNotice } from './components/TrashNotice';
import { Button } from './components/ui/button';

export function App() {
  const { loaded, noticeSeen, acceptNotice, load, view, loadDemoClass } = useStore();
  const active = useActiveClass();
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [newClass, setNewClass] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) return null;

  let content;
  if (view === 'TABLE') content = <TransmutationReference />;
  else if (view === 'OVERVIEW') content = <AllClassesOverview />;
  else if (!active)
    content = (
      <div className="m-auto w-full max-w-3xl px-6">
        <h2 className="text-xl font-semibold">Preview your Mastersoft grades before you encode</h2>
        <p className="mt-1 text-sm text-slate-500">Three steps per term. Everything stays in this browser.</p>
        <ol className="mt-6 grid grid-cols-3 gap-4">
          {[
            ['Bring in your class', "Import the student list from Mastersoft's Upload Grade Encoding file, or create a class by hand."],
            ['Enter scores', 'Add your Class Standing and Written Exam columns, then type, paste or import scores from Excel.'],
            ['Encode in Mastersoft', 'Copy the Total Marks, then upload the exported files or follow the printable Encoding Guide.'],
          ].map(([title, text], i) => (
            <li key={title} className="rounded-lg border border-slate-200 bg-white p-4">
              <span className="flex size-7 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">{i + 1}</span>
              <h3 className="mt-3 text-sm font-semibold">{title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex gap-2">
          <Button onClick={() => setImportOpen(true)}>Import from Mastersoft</Button>
          <Button variant="outline" onClick={() => setNewClass(true)}>
            Create a class by hand
          </Button>
          <Button variant="outline" onClick={loadDemoClass}>
            Load Sample Demo Class
          </Button>
        </div>
      </div>
    );
  else if (view === 'SUMMARY') content = <FinalRatingSummary record={active} />;
  else if (view === 'REVERSE') content = <ReverseMode record={active} />;
  else if (view === 'OBE') content = <ObeDashboard key={active.id} record={active} />;
  else content = <TermGradebook key={`${active.id}-${view}`} record={active} term={view} />;

  return (
    <div className="flex h-screen flex-col">
      <SaveErrorBanner />
      <BackupReminder />
      {active?.demo && <DemoBanner key={active.id} classId={active.id} />}
      <div className="flex min-h-0 flex-1">
        <Sidebar onPrivacy={() => setPrivacyOpen(true)} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{content}</main>
      </div>
      {active && <BreakdownDrawer record={active} />}
      <ClassDialog open={newClass} onOpenChange={setNewClass} />
      <ConfirmHost />
      <TrashNotice />
      <MastersoftImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <PrivacyNotice
        open={!noticeSeen || privacyOpen}
        firstLaunch={!noticeSeen}
        onContinue={() => {
          acceptNotice();
          setPrivacyOpen(false);
        }}
      />
    </div>
  );
}
