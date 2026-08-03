// ⭐️ LIFF (LINE Front-end Framework) helper — ใช้ npm package @line/liff (ติดตั้งแล้ว)
// LIFF ID อ่านจาก env (VITE_LIFF_ID) — single source of truth เดียวทั้งแอป (Login.tsx auto-login
// และ Register.tsx เดิมเคยมี LIFF_ID ของตัวเองแยกต่างหาก คนละ id กัน — รวมเหลือ id เดียวแล้ว)
import liff from '@line/liff';

export { liff };

export const LIFF_ID: string = import.meta.env.VITE_LIFF_ID || '2010928001-sEGaB0XN';

// ⭐️ Deep-link — Rich Menu เปิด https://liff.line.me/<id>?path=/register (หรือ /pre-order) LIFF จะพา
// มาที่ Endpoint URL ของแอปพร้อม query ?path=... ติดมาด้วย. "จับค่า path ตั้งแต่ตอน bundle โหลดครั้งแรก"
// (module eval รันก่อน React render/redirect ใดๆ) เก็บไว้ในตัวแปร module — เพราะ react-router
// <Navigate>/redirect จะเขียน URL ใหม่ทับ query เดิมทิ้ง ถ้าไปอ่าน window.location.search ทีหลังใน
// component จะว่างแล้ว (โดยเฉพาะถ้า Endpoint URL ชี้ที่ '/' แล้ว DefaultRoute เด้งไป /login)
const initialSearchParams: URLSearchParams =
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const initialLiffTargetPath: string | null = initialSearchParams.get('path');
// ⭐️ query param อื่นๆ นอกจาก path (เช่น ?view=orders จากลิงก์ประวัติการซื้อใน LINE webhook) — เก็บไว้
// ตั้งแต่ตอน bundle โหลดครั้งแรกเหมือนกับ path เพื่อ forward ต่อไปยังหน้าปลายทางหลัง auto-login สำเร็จ
// (ดู Login.tsx: ?path=/pre-order&view=orders → เด้งไป /pre-order?view=orders ให้ PreOrder.tsx เปิด
// โมดัลประวัติออเดอร์เองตาม deep-link ที่รองรับอยู่แล้ว)
const initialLiffExtraParams: string = (() => {
  const p = new URLSearchParams(initialSearchParams);
  p.delete('path');
  return p.toString();
})();

// path ปลายทางที่ Rich Menu ส่งมา (เช่น '/register', '/pre-order') หรือ null ถ้าไม่มี
export function getLiffTargetPath(): string | null {
  return initialLiffTargetPath;
}

// query string อื่นๆ (ไม่รวม path) เช่น 'view=orders' หรือ '' ถ้าไม่มี — ใช้ต่อท้าย targetPath ตอน navigate
export function getLiffExtraParams(): string {
  return initialLiffExtraParams;
}

let initPromise: Promise<void> | null = null;

// ⭐️ SPA เดียว หลายหน้าใช้ LIFF ร่วมกัน (Login auto-login, Register สมัคร/บัตรสมาชิก) — เปลี่ยนหน้าใน
// react-router เป็น client-side navigation ไม่ reload หน้าเว็บ ถ้าแต่ละหน้าเรียก liff.init() เองแยกกัน
// (โดยเฉพาะตอนก่อนหน้านี้คนละ liffId กัน = คนละ LIFF app context) เสี่ยง redirect ไป LINE login/consent
// ซ้ำซ้อนระหว่างเปลี่ยนหน้า ชน cookie/session state ของ LINE ระหว่างทาง — ตอนนี้ทุกหน้าเรียกฟังก์ชันนี้
// แทน liff.init() ตรงๆ: init ครั้งแรกครั้งเดียว (dedupe ด้วย shared promise กันเรียกซ้ำพร้อมกันจากหลาย
// component/effect), ครั้งถัดไปได้ promise เดิมที่ resolve แล้วกลับไปทันที ไม่ init ซ้ำ
export function ensureLiffInit(): Promise<void> {
  if (!initPromise) {
    initPromise = liff.init({ liffId: LIFF_ID }).catch((err) => {
      initPromise = null; // ⭐️ init ล้มเหลว (เช่นเน็ตสะดุดตอนแรก) — reset ให้ครั้งถัดไปลองใหม่ได้
      throw err;
    });
  }
  return initPromise;
}

// heuristic เร็วๆ (sync) ว่ากำลังเปิดในเบราว์เซอร์ในแอป LINE หรือไม่ — ใช้ตัดสินว่าจะบล็อกหน้า login
// เพื่อลองล็อกอินอัตโนมัติก่อนไหม (ค่าที่เชื่อถือได้จริงคือ liff.isInClient() หลัง init แต่ต้อง async)
// UA ของ LINE in-app browser จะมี " Line/x.x.x"
export function looksLikeLineInApp(): boolean {
  return /\bLine\//i.test(navigator.userAgent);
}
