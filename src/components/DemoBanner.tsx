import { FlaskConical, X } from 'lucide-react';
import { useState } from 'react';

const key = (classId: string) => `demoBannerDismissed:${classId}`;

const wasDismissed = (classId: string) => {
  try {
    return localStorage.getItem(key(classId)) === '1';
  } catch {
    return false;
  }
};

/** Tells a first-time user the open class is made up and how to remove it. */
export function DemoBanner({ classId }: { classId: string }) {
  const [hidden, setHidden] = useState(() => wasDismissed(classId));
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(key(classId), '1');
    } catch {
      // Storage blocked: the banner returns after a reload.
    }
  };
  return (
    <div role="status" className="flex items-center gap-3 border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
      <FlaskConical className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">This is a sample demo class for exploring features. You can delete it anytime from Edit Class.</span>
      <button onClick={dismiss} aria-label="Dismiss" className="rounded p-1 hover:bg-sky-100">
        <X className="size-4" />
      </button>
    </div>
  );
}
