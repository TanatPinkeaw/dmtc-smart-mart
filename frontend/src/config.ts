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

// ⭐️ Production ยิง REST API แบบ relative path ('/api/...') ผ่าน Vercel rewrite (ดู vercel.json)
// ไม่ได้ยิงตรงไปที่ Render — เพื่อให้ cookie ที่ backend ตั้งกลายเป็น first-party ของโดเมน Vercel
// (Safari/iOS ITP บล็อก third-party cookie ทิ้ง ทำให้ล็อกอินผ่านแต่ request ถัดไปไม่มี cookie → 401
// วนกลับหน้า login) dev ยังยิงตรงไป localhost:3000 เหมือนเดิม เพราะไม่มี Vercel proxy อยู่ตรงกลาง
export const API_BASE_URL = import.meta.env.PROD ? '/api' : `${API_ORIGIN}/api`;

// ⭐️ หมายเหตุสำคัญ: Socket.io ยัง "ต้อง" ต่อตรงไปที่ API_ORIGIN (Render) เท่านั้น ห้ามเปลี่ยนไปใช้
// path relative ผ่าน proxy — Vercel rewrite ไม่รองรับการ upgrade เป็น WebSocket ถ้าเปลี่ยน realtime
// จะพังทั้งระบบ (ดู SocketContext.tsx ที่ import API_ORIGIN ไปใช้) VITE_API_URL จึงยังจำเป็นอยู่
