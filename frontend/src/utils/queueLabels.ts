// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/queueLabels.ts — แปลง request ในคิวออฟไลน์เป็นชื่อที่ผู้ใช้อ่านรู้เรื่อง
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: map path (เช่น /sales/checkout) → ป้ายไทย (เช่น "บิลขาย (POS)") ใช้แสดงใน
//   Swal แจ้งเตือน "มีรายการที่ส่งไม่สำเร็จ" ตอน replay คิวออฟไลน์ล้มเหลวถาวร (api.ts เรียก)
//   แยกมาเป็น pure module ให้เทสต์ได้ (เดิมนิยามใน api.ts — node test เข้า api.ts ไม่ได้
//   เพราะ config.ts ใช้ import.meta.env) — ดู queueDrainContract.test.ts ที่เช็คว่า api.ts
//   ยังเรียกใช้จากที่นี่ + ยังมี Swal แจ้งเตือนผู้ใช้อยู่
//
// ⚠️ ลำดับ LABELS สำคัญมาก: ตรวจจากบนลงล่าง ตัวที่ prefix ทับกันต้องมาก่อน
//   (เช่น /member-groups ต้องมาก่อน /members — ไม่งั้น "/member-groups/..." จะโดน
//   /members กลืนเป็น "ข้อมูลสมาชิก" ผิด label) — มีเทสยืนยันกรณีนี้ใน queueLabels.test.ts
// ═══════════════════════════════════════════════════════════════════════════════════
// รายการ prefix นี้ครอบทุก mutation endpoint ที่ offline queue (api.ts) เก็บได้
// (POST/PUT/PATCH/DELETE ตอนไม่มีเน็ต — ไล่จาก api.post/put/patch/delete ทั่ว frontend)
// export ไว้ให้เทส coverage ใช้ (queueLabelsCoverage.test.ts สแกน api.post/put/patch/delete
// ทั่ว frontend แล้วเช็คว่าทุก endpoint มีป้าย — กันเพิ่ม mutation แล้วลืมเติมป้าย)
export const LABELS: ReadonlyArray<readonly [string, string]> = [
  ['/sales/checkout', 'บิลขาย (POS)'], // exact ก่อน — ไม่งั้น /sales prefix กลืนเป็น "บิลขาย" เฉยๆ
  ['/member-groups', 'กลุ่มสมาชิก'],     // ต้องมาก่อน /members (prefix ทับกัน)
  ['/sales', 'บิลขาย'],                 // /sales/:id/void (ยกเลิกบิล)
  ['/orders', 'ออเดอร์จอง'],
  ['/attendance', 'การลงเวลางาน'],
  ['/shifts', 'กะการขาย'],
  ['/members', 'ข้อมูลสมาชิก'],
  ['/users', 'ข้อมูลพนักงาน'],
  ['/products', 'สินค้า'],
  ['/categories', 'หมวดหมู่'],
  ['/suppliers', 'ซัพพลายเออร์'],
  ['/promotions', 'โปรโมชั่น'],
  ['/purchases', 'ใบรับสินค้า'],
  ['/settings', 'ตั้งค่าร้าน'],
  ['/notifications', 'การแจ้งเตือน'],
  ['/schedules', 'ตารางกะ'],
  ['/holidays', 'วันหยุด'],
  ['/admin', 'จัดการระบบ'],
  ['/auth', 'เข้าสู่ระบบ'],
];

export function describeQueuedRequest(req: { method: string; url: string }): string {
  // ตัด query string (เช่น ?idempotency-key=...) ออกก่อน match — path เดียวกันนับเป็นรายการเดียวกัน
  const path = (req.url || '').split('?')[0];
  // match แบบ "path นี้หรือใต้ path นี้" (มี / ต่อท้าย) — ไม่ใช่ startsWith เปล่าๆ กัน path
  // ที่แค่ขึ้นต้นคล้ายกัน (เช่น /ordersx) โดนจับผิด
  const found = LABELS.find(([prefix]) => path === prefix || path.startsWith(prefix + '/'));
  // รู้จัก → "ชื่อไทย (METHOD url)" ; ไม่รู้จัก → แสดง METHOD + url เต็ม (กันข้อมูลหาย)
  return found ? `${found[1]} (${req.method} ${req.url})` : `${req.method} ${req.url}`;
}
