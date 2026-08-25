// 📄 components/ui/StatusBadge.tsx — ป้ายสถานะออเดอร์ ตัวกลางเดียวทั้งแอป
//    เดิมมี 3 จุด copy-paste สีต่างกัน (OrderManagement / MyOrdersModal / OrderDetailModal)
//    — SLIP_REJECTED บางจุดแดง บางจุดเหลือง. รวม map สีเดียว + ขนาด 3 แบบ + ไอคอนตามสถานะ.
import { AlertCircle, CheckCircle, Clock, PackageSearch } from 'lucide-react';

// ⭐️ map สีกลาง — ห้ามแก้สีเฉพาะจุด ให้แก้ที่นี่ที่เดียว (เทส contract ล็อกการใช้ component กลาง)
const STATUS_STYLE: Record<string, string> = {
  WAITING_CASH: 'bg-yellow-100 text-yellow-700',
  WAITING_ACCEPT: 'bg-amber-100 text-amber-700',
  PENDING_VERIFY: 'bg-blue-100 text-blue-700',
  PREPARING: 'bg-orange-100 text-orange-700',
  READY: 'bg-green-100 text-green-700',
  COMPLETED: 'bg-gray-100 text-gray-600',
  CANCELLED: 'bg-red-100 text-red-600',
  SLIP_REJECTED: 'bg-yellow-100 text-yellow-700',
  REFUND_REQUESTED: 'bg-purple-100 text-purple-700',
};
const DEFAULT_STYLE = 'bg-gray-100 text-gray-600';

const STATUS_LABEL: Record<string, string> = {
  WAITING_CASH: 'รอจ่ายเงินสดหน้าร้าน',
  WAITING_ACCEPT: 'รอพนักงานรับงาน',
  PENDING_VERIFY: 'รอตรวจสลิป',
  PREPARING: 'กำลังเตรียมของ',
  READY: 'ของพร้อมรับ',
  COMPLETED: 'สำเร็จแล้ว',
  CANCELLED: 'ยกเลิก',
  SLIP_REJECTED: 'รอสลิปใหม่',
  REFUND_REQUESTED: 'รอคืนเงิน',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  WAITING_CASH: <Clock size={14} />,
  WAITING_ACCEPT: <Clock size={14} />,
  PENDING_VERIFY: <AlertCircle size={14} />,
  PREPARING: <PackageSearch size={14} />,
  READY: <CheckCircle size={14} />,
};

type StatusBadgeSize = 'sm' | 'md' | 'lg';

const SIZE_CLS: Record<StatusBadgeSize, string> = {
  // sm — ตาราง/ลิสต์แน่น (OrderManagement)
  sm: 'px-3 py-1 text-xs font-bold',
  // md — ลิสต์โมดัลกลาง (MyOrdersModal)
  md: 'px-3 py-1.5 text-xs font-bold',
  // lg — หัวโมดัล/details ใหญ่ (OrderDetailModal)
  lg: 'px-4 py-2.5 text-xs sm:text-sm font-semibold',
};

interface StatusBadgeProps {
  status: string;
  size?: StatusBadgeSize;
  label?: string; // override ข้อความ (เช่น label เต็มของ MyOrdersModal)
  icon?: React.ReactNode; // override ไอคอน (false = ไม่มีไอคอน)
  className?: string;
}

export function StatusBadge({ status, size = 'sm', label, icon, className = '' }: StatusBadgeProps) {
  const showIcon = icon !== null && (icon !== undefined || STATUS_ICON[status]);
  return (
    <span
      className={`inline-flex items-center gap-1 w-fit rounded-full whitespace-nowrap ${SIZE_CLS[size]} ${STATUS_STYLE[status] || DEFAULT_STYLE} ${className}`}
    >
      {showIcon && <>{icon ?? STATUS_ICON[status]}</>}
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}
