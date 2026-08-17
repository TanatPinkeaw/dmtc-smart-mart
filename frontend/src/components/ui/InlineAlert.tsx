// 📄 components/ui/InlineAlert.tsx — กล่องแจ้งเตือนเล็กในฟอร์ม/หน้า (ไม่ใช่ EmptyState กลาง)
//    ทำอะไร: error/warning สั้นๆ ที่อยู่กับเนื้อหา — ข้อความตอน submit (Login), rate limit + countdown,
//      แบนเนอร์เตือนใต้แถบหัว (Dashboard "บางข้อมูลโหลดไม่สำเร็จ") — เดิมแต่ละจุดเขียน bg-red-50/amber-50
//      border เองคนละแบบ → รวมเป็นกล่องเดียว (tone error แดง / warning เหลือง + ขนาด sm แถบเล็ก / md กล่องฟอร์ม)
//    จุดสำคัญ: ต่างจาก EmptyState — EmptyState คือกล่องใหญ่กลางหน้าสำหรับ "ไม่มีข้อมูล/โหลดพังทั้งหน้า"
//      InlineAlert คือแถบเล็กๆ ที่อยู่กับฟอร์ม/เนื้อหา (className ต่อท้ายได้ — ปรับ margin/ความกว้างตามบริบท)
//      variant strip = แถบ border-b เต็มความกว้างใต้หัวโมดัล (ChangePasswordModal "บัญชีนี้ใช้รหัสผ่านชั่วคราว")
//      tone info (น้ำเงิน) = ข้อมูล/วิธีใช้ (เช่น "วิธีนับเงินปิดกะ" ใน CloseShiftModal)
interface InlineAlertProps {
  tone?: 'error' | 'warning' | 'info';
  variant?: 'box' | 'strip';
  size?: 'sm' | 'md';
  className?: string;
  children: React.ReactNode;
}

const TONES = {
  error: 'bg-red-50 border-red-200 text-red-600',
  warning: 'bg-amber-50 border-amber-200 text-amber-700',
  info: 'bg-blue-50 border-blue-200 text-blue-700',
} as const;

const VARIANTS = {
  box: (size: NonNullable<InlineAlertProps['size']>) =>
    `border rounded-2xl ${size === 'sm' ? 'px-4 py-2.5 text-xs font-medium' : 'px-4 py-3 text-sm'}`,
  strip: 'border-b rounded-none px-5 py-2 text-xs font-medium',
} as const;

export function InlineAlert({ tone = 'error', variant = 'box', size = 'md', className = '', children }: InlineAlertProps) {
  return (
    <div className={`${TONES[tone]} ${variant === 'strip' ? VARIANTS.strip : VARIANTS.box(size)} ${className}`}>
      {children}
    </div>
  );
}
