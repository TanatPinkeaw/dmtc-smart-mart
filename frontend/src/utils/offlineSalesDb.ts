// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/offlineSalesDb.ts — ที่เก็บบิลขายตอนออฟไลน์ (IndexedDB) ของหน้า POS
// ทำอะไร: เซฟ/อ่าน/ลบบิลขายที่เกิดตอนเน็ตหลุดไว้ในเบราว์เซอร์ (IndexedDB) — export saveOfflineSale,
//   getAllOfflineSales, removeOfflineSale, getOfflineSalesCount ฯลฯ ให้ POS.tsx + syncOfflineSales.ts ใช้
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ POS ออฟไลน์ — เก็บบิลขายที่เกิดขึ้นตอนไม่มีเน็ตไว้ใน IndexedDB (ไม่ใช่ localStorage เหมือน
// requestQueue.ts เดิม เพราะ IndexedDB รองรับข้อมูลจำนวนมาก/โครงสร้างซับซ้อนกว่า และไม่เสี่ยงชนกับ
// requestQueue ทั่วไปที่ retry แบบ generic — บิลขายต้องการ batch sync ที่ endpoint เฉพาะ
// (/api/sales/sync-offline) พร้อม dedup key ของตัวเอง ดู POS.tsx สำหรับ flow การใช้งานเต็ม
const DB_NAME = 'dmtc-offline-sales';
const DB_VERSION = 1;
const STORE_NAME = 'pending_sales';

export interface OfflineSaleItem {
  product_id: number;
  quantity: number;
  unit_price: number;
}

export interface OfflineSale {
  client_offline_id: string; // ⭐️ uuid ที่สร้างตอนบันทึก — ใช้ dedup ตอน sync กันซิงค์ซ้ำ
  payment_method: 'CASH' | 'QR' | 'MIXED';
  amount_received: number;
  total_amount: number;
  created_at_offline: string; // ISO string ของเวลาที่ขายจริงตอนออฟไลน์
  items: OfflineSaleItem[];
  // ⭐️ เก็บไว้ฝั่ง client เพิ่มเติมสำหรับแสดงใบเสร็จ/แจ้งเตือน ไม่ได้ส่งขึ้น backend
  cashier_name?: string;
  item_names?: { name: string; quantity: number; price: number }[];
  sync_error?: string; // ตั้งไว้ถ้า sync รอบล่าสุดล้มเหลว ให้ UI โชว์เหตุผลได้
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'client_offline_id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveOfflineSale(sale: OfflineSale): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(sale);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllOfflineSales(): Promise<OfflineSale[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function removeOfflineSale(clientOfflineId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(clientOfflineId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ⭐️ ใช้ mark error ไว้ให้ cashier เห็นเหตุผลที่ค้าง sync ไม่ผ่าน (เช่น สต๊อกไม่พอ) โดยไม่ลบออกจากคิว
export async function markOfflineSaleError(clientOfflineId: string, errorMsg: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(clientOfflineId);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (record) {
        record.sync_error = errorMsg;
        store.put(record);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflineSalesCount(): Promise<number> {
  const sales = await getAllOfflineSales();
  return sales.length;
}
