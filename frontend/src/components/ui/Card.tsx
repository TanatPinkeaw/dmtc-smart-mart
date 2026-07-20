import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className = '', children, ...rest }: CardProps) {
  return (
    <div
      className={`bg-white border border-brand-border rounded-xl shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
