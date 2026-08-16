// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/offlinePayload.ts — สร้าง payload ที่ยิงไป /api/sales/sync-offline (pure — เทสต์ได้)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำไมต้องมี: เดิม syncOfflineSales.ts สร้าง payload เองตรงๆ (และส่ง items แบบอ้างอิงตรง
//   `items: s.items`) — ถ้าวันหนึ่งมีฟิลด์ใหม่หลุดเข้า record ใน IndexedDB (เช่น field สำหรับ
//   แสดงใบเสร็จ) จะถูกส่งขึ้น server ตามไปด้วย แม้ backend จะ strip ทิ้งอยู่แล้วก็ตาม แยกเป็น
//   pure function + whitelist ชัดเจนแบบนี้: ส่งเฉพาะฟิลด์ที่ syncOfflineValidator รับ เท่านั้น
//
// ⭐️ ฟิลด์ที่ตัดออก (กันรั่ว):
//   - ระดับ sale:  cashier_name / item_names / sync_error (client-only สำหรับ UI ใบเสร็จ)
//   - ระดับ item:  redeem_reward / points_required / member_id / promotion_id / redeem_points
//     (บิลออฟไลน์ต้องไม่มีฟีเจอร์แต้ม/สมาชิก — POS บล็อกไว้ตั้งแต่สร้าง + ตัดซ้ำตรงนี้เป็นเกราะ 2)
//     ถ้ามีฟิลด์เหล่านี้หลุดมาใน record (record เก่า/แก้มือ) จะถูก re-map เหลือ 3 ฟิลด์ก่อนส่ง
// ═══════════════════════════════════════════════════════════════════════════════════
import type { OfflineSale, OfflineSaleItem } from './offlineSalesDb';

// รูปร่างของ payload ที่ backend ยอมรับ (ตรงกับ syncOfflineValidator ใน backend/src/validators/index.js)
export interface SyncOfflinePayloadSale {
  client_offline_id: string;
  payment_method: string;
  amount_received: number;
  total_amount: number;
  created_at_offline: string;
  items: OfflineSaleItem[];
}

export interface SyncOfflinePayload {
  sales: SyncOfflinePayloadSale[];
}

// whitelist: คัดเฉพาะฟิลด์ที่ backend รับ — ฟิลด์ UI และฟิลด์แต้ม/สมาชิก (ถ้าหลุดมา) ถูกตัดทั้ง
// ระดับ sale และระดับ item (re-map ทีละตัว ไม่ส่ง reference ตรง) — ไม่ mutate ตัว input
export function buildSyncOfflinePayload(sales: OfflineSale[]): SyncOfflinePayload {
  return {
    sales: sales.map(s => ({
      client_offline_id: s.client_offline_id,
      payment_method: s.payment_method,
      amount_received: s.amount_received,
      total_amount: s.total_amount,
      created_at_offline: s.created_at_offline,
      items: s.items.map(({ product_id, quantity, unit_price }) => ({ product_id, quantity, unit_price })),
    })),
  };
}
