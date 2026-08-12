// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/syncOfflineSales.ts — ส่งบิลขายออฟไลน์ที่ค้างขึ้น server เมื่อเน็ตกลับมา
// ทำอะไร: อ่านบิลค้างจาก offlineSalesDb (IndexedDB) แล้วยิง /api/sales/sync-offline ทีละบิล ลบตัวที่สำเร็จ
//   / มาร์ก error ตัวที่พลาด แล้วคืนสรุป (attempted/synced/failed) — POS.tsx เรียกตอน useOnlineStatus กลับ online
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ POS ออฟไลน์ — ซิงค์คิวบิลขายที่ค้างอยู่ใน IndexedDB ขึ้น /api/sales/sync-offline เป็น batch
// เดียว เรียกตอนกลับมาออนไลน์ (POS.tsx ฟัง useOnlineStatus() แล้วเรียกให้)
import api from '../api';
import { getAllOfflineSales, removeOfflineSale, markOfflineSaleError } from './offlineSalesDb';

export interface SyncOfflineSalesSummary {
  attempted: number;
  synced: number;
  failed: number;
}

// ⭐️ กันเรียกซ้อนกัน (เช่น 'online' event ยิงถี่ๆ ตอนต่อเน็ตติดๆ ดับๆ)
let syncInFlight = false;

export async function syncOfflineSales(): Promise<SyncOfflineSalesSummary | null> {
  if (syncInFlight) return null;
  const pending = await getAllOfflineSales();
  if (pending.length === 0) return { attempted: 0, synced: 0, failed: 0 };

  syncInFlight = true;
  try {
    const payload = {
      sales: pending.map(s => ({
        client_offline_id: s.client_offline_id,
        payment_method: s.payment_method,
        amount_received: s.amount_received,
        total_amount: s.total_amount,
        created_at_offline: s.created_at_offline,
        items: s.items,
      })),
    };

    const res = await api.post('/sales/sync-offline', payload);
    const results: Array<{ client_offline_id: string; success: boolean; error?: string }> = res.data.results || [];

    let synced = 0, failed = 0;
    for (const r of results) {
      if (r.success) {
        await removeOfflineSale(r.client_offline_id);
        synced++;
      } else {
        await markOfflineSaleError(r.client_offline_id, r.error || 'ซิงค์ไม่สำเร็จ');
        failed++;
      }
    }
    return { attempted: pending.length, synced, failed };
  } catch (err) {
    // ⭐️ ทั้ง batch ยิงไม่ผ่านเลย (เช่น เน็ตหลุดอีกรอบกลางทาง) — ปล่อยคิวไว้ครบ ลองใหม่ตอนออนไลน์รอบหน้า
    console.error('[syncOfflineSales] batch request failed:', err);
    return { attempted: pending.length, synced: 0, failed: pending.length };
  } finally {
    syncInFlight = false;
  }
}
