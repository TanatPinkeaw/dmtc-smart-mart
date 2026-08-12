// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 hooks/useOnlineStatus.ts — React hook บอกสถานะออนไลน์/ออฟไลน์ของเบราว์เซอร์
// ทำอะไร: คืน true/false ว่าตอนนี้มีเน็ตไหม (ฟัง event online/offline ของ browser) — POS ใช้ตัดสินว่า
//   จะขายออนไลน์หรือเก็บบิลออฟไลน์ + ตอนกลับ online ค่อย sync
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Sprint 2 — B6: Offline Handling — Hook to track online/offline status
import { useEffect, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
