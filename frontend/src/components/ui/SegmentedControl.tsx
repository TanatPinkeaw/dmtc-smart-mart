import React from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// 📦 ui/SegmentedControl — ปุ่มกลุ่มเลือก (radio-like) ที่เลือกได้ 1 ตัว
// ─────────────────────────────────────────────────────────────────────────────
// ทำอะไร: ปุ่มวิธีจ่ายเงิน QR/เงินสด (pos + preorder — เดิม copy กัน 2 ไฟล์) และ
//         ปุ่ม pill เลือกช่วงเวลา (Dashboard Peak Hours / Summary มุมมองกำไร)
// variant:
//   • 'box'  — ปุ่ม border-2 กล่อง 2 ช่อง (วิธีจ่ายเงิน) — container grid-cols-2
//   • 'pill' — ปุ่มกลมเล็กในถาด bg-brand-bg (ช่วงเวลา/มุมมอง) — container flex
// สี selected เฉพาะ option ต่างกันได้ (เช่น QR สีน้ำเงิน) ผ่าน selectedClassName
// ─────────────────────────────────────────────────────────────────────────────

export type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  /** ต่อท้าย className ของปุ่ม (ขนาด/น้ำหนักตัวอักษรตามบริบท) */
  className?: string;
  /** สีตอน selected — ใช้เมื่อ option มี accent ตัวเอง (เช่น QR สีน้ำเงิน) */
  selectedClassName?: string;
  /** สีตอนไม่ selected */
  unselectedClassName?: string;
  /** focus ring — ใช้เมื่อ option มีสี ring ต่างจากแบรนด์ (เช่น QR น้ำเงิน) */
  focusRingClassName?: string;
};

type SegmentedControlProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  variant?: 'box' | 'pill';
  /** ต่อท้าย className ของ container (เช่น print:hidden) */
  className?: string;
  disabled?: boolean;
  /** aria-label ของกลุ่มปุ่ม */
  ariaLabel?: string;
};

const interaction = 'transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2';

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  variant = 'box',
  className = '',
  disabled = false,
  ariaLabel,
}: SegmentedControlProps<T>) {
  const isPill = variant === 'pill';
  const containerCls = isPill
    ? `flex bg-brand-bg border border-brand-border rounded-full p-0.5 ${className}`
    : `grid grid-cols-2 gap-2 ${className}`;
  const btnBase = isPill
    ? 'px-2.5 py-1 rounded-full text-xs font-semibold'
    : 'py-2 rounded-lg border-2';
  const selectedDefault = isPill ? 'bg-brand text-white' : 'border-brand bg-white text-brand-dark shadow-sm';
  const unselectedDefault = isPill ? 'text-gray-500' : 'border-gray-200 text-gray-400 hover:border-gray-300 bg-white/50';
  const focusDefault = isPill ? 'focus-visible:ring-brand' : 'focus-visible:ring-brand focus-visible:ring-offset-1';

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={containerCls}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`${btnBase} ${o.className ?? ''} ${interaction} ${o.focusRingClassName ?? focusDefault} ${disabled ? 'opacity-50' : ''} ${selected ? (o.selectedClassName ?? selectedDefault) : (o.unselectedClassName ?? unselectedDefault)}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
