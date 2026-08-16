// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/queueProcessor.ts — ลอจิกประมวลผลคิว request ออฟไลน์ (แยกจาก api.ts ให้เทสต์ได้)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: วนอ่านคิวแล้วยิง request ที่ค้างไว้ทีละตัว — สำเร็จ = ตัดออกจากคิว, fail = นับ retries,
//   fail ครบ maxRetries = ตัดทิ้ง + รายงานให้ caller (api.ts เอาไปแจ้งเตือนผู้ใช้ด้วย Swal)
//
// 🐛 ประวัติบัค (ที่เทสนี้กันไว้): เดิมลูปนี้อยู่ใน api.ts ใช้ array ตัวเดียว + i-- หลัง
//   removeFromQueue — แต่ storage (requestQueue.ts) อ่าน localStorage ใหม่ทุกครั้ง = ได้ array
//   คนละตัวกับที่ loop วนอยู่ → i-- วนกลับมาประมวลผล item เดิมซ้ำไม่รู้จบ = ยิง request ซ้ำ
//   (ออเดอร์/บิลซ้ำ) + item ถัดไปไม่เคยโดนส่ง. แก้โดย "อ่านคิวสดทุกรอบ" ไม่มี index arithmetic —
//   ดู regression test ใน queueProcessor.test.ts
//
// Dependency injection: ไม่แตะ localStorage/axios/React ตรงๆ — รับ storage (getQueue/
//   removeFromQueue/incrementRetries) + sendRequest เข้ามา → เทสต์ด้วยของปลอมได้โดยไม่ต้อง
//   mock ทั้งระบบ (api.ts ส่งของจริงให้ตอน wire จริง)
export interface QueuedRequest {
  method: string;
  url: string;
  data: unknown;
  headers: Record<string, string>;
  retries: number;
}

export interface QueueStorage {
  getQueue(): QueuedRequest[];
  removeFromQueue(index: number): void;
  incrementRetries(index: number): void;
}

export interface QueueSendConfig {
  method: string;
  url: string;
  data: unknown;
  headers: Record<string, string>;
}

export interface FailedRequest {
  method: string;
  url: string;
}

// ประมวลผลคิวหนึ่งรอบ (เรียก 1 ครั้งต่อ online event) — คืนรายการที่ล้มเหลวถาวร + ส่งให้ callback
export async function processQueuedRequests(
  storage: QueueStorage,
  sendRequest: (config: QueueSendConfig) => Promise<unknown>,
  onPermanentlyFailed: (failed: FailedRequest[]) => void = () => {},
  maxRetries = 3,
): Promise<FailedRequest[]> {
  const permanentlyFailed: FailedRequest[] = [];

  let i = 0;
  while (true) {
    // ⭐️ อ่านคิวสดทุกรอบ (storage อ่านจาก localStorage ใหม่ทุกครั้ง — ห้ามถือ array ตัวเดียวค้างไว้
    // แล้วใช้ i-- เพราะจะวนซ้ำ item เดิม) — break เมื่อถึงท้ายคิว
    const queue = storage.getQueue();
    if (i >= queue.length) break;
    const req = queue[i];

    // item ที่เกิน max retries (ค้างจากรอบก่อน) → ตัดทิ้ง + รายงาน
    if (req.retries >= maxRetries) {
      console.warn(`[Queue] Max retries exceeded for ${req.method} ${req.url}`);
      storage.removeFromQueue(i);
      permanentlyFailed.push({ method: req.method, url: req.url });
      continue; // item ถัดไปเลื่อนมาอยู่ index เดิม — รอบหน้า re-read แล้ว ไม่ต้อง i--
    }

    try {
      const config: QueueSendConfig = {
        method: req.method,
        url: req.url,
        data: req.data,
        headers: req.headers,
      };
      console.log(`[Queue] Retrying ${req.method} ${req.url} (attempt ${req.retries + 1})`);
      await sendRequest(config);
      console.log(`[Queue] Successfully sent ${req.method} ${req.url}`);
      storage.removeFromQueue(i);
      continue; // item ถัดไปเลื่อนมาอยู่ index เดิม — ไม่ต้อง i--
    } catch (error) {
      storage.incrementRetries(i);
      // fail ครบ max retries แล้ว: ตัดทิ้งทันที + รายงาน — req.retries คือค่าก่อน increment จึง +1
      if (req.retries + 1 >= maxRetries) {
        storage.removeFromQueue(i);
        permanentlyFailed.push({ method: req.method, url: req.url });
        continue;
      }
      console.error(`[Queue] Retry failed for ${req.method} ${req.url}:`, (error as Error)?.message);
      i++; // item ยังอยู่ในคิว (ยังไม่ครบ max) — ไป item ถัดไป
    }
  }

  if (permanentlyFailed.length > 0) onPermanentlyFailed(permanentlyFailed);
  return permanentlyFailed;
}
