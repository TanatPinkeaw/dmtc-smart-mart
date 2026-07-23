// ⭐️ DEPLOY FIX (Phase 2) — เดิม URL backend ฮาร์ดโค้ด 'http://localhost:3000' ทั้ง api.ts + SocketContext
// พอ deploy จริงจะยิงไป localhost ของเครื่องผู้ใช้เอง (พัง) รวมมาไว้ที่เดียว อ่านจาก env
// ตั้งค่าใน frontend/.env.production เช่น VITE_API_URL=https://coop.dmtc.ac.th
// ไม่ตั้ง = fallback localhost:3000 (dev)
export const API_ORIGIN = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ⭐️ Security remediation — กันตั้งค่าเป็น http:// หลุดไปโดยไม่ตั้งใจตอน production build
// (token/รูปสลิปจะวิ่งแบบไม่เข้ารหัส) dev fallback (localhost) ไม่โดนเช็คเพราะ PROD เป็น false
if (import.meta.env.PROD && !API_ORIGIN.startsWith('https://')) {
  throw new Error(`[config] VITE_API_URL ต้องใช้ https:// บน production build, ได้รับ: ${API_ORIGIN}`);
}

export const API_BASE_URL = `${API_ORIGIN}/api`;
