// ⭐️ DEPLOY FIX (Phase 2) — เดิม URL backend ฮาร์ดโค้ด 'http://localhost:3000' ทั้ง api.ts + SocketContext
// พอ deploy จริงจะยิงไป localhost ของเครื่องผู้ใช้เอง (พัง) รวมมาไว้ที่เดียว อ่านจาก env
// ตั้งค่าใน frontend/.env.production เช่น VITE_API_URL=https://coop.dmtc.ac.th
// ไม่ตั้ง = fallback localhost:3000 (dev)
export const API_ORIGIN = import.meta.env.VITE_API_URL || 'http://localhost:3000';
export const API_BASE_URL = `${API_ORIGIN}/api`;
