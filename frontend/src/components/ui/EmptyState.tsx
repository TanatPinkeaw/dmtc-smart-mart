// 📄 components/ui/EmptyState.tsx — สถานะว่าง/ไม่มีข้อมูล/โหลด ตัวกลางเดียวทั้งแอป
//    เดิมแต่ละหน้าเขียนเองคนละแบบ (~4 pattern): py-16 flex-col + icon / text-gray-400 py-8 /
//    py-10 / p-6 text-center — รวมเป็นกล่องเดียว: ไอคอนในกล่อง brand-bg + title + hint + action
//    มี 2 ขนาด: ปกติ (md — หน้าเต็ม/โมดัล) + compact (พื้นที่เล็ก — การ์ด/widget/ตาราง)
interface EmptyStateProps {
  icon?: React.ReactNode; // lucide icon (หรือ div ครอบสปินเนอร์ตอนโหลด)
  title: string;
  hint?: string;
  action?: React.ReactNode; // ปุ่มใต้ข้อความ (เช่น "ลองใหม่")
  compact?: boolean; // พื้นที่เล็ก — ลด padding/ขนาด (การ์ด/widget/ตาราง)
  tone?: 'default' | 'error'; // error = title แดง
  className?: string;
}

export function EmptyState({ icon, title, hint, action, compact, tone = 'default', className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center text-gray-400 ${compact ? 'py-8 gap-1.5' : 'py-12 gap-2'} ${className}`}>
      {icon && (
        <div className={`bg-brand-bg rounded-2xl flex items-center justify-center text-brand-mid ${compact ? 'w-11 h-11' : 'w-14 h-14'} mb-1`}>
          {icon}
        </div>
      )}
      <p className={`font-medium ${tone === 'error' ? 'text-red-500' : ''} ${compact ? 'text-xs' : 'text-sm'}`}>{title}</p>
      {hint && <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-gray-400/90`}>{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
