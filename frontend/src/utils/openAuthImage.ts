// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/openAuthImage.ts — เปิดรูปที่ต้องล็อกอินถึงจะดูได้ในแท็บใหม่ (ผ่าน api แนบ cookie)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำไมต้องแยกไฟล์: เดิมอยู่ใน AuthImage.tsx แต่ react-refresh ต้องการให้ไฟล์ component
//   export แค่ component — helper ตัวนี้ย้ายมาให้ PendingShiftClosesWidget/OrderManagement import
//   (AuthImage.tsx ใช้ isFullUrl จากที่นี่ด้วย)
// ทำอะไร: รูป Cloudinary (URL เต็ม) เปิดแท็บตรงๆ; รูป /uploads/... ต้อง fetch ผ่าน api แนบ
//   httpOnly cookie (browser window.open ตรงๆ จะ 401) เป็น blob แล้วเปิด object URL
// ═══════════════════════════════════════════════════════════════════════════════════
import api from '../api';

// ⭐️ Cloudinary — รูปใหม่เก็บเป็น URL เต็ม (https://...) เปิดสาธารณะได้ ไม่ต้องแนบ JWT
//    ถ้า path เป็น http(s) โหลดตรงๆ; ถ้าเป็นพาธเดิม (/uploads/...) โหลดผ่าน /api/media (แนบ token)
export const isFullUrl = (p?: string | null): boolean => !!p && /^https?:\/\//i.test(p);

// ⭐️ helper — เปิดรูปในแท็บใหม่ (แทน window.open ตรงๆ ที่ browser จะ 401 เพราะไม่มี token)
export async function openAuthImage(path: string) {
  // รูป Cloudinary (URL เต็ม) — เปิดแท็บใหม่ตรงๆ
  if (isFullUrl(path)) { window.open(path, '_blank'); return; }
  try {
    const res = await api.get('/media', { params: { path }, responseType: 'blob' });
    const objectUrl = URL.createObjectURL(res.data);
    window.open(objectUrl, '_blank');
    // ปล่อย object URL ทีหลังเพื่อให้แท็บใหม่โหลดทัน
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    /* เงียบไว้ — รูปโหลดไม่ได้ */
  }
}
