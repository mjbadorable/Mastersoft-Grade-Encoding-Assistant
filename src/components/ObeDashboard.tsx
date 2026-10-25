import { AlertTriangle, Download, FileUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { TERM_LABEL } from '../app/labels';
import { nextOutcomeCode, obeReport, vpaaFileName, vpaaForRecord, vpaaWorkbook } from '../app/obe';
import { useStore } from '../app/store';
import { obeConfigFromExtraction, readSyllabusFile, SYLLABUS_FILE_TYPES } from '../app/syllabusReader';
import type { ClassRecord } from '../app/types';
import {
  OBE_PASS_RAW_PCT,
  OBE_PRESETS,
  OBE_SCOPES,
  OBE_TARGET_CLASS_PCT,
  poRollup,
  TERMS,
  type AgaCode,
  type ClassOutcomeSummary,
  type ObeConfig,
  type ObePresetKey,
  type ObeReport,
  type ObeScope,
} from '../engine';
import { downloadFile, XLSX_TYPE } from '../lib/download';
import { cn } from '../lib/utils';
import { confirmAction } from './ConfirmDialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input, Select } from './ui/input';

type Tab = 'MATRIX' | 'PO' | 'VPAA' | 'SETUP';
const TABS: { id: Tab; label: string }[] = [
  { id: 'MATRIX', label: 'Student CLO diagnostic' },
  { id: 'PO', label: 'Program Outcomes & CQI' },
  { id: 'VPAA', label: 'VPAA official sheet' },
  { id: 'SETUP', label: 'Syllabus CO / LO / PO setup' },
];
const SCOPE_LABEL: Record<ObeScope, string> = { ...TERM_LABEL, OVERALL: 'Overall (FR)' };

const th = 'border-b border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs font-semibold text-slate-600';
const td = 'border-b border-slate-200 px-3 py-1.5';

/** OBE attainment from the tagged gradebook columns (docs/06 Prompt B). */
export function ObeDashboard({ record }: { record: ClassRecord }) {
  const obe = record.obe;
  const [tab, setTab] = useState<Tab>(obe ? 'MATRIX' : 'SETUP');
  const [scope, setScope] = useState<ObeScope>('OVERALL');
  const report = useMemo(() => obeReport(record), [record]);
  const shown = obe && report ? tab : 'SETUP';

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <h2 className="mr-2 text-base font-semibold">OBE Attainment</h2>
        <div role="tablist" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={shown === t.id}
              disabled={!obe && t.id !== 'SETUP'}
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40',
                shown === t.id && 'bg-brand/10 text-brand hover:bg-brand/10',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {(shown === 'MATRIX' || shown === 'PO') && (
          <Select aria-label="Period" value={scope} onChange={(e) => setScope(e.target.value as ObeScope)} className="ml-auto h-8 text-xs">
            {OBE_SCOPES.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABEL[s]}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white">
        {shown === 'SETUP' || !obe || !report ? (
          <SetupTab obe={obe} />
        ) : shown === 'MATRIX' ? (
          <MatrixTab record={record} obe={obe} report={report} scope={scope} />
        ) : shown === 'PO' ? (
          <PoTab obe={obe} report={report} scope={scope} />
        ) : (
          <VpaaTab record={record} obe={obe} />
        )}
      </div>
    </>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-xs text-slate-500">{children}</p>;
}

// ---- 1. Student CLO diagnostic matrix ----

function MatrixTab({ record, obe, report, scope }: { record: ClassRecord; obe: ObeConfig; report: ObeReport; scope: ObeScope }) {
  const openDrawer = useStore((s) => s.openDrawer);
  const [lackingOnly, setLackingOnly] = useState(false);
  const rows = record.students
    .map((s, i) => ({ s, i, r: report.students[i]!.scopes[scope] }))
    .filter(({ r }) => !lackingOnly || r.lackingCoCodes.length > 0 || r.lackingLoCodes.length > 0);
  const untagged = TERMS.every((t) => record.terms[t].columns.every((c) => !c.coIds?.length));

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 px-4 py-2 text-xs text-slate-600">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" className="accent-brand" checked={lackingOnly} onChange={(e) => setLackingOnly(e.target.checked)} />
          Only show students lacking CLOs
        </label>
        <span className="text-slate-400">
          Attained = raw score ≥ the CO's pass mark (default {OBE_PASS_RAW_PCT}%, which transmutes to 75). Click a name for the breakdown.
        </span>
      </div>
      {untagged && <Note>No gradebook column is tagged with a CO yet. Edit a column in a term gradebook and pick its COs and LOs.</Note>}
      <table className="tabular w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0">
          <tr>
            <th className={cn(th, 'w-10')}>#</th>
            <th className={th}>Student</th>
            {obe.cos.map((c) => (
              <th key={c.id} className={cn(th, 'text-right')} title={c.description}>
                {c.code}
              </th>
            ))}
            <th className={cn(th, 'text-right')}>CLOs attained</th>
            <th className={th}>Lacking LOs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ s, i, r }) => {
            const graded = obe.cos.filter((c) => r.cos[c.id]!.attained !== null);
            const attained = graded.filter((c) => r.cos[c.id]!.attained);
            return (
              <tr key={s.id}>
                <td className={cn(td, 'text-xs text-slate-500')}>{i + 1}</td>
                <td className={cn(td, 'whitespace-nowrap')}>
                  <button
                    className="text-left hover:text-brand hover:underline"
                    onClick={() => openDrawer({ studentId: s.id, term: scope === 'OVERALL' ? 'FINAL' : scope })}
                  >
                    {s.name || 'Unnamed student'}
                    <span className="ml-2 text-xs text-slate-400">{s.studentId}</span>
                  </button>
                </td>
                {obe.cos.map((c) => {
                  const a = r.cos[c.id]!;
                  return (
                    <td key={c.id} className={cn(td, 'whitespace-nowrap text-right')} title={a.lowColumns.length ? `Below the pass mark in ${a.lowColumns.join(', ')}` : undefined}>
                      {a.rawPct === null ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          {a.rawPct.toFixed(2)}%<Badge variant={a.attained ? 'green' : 'red'}>{a.attained ? 'Attained' : 'Lacking'}</Badge>
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className={cn(td, 'text-right')}>{graded.length === 0 ? '—' : `${attained.length} / ${graded.length}`}</td>
                <td className={cn(td, 'text-xs text-red-700')}>{r.lackingLoCodes.join(', ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <Note>{lackingOnly ? 'No student is lacking a CLO in this period.' : 'No students in this class yet.'}</Note>}
    </>
  );
}

// ---- 2. Program outcomes and CHED CQI ----

function Bar({ label, title, pct, target }: { label: string; title?: string; pct: number | null; target?: number }) {
  const below = pct !== null && target !== undefined && pct < target;
  return (
    <div className="grid grid-cols-[5rem_1fr_6rem] items-center gap-3 text-sm" title={title}>
      <span className="font-medium">{label}</span>
      <div className="relative h-3 rounded-full bg-slate-100">
        {pct !== null && <div className={cn('h-3 rounded-full', below ? 'bg-red-500' : 'bg-emerald-500')} style={{ width: `${pct}%` }} />}
        {target !== undefined && <div className="absolute -top-1 h-5 w-0.5 bg-slate-700" style={{ left: `${target}%` }} title={`Target ${target}%`} />}
      </div>
      <span className="tabular text-right text-xs text-slate-600">{pct === null ? 'No scores' : `${pct}%`}</span>
    </div>
  );
}

function PoTab({ obe, report, scope }: { obe: ObeConfig; report: ObeReport; scope: ObeScope }) {
  const cos = report.classCos[scope];
  const pos = poRollup(obe, cos);
  const alerts: ClassOutcomeSummary[] = [...cos, ...report.classLos[scope]].filter((s) => s.cqiFlag);
  const description = (s: ClassOutcomeSummary) => [...obe.cos, ...obe.los].find((o) => o.id === s.id)?.description;
  return (
    <div className="grid max-w-4xl gap-6 p-4">
      <section>
        <h3 className="mb-1 text-sm font-semibold">Course outcomes · {SCOPE_LABEL[scope]}</h3>
        <p className="mb-3 text-xs text-slate-500">% of graded students at or above the CO's pass mark. The black line is the class target.</p>
        <div className="grid gap-2">
          {cos.map((c) => (
            <Bar key={c.id} label={c.code} title={description(c)} pct={c.attainmentPct} target={c.targetClassPct} />
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-1 text-sm font-semibold">Program outcomes</h3>
        <p className="mb-3 text-xs text-slate-500">Average class attainment of the COs linked to each PO.</p>
        <div className="grid gap-2">
          {pos.map((p) => (
            <Bar
              key={p.poId}
              label={`PO ${p.code}`}
              title={p.mapped ? `Linked: ${p.linkedCoCodes.join(', ')}` : 'No CO links to this PO'}
              pct={p.mapped ? p.attainmentPct : null}
            />
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">CQI action needed</h3>
        {alerts.length === 0 ? (
          <p className="text-xs text-emerald-700">Every graded CO and LO meets its class target in this period.</p>
        ) : (
          <ul className="grid gap-1.5">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  <strong>{a.code}</strong>: {a.attainedCount} of {a.totalGraded} students attained ({a.attainmentPct}%), below the {a.targetClassPct}% target. Mean raw score{' '}
                  {a.meanRawPct}%.{description(a) && ` ${description(a)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---- 3. VPAA official sheet ----

function VpaaTab({ record, obe }: { record: ClassRecord; obe: ObeConfig }) {
  const sheet = useMemo(() => vpaaForRecord(record, obe), [record, obe]);
  const download = () => downloadFile(vpaaWorkbook(record, obe) as BlobPart, vpaaFileName(record), XLSX_TYPE);
  const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}%`);
  return (
    <div className="grid gap-6 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-slate-500">
          VPAA formula: CO weight = its LOs ÷ all LOs; contribution = Final Rating × CO weight; Attained when the Final Rating is 75 or higher.
        </p>
        <Button size="sm" className="ml-auto" onClick={download}>
          <Download /> Download VPAA OBE Excel (.xlsx)
        </Button>
      </div>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Relationship of lessons/module and the course outcomes</h3>
        <table className="tabular w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={th}>Module</th>
              <th className={th}>Term</th>
              {obe.cos.map((c) => (
                <th key={c.id} className={th}>
                  {c.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.modules.map((m) => (
              <tr key={m.moduleCode}>
                <td className={cn(td, 'font-medium')}>{m.moduleCode}</td>
                <td className={td}>{TERM_LABEL[m.term]}</td>
                {obe.cos.map((c) => (
                  <td key={c.id} className={cn(td, 'text-xs')}>
                    {m.loCodesByCo[c.id]!.join(', ')}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={td} colSpan={2}>
                No. of LOs ({sheet.totalLos})
              </td>
              {sheet.weights.map((w) => (
                <td key={w.coId} className={td}>
                  {w.loCount} · {pct(w.weight * 100)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">CO contribution per student</h3>
        <table className="tabular w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={cn(th, 'w-10')}>#</th>
              <th className={th}>Student</th>
              <th className={cn(th, 'text-right')}>Final Grade</th>
              {obe.cos.map((c) => (
                <th key={c.id} className={cn(th, 'text-right')}>
                  {c.code}
                </th>
              ))}
              <th className={th}>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {sheet.students.map((row, i) => {
              const s = record.students[i]!;
              return (
                <tr key={s.id}>
                  <td className={cn(td, 'text-xs text-slate-500')}>{i + 1}</td>
                  <td className={td}>
                    {s.name || 'Unnamed student'}
                    <span className="ml-2 text-xs text-slate-400">{s.studentId}</span>
                  </td>
                  <td className={cn(td, 'text-right')}>{row.finalGrade ?? '—'}</td>
                  {obe.cos.map((c) => (
                    <td key={c.id} className={cn(td, 'text-right')}>
                      {row.contributions?.[c.id]?.toFixed(2) ?? '—'}
                    </td>
                  ))}
                  <td className={td}>
                    {row.attained === null ? (
                      <span className="text-xs text-slate-400">No Final Rating yet</span>
                    ) : (
                      <Badge variant={row.attained ? 'green' : 'red'}>{row.attained ? 'Attained' : 'Not Attained'}</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <dl className="mt-3 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
          <dt>No. of students attained</dt>
          <dd className="tabular text-right">{sheet.summary.attainedCount}</dd>
          <dt>% students attained CO</dt>
          <dd className="tabular text-right">{pct(sheet.summary.attainedPct)}</dd>
          <dt>No. of students not attained</dt>
          <dd className="tabular text-right">{sheet.summary.notAttainedCount}</dd>
          <dt>% students not attained CO</dt>
          <dd className="tabular text-right">{pct(sheet.summary.notAttainedPct)}</dd>
        </dl>
      </section>
    </div>
  );
}

// ---- 4. Syllabus setup ----

const AGAS: AgaCode[] = ['A', 'B', 'C'];
const EMPTY: ObeConfig = { pos: [], cos: [], los: [] };

function Pill({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 text-[11px] font-medium',
        on ? 'border-brand bg-brand/10 text-brand' : 'border-slate-300 text-slate-500 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
const num = (text: string) => {
  const n = Number(text);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
};

function SetupTab({ obe }: { obe: ObeConfig | undefined }) {
  const setObeConfig = useStore((s) => s.setObeConfig);
  const config = obe ?? EMPTY;
  const save = (patch: Partial<ObeConfig>) => setObeConfig({ ...config, ...patch });

  const loadPreset = async (key: ObePresetKey) => {
    const preset = OBE_PRESETS[key];
    if (
      obe &&
      !(await confirmAction({
        title: `Load ${preset.name}?`,
        message: "This replaces the class's COs, LOs and POs. Column tags that point to outcomes not in the preset will stop counting.",
        confirmLabel: 'Load preset',
      }))
    ) {
      return;
    }
    setObeConfig(preset.config);
  };

  const renamePo = (id: string, code: string) => {
    const old = config.pos.find((p) => p.id === id)!.code;
    save({
      pos: config.pos.map((p) => (p.id === id ? { ...p, code } : p)),
      cos: config.cos.map((c) => ({ ...c, poCodes: c.poCodes.map((pc) => (pc === old ? code : pc)) })),
    });
  };

  return (
    <div className="grid gap-6 p-4">
      <SyllabusReader obe={obe} />
      <section className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-600">Or load a syllabus preset:</span>
        {(Object.keys(OBE_PRESETS) as ObePresetKey[]).map((k) => (
          <Button key={k} size="sm" variant="outline" onClick={() => void loadPreset(k)}>
            {OBE_PRESETS[k].name}
          </Button>
        ))}
      </section>

      <section className="grid max-w-3xl grid-cols-2 gap-3">
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          College
          <Input value={config.collegeName ?? ''} onChange={(e) => save({ collegeName: e.target.value })} placeholder="College of Business" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Program
          <Input value={config.programName ?? ''} onChange={(e) => save({ programName: e.target.value })} placeholder="BS Hospitality Management" />
        </label>
      </section>

      <section className="overflow-x-auto">
        <h3 className="mb-2 text-sm font-semibold">Course outcomes (CO / CLO)</h3>
        <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={cn(th, 'w-24')}>Code</th>
              <th className={th}>Description</th>
              <th className={th}>AGA</th>
              <th className={th}>PO links</th>
              <th className={cn(th, 'w-24')} title="A student attains the CO at this raw %">
                Pass raw %
              </th>
              <th className={cn(th, 'w-24')} title="CQI target: % of students who must attain the CO">
                Class target %
              </th>
              <th className={cn(th, 'w-10')} />
            </tr>
          </thead>
          <tbody>
            {config.cos.map((c) => {
              const set = (patch: Partial<typeof c>) => save({ cos: config.cos.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) });
              return (
                <tr key={c.id}>
                  <td className={td}>
                    <Input value={c.code} onChange={(e) => set({ code: e.target.value })} className="h-8" aria-label="CO code" />
                  </td>
                  <td className={td}>
                    <Input value={c.description} onChange={(e) => set({ description: e.target.value })} className="h-8" aria-label={`${c.code} description`} />
                  </td>
                  <td className={td}>
                    <div className="flex gap-1">
                      {AGAS.map((a) => (
                        <Pill key={a} on={c.agaCodes.includes(a)} onClick={() => set({ agaCodes: toggle(c.agaCodes, a) })}>
                          {a}
                        </Pill>
                      ))}
                    </div>
                  </td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1">
                      {config.pos.map((p) => (
                        <Pill key={p.id} title={p.description} on={c.poCodes.includes(p.code)} onClick={() => set({ poCodes: toggle(c.poCodes, p.code) })}>
                          {p.code}
                        </Pill>
                      ))}
                    </div>
                  </td>
                  <td className={td}>
                    <Input type="number" value={c.passRawPct} onChange={(e) => set({ passRawPct: num(e.target.value) })} className="tabular h-8" aria-label={`${c.code} pass raw %`} />
                  </td>
                  <td className={td}>
                    <Input
                      type="number"
                      value={c.targetClassPct}
                      onChange={(e) => set({ targetClassPct: num(e.target.value) })}
                      className="tabular h-8"
                      aria-label={`${c.code} class target %`}
                    />
                  </td>
                  <td className={td}>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${c.code}`}
                      onClick={() =>
                        save({ cos: config.cos.filter((x) => x.id !== c.id), los: config.los.map((l) => ({ ...l, coIds: l.coIds.filter((id) => id !== c.id) })) })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() =>
            save({
              cos: [
                ...config.cos,
                {
                  id: crypto.randomUUID(),
                  code: nextOutcomeCode('CO', config.cos.map((c) => c.code)),
                  description: '',
                  agaCodes: [],
                  poCodes: [],
                  passRawPct: OBE_PASS_RAW_PCT,
                  targetClassPct: OBE_TARGET_CLASS_PCT,
                },
              ],
            })
          }
        >
          <Plus /> Add CO
        </Button>
      </section>

      <section className="overflow-x-auto">
        <h3 className="mb-2 text-sm font-semibold">Learning outcomes (LO) per module</h3>
        <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={cn(th, 'w-28')}>Code</th>
              <th className={cn(th, 'w-20')}>Module</th>
              <th className={cn(th, 'w-28')}>Term</th>
              <th className={th}>COs</th>
              <th className={th}>Description</th>
              <th className={cn(th, 'w-10')} />
            </tr>
          </thead>
          <tbody>
            {config.los.map((l) => {
              const set = (patch: Partial<typeof l>) => save({ los: config.los.map((x) => (x.id === l.id ? { ...x, ...patch } : x)) });
              return (
                <tr key={l.id}>
                  <td className={td}>
                    <Input value={l.code} onChange={(e) => set({ code: e.target.value })} className="h-8" aria-label="LO code" />
                  </td>
                  <td className={td}>
                    <Input value={l.moduleCode} onChange={(e) => set({ moduleCode: e.target.value })} className="h-8" aria-label={`${l.code} module`} />
                  </td>
                  <td className={td}>
                    <Select value={l.term} onChange={(e) => set({ term: e.target.value as typeof l.term })} className="h-8 w-full" aria-label={`${l.code} term`}>
                      {TERMS.map((t) => (
                        <option key={t} value={t}>
                          {TERM_LABEL[t]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1">
                      {config.cos.map((c) => (
                        <Pill key={c.id} on={l.coIds.includes(c.id)} onClick={() => set({ coIds: toggle(l.coIds, c.id) })}>
                          {c.code}
                        </Pill>
                      ))}
                    </div>
                  </td>
                  <td className={td}>
                    <Input value={l.description} onChange={(e) => set({ description: e.target.value })} className="h-8" aria-label={`${l.code} description`} />
                  </td>
                  <td className={td}>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${l.code}`} onClick={() => save({ los: config.los.filter((x) => x.id !== l.id) })}>
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => {
            const last = config.los.at(-1);
            save({
              los: [
                ...config.los,
                { id: crypto.randomUUID(), code: '', moduleCode: last?.moduleCode ?? 'M1', term: last?.term ?? 'PRELIM', coIds: [], description: '' },
              ],
            });
          }}
        >
          <Plus /> Add LO
        </Button>
      </section>

      <section className="max-w-3xl overflow-x-auto">
        <h3 className="mb-2 text-sm font-semibold">Program outcomes (PO)</h3>
        <table className="w-full min-w-[32rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={cn(th, 'w-24')}>Code</th>
              <th className={th}>Description</th>
              <th className={cn(th, 'w-10')} />
            </tr>
          </thead>
          <tbody>
            {config.pos.map((p) => (
              <tr key={p.id}>
                <td className={td}>
                  <Input value={p.code} onChange={(e) => renamePo(p.id, e.target.value)} className="h-8" aria-label="PO code" />
                </td>
                <td className={td}>
                  <Input
                    value={p.description}
                    onChange={(e) => save({ pos: config.pos.map((x) => (x.id === p.id ? { ...x, description: e.target.value } : x)) })}
                    className="h-8"
                    aria-label={`PO ${p.code} description`}
                  />
                </td>
                <td className={td}>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete PO ${p.code}`}
                    onClick={() =>
                      save({ pos: config.pos.filter((x) => x.id !== p.id), cos: config.cos.map((c) => ({ ...c, poCodes: c.poCodes.filter((pc) => pc !== p.code) })) })
                    }
                  >
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => save({ pos: [...config.pos, { id: crypto.randomUUID(), code: nextOutcomeCode('PO', config.pos.map((p) => p.code)), description: '' }] })}
        >
          <Plus /> Add PO
        </Button>
      </section>
    </div>
  );
}

type ReaderState =
  | { kind: 'idle' }
  | { kind: 'reading'; fileName: string }
  | { kind: 'error'; message: string }
  | { kind: 'done'; fileName: string; config: ObeConfig; notes: string[] };

/** Upload a syllabus PDF; it is read in this browser and the teacher reviews the outcomes before use. */
function SyllabusReader({ obe }: { obe: ObeConfig | undefined }) {
  const setObeConfig = useStore((s) => s.setObeConfig);
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ReaderState>({ kind: 'idle' });

  const read = async (file: File) => {
    setState({ kind: 'reading', fileName: file.name });
    try {
      const { config, notes } = obeConfigFromExtraction(await readSyllabusFile(file), () => crypto.randomUUID());
      setState({ kind: 'done', fileName: file.name, config, notes });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };
  const use = async (config: ObeConfig, fileName: string) => {
    if (
      obe &&
      !(await confirmAction({
        title: 'Replace the current setup?',
        message: "This replaces the class's COs, LOs and POs with the ones read from the syllabus. Column tags that point to the old outcomes will stop counting.",
        confirmLabel: 'Replace setup',
      }))
    ) {
      return;
    }
    setObeConfig({ ...config, syllabusFileName: fileName, syllabusUploadedAt: Date.now() });
    setState({ kind: 'idle' });
  };

  return (
    <section className="max-w-3xl rounded-lg border border-brand/20 bg-brand/5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-64 flex-1">
          <h3 className="text-sm font-semibold">Read your course syllabus</h3>
          <p className="text-xs text-slate-600">
            Upload your course syllabus (<strong>PDF format</strong>, max 5 MB). It is read 100% locally in your browser and saved to your browser
            storage—no server upload or API cost.
          </p>
        </div>
        <Button size="sm" onClick={() => input.current?.click()} disabled={state.kind === 'reading'}>
          {state.kind === 'reading' ? <Loader2 className="animate-spin" /> : <FileUp />} Upload syllabus
        </Button>
        <input
          ref={input}
          type="file"
          accept={SYLLABUS_FILE_TYPES}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void read(file);
          }}
        />
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        The app fills in the program outcomes, course outcomes and learning outcomes for you to check. It knows the University of San Agustin syllabus
        layout; other layouts may need more fixing by hand.
        {obe?.syllabusFileName && (
          <>
            {' '}
            Current setup read from <strong>{obe.syllabusFileName}</strong>
            {obe.syllabusUploadedAt && ` on ${new Date(obe.syllabusUploadedAt).toLocaleDateString()}`}.
          </>
        )}
      </p>

      {state.kind === 'reading' && <p className="mt-3 text-xs text-slate-600">Reading {state.fileName}…</p>}
      {state.kind === 'error' && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{state.message}</p>}
      {state.kind === 'done' && (
        <div className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
          <p>
            Found in <strong>{state.fileName}</strong>: {state.config.pos.length} program outcomes, {state.config.cos.length} course outcomes and{' '}
            {state.config.los.length} learning outcomes in {new Set(state.config.los.map((l) => l.moduleCode)).size} modules.
          </p>
          {(state.config.programName || state.config.collegeName) && (
            <p className="text-xs text-slate-500">{[state.config.collegeName, state.config.programName].filter(Boolean).join(' · ')}</p>
          )}
          <ul className="grid gap-0.5 text-xs text-slate-700">
            {state.config.cos.map((c) => (
              <li key={c.id}>
                <strong>{c.code}</strong> {c.description} {c.poCodes.length > 0 && <span className="text-slate-400">→ PO {c.poCodes.join(', ')}</span>}
              </li>
            ))}
          </ul>
          {state.notes.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="mb-1 font-semibold">Check these</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {state.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-slate-500">After you use it, you can correct anything in the tables below.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void use(state.config, state.fileName)} disabled={state.config.cos.length === 0}>
              Use this setup
            </Button>
            <Button size="sm" variant="outline" onClick={() => setState({ kind: 'idle' })}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
