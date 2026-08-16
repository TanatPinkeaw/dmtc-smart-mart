// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/requestQueue.ts — คิวเก็บ request (POST/PUT/DELETE) ตอนออฟไลน์ (localStorage)
// ทำอะไร: เก็บ request ที่ยิงไม่ได้ตอนไม่มีเน็ตไว้ใน localStorage แล้วส่งซ้ำเมื่อเน็ตกลับ (api.ts เรียกใช้)
//   — สำหรับ mutation ทั่วไป (บิลขาย POS ใช้ offlineSalesDb.ts แยกต่างหากเพราะต้อง batch + dedup เฉพาะ)
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Sprint 2 — B6: Offline Handling — Queue for storing pending requests
interface QueuedRequest {
  method: string;
  url: string;
  data: unknown;
  headers: Record<string, string>;
  timestamp: number;
  retries: number;
}

const QUEUE_KEY = 'pending_requests';
// ⭐️ จำนวนครั้งที่ยิงซ้ำได้สูงสุด (api.ts ใช้ตัดสินใจว่าเมื่อไหร่จะ "ล้มเหลวถาวร" แล้วตัดออกจากคิว)
export const MAX_RETRIES = 3;

export function getQueue(): QueuedRequest[] {
  try {
    const stored = localStorage.getItem(QUEUE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error('Failed to parse request queue:', e);
    return [];
  }
}

export function saveRequestToQueue(
  method: string,
  url: string,
  data: unknown,
  headers: Record<string, string>
): void {
  const queue = getQueue();
  const queuedRequest: QueuedRequest = {
    method,
    url,
    data,
    headers,
    timestamp: Date.now(),
    retries: 0,
  };
  queue.push(queuedRequest);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  console.log(`[Queue] Added request: ${method} ${url}`);
}

export function removeFromQueue(index: number): void {
  const queue = getQueue();
  queue.splice(index, 1);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function incrementRetries(index: number): void {
  const queue = getQueue();
  if (queue[index]) {
    queue[index].retries += 1;
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }
}

