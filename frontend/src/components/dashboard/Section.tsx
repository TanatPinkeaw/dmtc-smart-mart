import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

interface SectionProps {
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function Section({ title, icon, open, onToggle, children }: SectionProps) {
  return (
    <div className="max-w-7xl mx-auto mt-4">
      <button onClick={onToggle} className="w-full flex items-center justify-between bg-white border border-brand-border rounded-2xl shadow-sm p-3.5 mb-3 hover:bg-brand-bg transition-colors duration-150">
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">{icon} {title}</span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-4">{children}</div>}
    </div>
  );
}
