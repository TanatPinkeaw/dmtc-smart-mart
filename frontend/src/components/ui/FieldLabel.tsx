// 📄 components/ui/FieldLabel.tsx — label ฟอร์ม ตัวกลางเดียวทั้งแอป
//    เดิมมี ~6 แบบ (text-xs font-medium gray-600 / gray-500 / bold / text-sm semibold gray-700 ฯลฯ)
//    รวมเป็น 2 ขนาด: sm (หน้า auth/ฟอร์มใหญ่) + xs (โมดัล/ฟอร์มแน่น) — เปลี่ยนที่เดียวทั้งแอป
interface FieldLabelProps {
  children: React.ReactNode;
  size?: 'sm' | 'xs';
  required?: boolean;
  htmlFor?: string;
  className?: string;
}

export function FieldLabel({ children, size = 'sm', required, htmlFor, className = '' }: FieldLabelProps) {
  const base =
    size === 'xs'
      ? 'block text-xs font-medium text-gray-600 mb-1'
      : 'block text-sm font-semibold text-gray-700 mb-1.5';
  return (
    <label htmlFor={htmlFor} className={`${base} ${className}`}>
      {children}
      {required && <span className="text-red-500"> *</span>}
    </label>
  );
}
