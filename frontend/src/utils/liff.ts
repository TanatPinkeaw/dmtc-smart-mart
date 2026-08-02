// ⭐️ LIFF (LINE Front-end Framework) helper — ใช้ npm package @line/liff (ติดตั้งแล้ว)
// LIFF ID อ่านจาก env (VITE_LIFF_ID) มี fallback เป็นค่าที่ใช้จริงของ auto-login flow
import liff from '@line/liff';

export { liff };

export const LIFF_ID: string = import.meta.env.VITE_LIFF_ID || '2010928001-sEGaB0XN';

// heuristic เร็วๆ (sync) ว่ากำลังเปิดในเบราว์เซอร์ในแอป LINE หรือไม่ — ใช้ตัดสินว่าจะบล็อกหน้า login
// เพื่อลองล็อกอินอัตโนมัติก่อนไหม (ค่าที่เชื่อถือได้จริงคือ liff.isInClient() หลัง init แต่ต้อง async)
// UA ของ LINE in-app browser จะมี " Line/x.x.x"
export function looksLikeLineInApp(): boolean {
  return /\bLine\//i.test(navigator.userAgent);
}
