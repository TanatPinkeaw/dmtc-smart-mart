// ⭐️ LIFF (LINE Front-end Framework) helper — โหลด SDK แบบ dynamic script (เหมือน Register.tsx)
// แทนการเพิ่ม npm package @line/liff เพื่อให้สอดคล้องกับ pattern เดิมที่มีอยู่แล้วในโปรเจกต์
// LIFF ID อ่านจาก env (VITE_LIFF_ID) มี fallback เป็นค่าที่ใช้จริงของร้าน
const LIFF_SDK_SRC = 'https://static.line-scdn.net/liff/edge/2/sdk.js';

export const LIFF_ID: string = import.meta.env.VITE_LIFF_ID || '2010928001-YxK4Atjv';

// โหลด LIFF SDK ครั้งเดียว คืน window.liff (resolve ทันทีถ้าโหลดไว้แล้ว)
export function loadLiffSdk(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.liff) return resolve(w.liff);
    const existing = document.querySelector(`script[src="${LIFF_SDK_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve((window as any).liff));
      existing.addEventListener('error', () => reject(new Error('โหลด LINE SDK ไม่สำเร็จ')));
      return;
    }
    const script = document.createElement('script');
    script.src = LIFF_SDK_SRC;
    script.onload = () => resolve((window as any).liff);
    script.onerror = () => reject(new Error('โหลด LINE SDK ไม่สำเร็จ'));
    document.head.appendChild(script);
  });
}

// heuristic เร็วๆ (sync) ว่ากำลังเปิดในเบราว์เซอร์ในแอป LINE หรือไม่ — ใช้ตัดสินว่าจะบล็อกหน้า login
// เพื่อลองล็อกอินอัตโนมัติก่อนไหม (ค่าที่เชื่อถือได้จริงคือ liff.isInClient() หลัง init แต่ต้อง async)
// UA ของ LINE in-app browser จะมี " Line/x.x.x"
export function looksLikeLineInApp(): boolean {
  return /\bLine\//i.test(navigator.userAgent);
}
