import { Copy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { SUBJECT_TYPES, subjectTypeLabel } from '../app/labels';
import { useStore, type ClassInfo } from '../app/store';
import type { ClassRecord } from '../app/types';
import type { SubjectType } from '../engine';
import { confirmAction } from './ConfirmDialog';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';
import { Input, Label, Select } from './ui/input';

/** Create a class, or edit / delete an existing one (`record`). */
export function ClassDialog({ open, onOpenChange, record }: { open: boolean; onOpenChange: (o: boolean) => void; record?: ClassRecord }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={record ? 'Edit class' : 'New class'} description="One record per class and section, covering all 3 terms.">
        {open && <ClassForm record={record} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ClassForm({ record, onDone }: { record?: ClassRecord; onDone: () => void }) {
  const { createClass, updateClassInfo, trashClass, duplicateClassSetup } = useStore();
  const [duplicating, setDuplicating] = useState(false);
  const [newSection, setNewSection] = useState('');
  const [info, setInfo] = useState<ClassInfo>({
    subjectCode: record?.subjectCode ?? '',
    subjectName: record?.subjectName ?? '',
    section: record?.section ?? '',
    subjectType: record?.subjectType ?? 'LEC',
  });
  const field = (key: keyof ClassInfo) => ({
    value: info[key],
    onChange: (e: { target: { value: string } }) => setInfo({ ...info, [key]: e.target.value }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (record) updateClassInfo(info);
    else createClass(info);
    onDone();
  };
  const duplicate = () => {
    if (!record || newSection.trim() === '') return;
    duplicateClassSetup(record.id, newSection);
    onDone();
  };
  const remove = async () => {
    if (!record) return;
    const name = [record.subjectCode, record.section].filter(Boolean).join(' · ') || 'this class';
    const ok = await confirmAction({
      title: 'Move class to trash?',
      message: `${name} will leave your class list. You can restore it at any time from the Trash tab in All classes overview.`,
      confirmLabel: 'Move to Trash',
    });
    if (!ok) return;
    trashClass(record.id);
    onDone();
  };
  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Label>
          Subject code
          <Input required placeholder="EE 231" autoFocus {...field('subjectCode')} />
        </Label>
        <Label>
          Section
          <Input placeholder="A" {...field('section')} />
        </Label>
      </div>
      <Label>
        Subject name
        <Input placeholder="Electronics 1" {...field('subjectName')} />
      </Label>
      <Label>
        Subject type (CS / WE weightage)
        <Select
          value={info.subjectType}
          onChange={(e) => setInfo({ ...info, subjectType: e.target.value as SubjectType })}
        >
          {SUBJECT_TYPES.map((t) => (
            <option key={t} value={t}>
              {subjectTypeLabel(t)}
            </option>
          ))}
        </Select>
      </Label>
      {record &&
        (duplicating ? (
          <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <Label>
              Section for the copy
              <Input
                autoFocus
                value={newSection}
                placeholder="e.g. 2-B"
                onChange={(e) => setNewSection(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  duplicate();
                }}
              />
            </Label>
            <p className="text-xs text-slate-500">Copies the columns, categories and OBE tags of all 3 terms. The new class starts with no students or scores.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDuplicating(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={newSection.trim() === ''} onClick={duplicate}>
                Duplicate setup
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="justify-self-start" onClick={() => setDuplicating(true)}>
            <Copy /> Duplicate setup for new section…
          </Button>
        ))}
      <div className="mt-2 flex items-center justify-between">
        {record ? (
          <div>
            <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => void remove()}>
              Move to trash
            </Button>
            <p className="px-3 text-[11px] text-slate-500">Restore it later from the Trash tab in All classes overview.</p>
          </div>
        ) : (
          <span />
        )}
        <Button type="submit">{record ? 'Save' : 'Create class'}</Button>
      </div>
    </form>
  );
}
