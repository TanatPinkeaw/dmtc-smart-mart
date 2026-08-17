// 📄 components/ui/Button.tsx — ปุ่มมาตรฐานของแอป (variant: primary/secondary/danger/ghost +
//    สีตามสถานะ warning/success/purple/orange/info, ขนาด sm/md/lg, มี loading spinner ในตัว)
//    ใช้ซ้ำแทนการเขียน <button> ใหม่ทุกที่ ให้หน้าตาปุ่มเหมือนกันทั้งระบบ
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline-danger' | 'warning' | 'success' | 'purple' | 'orange' | 'info' | 'payment-cash' | 'payment-qr' | 'reward';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-gradient-to-br from-brand to-brand-dark text-white font-bold',
  secondary: 'bg-white border border-brand-border text-brand hover:bg-brand-bg font-bold',
  danger: 'bg-red-500 hover:bg-red-600 text-white font-bold',
  // ⭐️ อันตรายแบบ outline (quiet) — ปฏิเสธ/ปิดการ์ดที่ควรแดงแต่ไม่ต้องทึบ
  'outline-danger': 'bg-white border border-red-200 text-red-600 hover:bg-red-50 font-bold',
  ghost: 'bg-transparent hover:bg-brand-bg text-gray-700',
  // ⭐️ ปุ่มสีตามสถานะ (semantic — สื่อความหมายของ action เช่น ขอสลิปใหม่/คืนเงิน/ยืนยัน/ปิดบิล)
  warning: 'bg-gradient-to-br from-yellow-500 to-yellow-600 text-white font-bold',
  success: 'bg-gradient-to-br from-green-500 to-green-600 text-white font-bold',
  purple: 'bg-gradient-to-br from-purple-500 to-purple-600 text-white font-bold',
  orange: 'bg-gradient-to-br from-orange-500 to-orange-600 text-white font-bold',
  info: 'bg-gradient-to-br from-blue-600 to-blue-700 text-white font-bold',
  // ⭐️ ปุ่มชำระเงินสีตามวิธีจ่าย (checkout POS/PreOrder — เงินสดชมพูแบรนด์ / QR น้ำเงิน)
  'payment-cash': 'bg-gradient-to-br from-brand to-brand-dark text-white font-bold',
  'payment-qr': 'bg-gradient-to-br from-blue-600 to-blue-700 text-white font-bold',
  // ⭐️ ปุ่มแลกของรางวัล (amber — โทนเดียวกับ badge แต้ม)
  reward: 'bg-gradient-to-br from-amber-400 to-amber-500 text-white font-bold',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'py-1.5 px-3 text-xs',
  md: 'py-2.5 px-4 text-sm',
  lg: 'py-3 px-6 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-full transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}
