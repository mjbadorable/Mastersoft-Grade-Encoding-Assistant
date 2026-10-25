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
  const { createClass, updateClassInfo, deleteClass } = useStore();
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
  const remove = async () => {
    if (!record) return;
    const name = [record.subjectCode, record.section].filter(Boolean).join(' · ') || 'this class';
    const ok = await confirmAction({
      title: 'Delete class?',
      message: `${name} and all its students and scores will be removed from this browser. Download a backup first if you may need it again.`,
      confirmLabel: 'Delete class',
    });
    if (!ok) return;
    deleteClass(record.id);
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
      <div className="mt-2 flex items-center justify-between">
        {record ? (
          <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => void remove()}>
            Delete class
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit">{record ? 'Save' : 'Create class'}</Button>
      </div>
    </form>
  );
}
