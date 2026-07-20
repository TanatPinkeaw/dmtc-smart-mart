import type { HTMLAttributes, ReactNode } from 'react';

type BadgeVariant = 'brand' | 'gray' | 'success' | 'danger' | 'warning';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: ReactNode;
}

const variantClasses: Record<BadgeVariant, string> = {
  brand: 'bg-brand-bg text-brand border-brand-border',
  gray: 'bg-gray-100 text-gray-600 border-gray-200',
  success: 'bg-green-50 text-green-600 border-green-200',
  danger: 'bg-red-50 text-red-600 border-red-200',
  warning: 'bg-yellow-50 text-yellow-700 border-yellow-200',
};

export function Badge({ variant = 'brand', className = '', children, ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium border px-3 py-1.5 rounded-full ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
