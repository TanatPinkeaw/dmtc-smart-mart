// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/syncOfflineSales.ts — ส่งบิลขายออฟไลน์ที่ค้างขึ้น server เมื่อเน็ตกลับมา
// ทำอะไร: wrapper บางๆ ผูก deps จริง (IndexedDB + api) เข้ากับ core ใน utils/offlineSync.ts
//   (ลอจิก + เทสอยู่ในนั้น — ไฟล์นี้ต้องไม่ import เข้า node test เพราะ api.ts → config.ts
//   ใช้ import.meta.env ที่ node รันไม่ได้) POS.tsx เรียก syncOfflineSales() ตอนกลับมาออนไลน์
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ POS ออฟไลน์ — ซิงค์คิวบิลขายที่ค้างอยู่ใน IndexedDB ขึ้น /api/sales/sync-offline เป็น batch
// เดียว เรียกตอนกลับมาออนไลน์ (POS.tsx ฟัง useOnlineStatus() แล้วเรียกให้)
import api from '../api';
import { getAllOfflineSales, removeOfflineSale, markOfflineSaleError } from './offlineSalesDb';
import { syncOfflineSales as runSync, type OfflineSyncDeps } from './offlineSync';
export type { SyncOfflineSalesSummary } from './offlineSync';

const defaultDeps: OfflineSyncDeps = {
  getAll: () => getAllOfflineSales(),
  remove: (id) => removeOfflineSale(id),
  markError: (id, msg) => markOfflineSaleError(id, msg),
  post: (url, payload) => api.post(url, payload),
};

export function syncOfflineSales() {
  return runSync(defaultDeps);
}
