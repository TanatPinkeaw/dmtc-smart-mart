import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export function Input({ error, className = '', ...rest }: InputProps) {
  return (
    <div className="space-y-1">
      <input
        className={`w-full px-3 py-2.5 bg-brand-bg border rounded-xl text-sm focus:outline-none focus:ring-2 transition-colors duration-150 ${
          error ? 'border-red-400 focus:ring-red-400' : 'border-brand-border focus:ring-brand'
        } ${className}`}
        {...rest}
      />
      {error && <p className="text-xs text-red-500 px-1">{error}</p>}
    </div>
  );
}
