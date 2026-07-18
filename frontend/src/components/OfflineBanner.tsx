// ⭐️ Sprint 2 — B6: Offline Handling — Banner component to show when offline
import { WifiOff, Loader } from 'lucide-react';

interface OfflineBannerProps {
  isOnline: boolean;
}

export default function OfflineBanner({ isOnline }: OfflineBannerProps) {
  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white px-4 py-3 flex items-center justify-center gap-3 animate-pulse">
      <WifiOff size={18} />
      <span className="text-sm font-semibold">อ่านเสีย การเชื่อมต่ออินเทอร์เน็ต</span>
      <Loader size={16} className="animate-spin" />
      <span className="text-xs">พยายามส่งข้อมูล...</span>
    </div>
  );
}
