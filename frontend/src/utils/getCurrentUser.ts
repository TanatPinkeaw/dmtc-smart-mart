// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/getCurrentUser.ts — อ่านข้อมูลผู้ใช้ที่ล็อกอินอยู่จาก localStorage อย่างปลอดภัย
// ทำอะไร: getCurrentUser() คืน object user (id/role/full_name...) หรือ null ถ้ายังไม่ล็อกอิน/ข้อมูลเสีย
//   (ห่อ JSON.parse ด้วย try/catch กันจอขาว); getCurrentUserOrRedirect() เด้งไป /login ให้เลยถ้าไม่มี user
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Sprint 0 — B2: safe wrapper around localStorage.getItem('user') + JSON.parse.
// Every page in this app used to do `JSON.parse(localStorage.getItem('user') || '{}')` directly,
// with no try/catch. If that value is ever corrupted (manual edit, half-written write, browser
// extension messing with storage, old schema from a previous version), JSON.parse throws
// synchronously during render → white screen with no recovery path except manually clearing
// storage via DevTools. This wraps it so a corrupt value degrades to "not logged in" instead of
// a crash, and self-heals by clearing the bad value.

export interface User {
  id: number;
  student_id: string;
  full_name: string;
  phone_number: string;
  // field ที่หลายหน้าเข้าถึงตรงๆ (server ส่งมาใน payload user) — ประกาศให้ typed ไม่ใช่ unknown
  username?: string;
  profile_image_url?: string | null;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER' | 'MEMBER';
  // field เพิ่มเติมจาก server (เช่น points/group_id) — เป็น unknown บังคับให้โค้ด narrow ก่อนใช้
  [key: string]: unknown;
}

export function getCurrentUser(): User | null {
  try {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;
    const parsed = JSON.parse(userStr);
    // ⭐️ กันกรณี JSON.parse ผ่านแต่ได้ค่าที่ไม่ใช่ user object จริง (เช่น "null", "42", "[]")
    if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.role) return null;
    return parsed as User;
  } catch (err) {
    console.error('localStorage.user corrupted, clearing:', err);
    localStorage.removeItem('user');
    return null;
  }
}

// ⭐️ ใช้ในหน้าที่ต้อง login เท่านั้น (เช่น Shift.tsx, POS.tsx, Dashboard.tsx) — ถ้าไม่มี user ให้
// เตะกลับไป /login ทันทีแทนที่จะปล่อยให้หน้า render ต่อด้วย user เป็น null แล้วพังตอนอ่าน user.id
export function getCurrentUserOrRedirect(): User {
  const user = getCurrentUser();
  if (!user) {
    window.location.href = '/login';
    throw new Error('User not logged in');
  }
  return user;
}
