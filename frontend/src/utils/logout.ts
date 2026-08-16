// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/logout.ts — ออกจากระบบให้ครบทุกขั้นตอน (จุดเดียวที่ทุกหน้าเรียก)
// ทำอะไร: performLogout() ยิง POST /auth/logout (ให้ backend เพิกถอน token + ล้าง cookie) แล้วล้าง
//   localStorage.user + csrf + bearer token ฝั่ง client — ต้องเรียกตัวนี้เสมอ อย่าล้าง localStorage เอง
//   (ไม่งั้น session ฝั่ง server ยังไม่ถูกเพิกถอน = token ที่หลุดยังใช้ได้)
// ═══════════════════════════════════════════════════════════════════════════════════
import api, { setCsrfToken, setBearerToken } from '../api';

// 🐛 FIX (session bug) — หลายหน้า (Shift.tsx, Dashboard.tsx) เคย "ออกจากระบบ" ด้วย
// `localStorage.clear(); navigate('/login')` เฉยๆ ซึ่งล้างแค่ข้อมูลฝั่ง client — cookie
// access_token/refresh_token เป็น httpOnly ลบจาก JS ไม่ได้ และไม่มีใครบอก backend ให้เพิกถอน
// (revoked_tokens / token_valid_after จาก security round ก่อน ถูก trigger ใน POST /auth/logout
// เท่านั้น) ผลคือ session เดิม "ยังใช้งานได้จริง" ต่อหลังกดออกจากระบบ พอ login กลับเข้ามา
// จึงเจอบัญชีเดิมค้างอยู่ และ token ที่หลุดออกไปก็ยังใช้ได้จนหมดอายุเอง
//
// ใช้ฟังก์ชันนี้ทุกครั้งที่ออกจากระบบ (Layout.tsx/Home.tsx ทำถูกอยู่แล้ว — ยกมารวมไว้ที่เดียว)
// หมายเหตุ: ไม่ navigate ให้ในนี้ เพราะแต่ละหน้าใช้ navigate() จาก react-router คนละ instance
export async function performLogout() {
  try {
    await api.post('/auth/logout'); // ⭐️ ต้องเรียกก่อน — backend เคลียร์ cookie + เพิกถอน token
  } catch (err) {
    // logout พังก็ยังต้องล้างฝั่ง client ต่อ (เช่น เน็ตหลุด/backend ล่ม) ไม่งั้นผู้ใช้ค้างอยู่ในระบบ
    console.error('Logout error:', err);
  } finally {
    localStorage.removeItem('user');
    setCsrfToken(null);
    setBearerToken(null); // ⭐️ ล้าง bearer token fallback ด้วย (ถ้ามี — LINE in-app browser)
    // 🐛 FIX — บอก SocketContext ให้ตัด socket ด้วย: same-tab ไม่มี 'storage' event เกิดเอง
    // ไม่งั้น socket เก่ายังต่อ + ยัง auth อยู่ + ยังรับ event ส่วนตัว (order_update/notification)
    // ของผู้ใช้ที่ logout ไปแล้วต่อไปเรื่อยๆ
    try { window.dispatchEvent(new Event('tokenChanged')); } catch { /* ไม่มี window (SSR) — ข้าม */ }
  }
}
