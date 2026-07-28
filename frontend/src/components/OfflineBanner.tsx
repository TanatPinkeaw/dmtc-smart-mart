// ⭐️ Sprint 2 — B6: Offline Handling — Banner component to show when offline
// ⭐️ Update — POS ออฟไลน์: เพิ่ม pendingCount ให้เห็นด้วยว่ามีบิลค้างซิงค์กี่ใบ ไม่ว่าจะยังออฟไลน์อยู่
//   หรือกลับมาออนไลน์แล้วแต่ sync ยังไม่เสร็จ (แถบเหลือง เตือนเบากว่าแถบแดง "ไม่มีเน็ต")
import { WifiOff, Loader, CloudOff } from 'lucide-react';

interface OfflineBannerProps {
  isOnline: boolean;
  pendingCount?: number;
}

export default function OfflineBanner({ isOnline, pendingCount = 0 }: OfflineBannerProps) {
  if (isOnline && pendingCount === 0) return null;

  if (!isOnline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white px-4 py-3 flex items-center justify-center gap-3 animate-pulse">
        <WifiOff size={18} />
        <span className="text-sm font-semibold">ขาดการเชื่อมต่ออินเทอร์เน็ต</span>
        {pendingCount > 0 && (
          <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">บันทึกออฟไลน์ไว้ {pendingCount} บิล — จะซิงค์อัตโนมัติเมื่อเน็ตกลับมา</span>
        )}
      </div>
    );
  }

  // ⭐️ ออนไลน์แล้วแต่ยังมีบิลออฟไลน์ค้างซิงค์อยู่ (กำลัง sync หรือ sync ล้มเหลวรอบก่อน)
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white px-4 py-3 flex items-center justify-center gap-3">
      <CloudOff size={18} />
      <span className="text-sm font-semibold">กำลังซิงค์บิลออฟไลน์ {pendingCount} บิล...</span>
      <Loader size={16} className="animate-spin" />
    </div>
  );
}
