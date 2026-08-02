import api, { setCsrfToken } from '../api';

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
  }
}
