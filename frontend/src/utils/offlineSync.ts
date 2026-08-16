// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/offlineSync.ts — ลอจิกซิงค์บิลออฟไลน์ (pure + DI — เทสต์ได้ ไม่แตะ api)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำไมต้องแยก: เดิมลอจิกนี้อยู่ใน syncOfflineSales.ts ที่ import api (→ config.ts ใช้
//   import.meta.env ซึ่ง node ใช้ไม่ได้) — เทสหน่วยเลยต้องแยก core มาอยู่ไฟล์นี้แบบ
//   zero-dependency (pattern เดียวกับ queueProcessor.ts) แล้วให้ wrapper ข้างนอกผูก deps จริง
//
// ทำอะไร: อ่านคิว (deps.getAll) → สร้าง payload ผ่าน buildSyncOfflinePayload (whitelist —
//   ฟิลด์แต้ม/สมาชิก/UI ไม่รั่วขึ้น server) → ยิง batch (deps.post) → ลบตัวสำเร็จ / มาร์ก error
//   ตัวพลาด (deps.remove / deps.markError) → คืนสรุป { attempted, synced, failed }
// ═══════════════════════════════════════════════════════════════════════════════════
import type { OfflineSale } from './offlineSalesDb.ts';
import { buildSyncOfflinePayload, type SyncOfflinePayload } from './offlinePayload.ts';

export interface SyncOfflineSalesSummary {
  attempted: number;
  synced: number;
  failed: number;
}

export interface SyncOfflineResult {
  client_offline_id: string;
  success: boolean;
  error?: string;
}

// dependencies ที่ inject ได้ (เทสส่ง mock — ดู offlineSync.test.ts)
export interface OfflineSyncDeps {
  getAll: () => Promise<OfflineSale[]>;
  remove: (clientOfflineId: string) => Promise<void>;
  markError: (clientOfflineId: string, errorMsg: string) => Promise<void>;
  post: (url: string, payload: SyncOfflinePayload) => Promise<{ data: { results?: SyncOfflineResult[] } }>;
}

// core ลอจิกซิงค์ (ไม่แตะ module state) — แยกจาก guard เพื่อให้เทสโคฟเวอร์ได้ตรง
export async function runOfflineSync(deps: OfflineSyncDeps): Promise<SyncOfflineSalesSummary> {
  const pending = await deps.getAll();
  if (pending.length === 0) return { attempted: 0, synced: 0, failed: 0 };

  const payload = buildSyncOfflinePayload(pending);
  let results: SyncOfflineResult[];
  try {
    const res = await deps.post('/sales/sync-offline', payload);
    results = res.data?.results || [];
  } catch (err) {
    // ⭐️ ทั้ง batch ยิงไม่ผ่านเลย (เช่น เน็ตหลุดอีกรอบกลางทาง) — ปล่อยคิวไว้ครบ ลองใหม่ตอนออนไลน์รอบหน้า
    console.error('[syncOfflineSales] batch request failed:', err);
    return { attempted: pending.length, synced: 0, failed: pending.length };
  }

  let synced = 0;
  let failed = 0;
  for (const r of results) {
    if (r.success) {
      await deps.remove(r.client_offline_id);
      synced++;
    } else {
      await deps.markError(r.client_offline_id, r.error || 'ซิงค์ไม่สำเร็จ');
      failed++;
    }
  }
  return { attempted: pending.length, synced, failed };
}

// ⭐️ กันเรียกซ้อนกัน (เช่น 'online' event ยิงถี่ๆ ตอนต่อเน็ตติดๆ ดับๆ)
let syncInFlight = false;

// ตัวเข้า (มี guard) — syncOfflineSales.ts (wrapper จริง) ส่ง deps เริ่มต้นให้
export async function syncOfflineSales(deps: OfflineSyncDeps): Promise<SyncOfflineSalesSummary | null> {
  if (syncInFlight) return null;
  syncInFlight = true;
  try {
    return await runOfflineSync(deps);
  } finally {
    syncInFlight = false;
  }
}
