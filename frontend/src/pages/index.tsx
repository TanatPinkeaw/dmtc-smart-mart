// ✅ DMTC Mart — Shared UI Components
// ธีม: Light & Fresh, Primary #F12B6B

import React from 'react';
import { Loader2 } from 'lucide-react';

// ─── Button ──────────────────────────────────────────────────────────────────

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  variant = 'primary', size = 'md', loading, icon, children, className = '', disabled, ...props
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95';
  const variants = {
    primary:   'bg-[#F12B6B] hover:bg-[#FF467E] text-white focus:ring-[#F12B6B]',
    secondary: 'bg-white border border-[#FD94B4] text-[#F12B6B] hover:bg-[#FFF5F7] focus:ring-[#F12B6B]',
    danger:    'bg-red-500 hover:bg-red-600 text-white focus:ring-red-500',
    ghost:     'text-gray-500 hover:bg-[#FFF5F7] hover:text-[#F12B6B] focus:ring-[#F12B6B]',
  };
  const sizes = {
    sm: 'text-xs px-3 py-1.5',
    md: 'text-sm px-4 py-2.5',
    lg: 'text-base px-6 py-3',
  };
  return (
    <button {...props} disabled={disabled || loading} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ─── Input ───────────────────────────────────────────────────────────────────

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export function Input({ label, error, icon, className = '', ...props }: InputProps) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-gray-500">{label}</label>}
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</span>}
        <input
          {...props}
          className={`w-full ${icon ? 'pl-9' : 'px-3'} pr-3 py-2.5 bg-[#FFF5F7] border ${error ? 'border-red-400' : 'border-[#F6C7C7]'} rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#F12B6B] focus:border-[#F12B6B] transition-colors duration-150 disabled:opacity-50 ${className}`}
        />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-[#F6C7C7] rounded-2xl shadow-sm ${className}`}>
      {children}
    </div>
  );
}

// ─── Badge / Status ───────────────────────────────────────────────────────────

const statusMap: Record<string, { label: string; cls: string }> = {
  PENDING_VERIFY:   { label: 'รอตรวจสลิป',   cls: 'bg-yellow-100 text-yellow-800' },
  WAITING_CASH:     { label: 'รอรับเงิน',     cls: 'bg-blue-100 text-blue-800' },
  SLIP_REJECTED:    { label: 'รอสลิปใหม่',   cls: 'bg-orange-100 text-orange-800' },
  REFUND_REQUESTED: { label: 'รอคืนเงิน',    cls: 'bg-purple-100 text-purple-800' },
  PREPARING:        { label: 'กำลังเตรียม',  cls: 'bg-indigo-100 text-indigo-800' },
  READY:            { label: 'พร้อมรับ',      cls: 'bg-emerald-100 text-emerald-800' },
  COMPLETED:        { label: 'สำเร็จ',        cls: 'bg-gray-100 text-gray-600' },
  CANCELLED:        { label: 'ยกเลิก',        cls: 'bg-red-100 text-red-700' },
  VOIDED:           { label: 'ยกเลิก',        cls: 'bg-red-100 text-red-700' },
  OPEN:             { label: 'เปิดกะ',        cls: 'bg-emerald-100 text-emerald-800' },
  CLOSED:           { label: 'ปิดกะ',         cls: 'bg-gray-100 text-gray-600' },
  MEMBER:           { label: 'สมาชิก',        cls: 'bg-blue-100 text-blue-700' },
  CASHIER:          { label: 'แคชเชียร์',    cls: 'bg-[#FFF5F7] text-[#F12B6B] border border-[#FD94B4]' },
  ADMIN:            { label: 'ผู้จัดการ',     cls: 'bg-purple-100 text-purple-700' },
};

export function StatusBadge({ status, label: override }: { status: string; label?: string }) {
  const cfg = statusMap[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
      {override ?? cfg.label}
    </span>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, className = '' }: {
  open: boolean; onClose: () => void; title?: string; children: React.ReactNode; className?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-lg max-h-[90vh] overflow-hidden flex flex-col ${className}`}>
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#F6C7C7]">
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-[#FFF5F7] transition-colors duration-150">✕</button>
          </div>
        )}
        <div className="overflow-y-auto flex-1 p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

export const SkeletonLine = ({ w = 'w-full', h = 'h-4' }: { w?: string; h?: string }) => (
  <div className={`animate-pulse bg-[#F6C7C7]/40 rounded-lg ${w} ${h}`} />
);

export const SkeletonCard = () => (
  <Card className="p-4 space-y-3">
    <SkeletonLine w="w-1/3" h="h-4" />
    <SkeletonLine h="h-3" />
    <SkeletonLine w="w-4/5" h="h-3" />
  </Card>
);

export const SkeletonProductCard = () => (
  <Card className="p-3 space-y-2 animate-pulse">
    <div className="bg-[#F6C7C7]/40 rounded-xl h-28 w-full" />
    <SkeletonLine w="w-3/4" h="h-3" />
    <SkeletonLine w="w-1/2" h="h-3" />
  </Card>
);

// ─── EmptyState ───────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, description }: { icon?: React.ReactNode; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && <div className="mb-3 text-[#FD94B4]">{icon}</div>}
      <p className="text-sm font-medium text-gray-600">{title}</p>
      {description && <p className="mt-1 text-xs text-gray-400">{description}</p>}
    </div>
  );
}

// ─── PageHeader ───────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
