// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/errorMessage.ts — ดึงข้อความ error ที่อ่านง่ายจาก error object (ใช้ทั่วแอป)
// ทำอะไร: getErrorMessage(err, fallback) คืนข้อความไทยจาก err.response.data.error ถ้ามี ไม่งั้นคืน
//   fallback ที่ผู้ใช้เข้าใจ (กันเคสเน็ตหลุด/timeout/500 ที่ไม่มี field error → ไม่โชว์ค่าว่าง/ศัพท์เทคนิค)
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ F9 — ข้อความ error กลาง ใช้แทนการดึง error.response?.data?.error ตรงๆ ทั่วแอป
// เหตุผล: backend ส่ง { error: "ข้อความไทยที่อ่านง่าย" } เกือบทุก route อยู่แล้ว (ไม่ใช่ stack trace)
// จุดที่พังคือตอนไม่มี response เลย (เน็ตหลุด, timeout, CORS พัง) หรือ response ไม่มี field "error"
// (เช่น 500 ที่ไม่ผ่าน error handler, หรือ HTML error page) —ตอนนั้น text จะเป็น undefined/blank
// ฟังก์ชันนี้ปิดช่องว่างนั้นด้วย fallback ข้อความที่ user อ่านเข้าใจ ไม่ใช่ศัพท์เทคนิค
// โครงสร้างขั้นต่ำของ error ที่ฟังก์ชันนี้อ่าน (axios error หรือ object ที่หน้าตาใกล้เคียง)
// export ให้ catch block ที่ต้องอ่าน err.response/err.code ใช้ cast ได้: `const e = err as ErrorLike`
export interface ErrorLike {
  response?: { status?: number; data?: { error?: unknown } };
  code?: string;
  message?: string;
}

export function getErrorMessage(err: unknown, fallback = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'): string {
  // รับ unknown ตรงๆ (TS 6: catch (err) ได้ unknown) แล้ว narrow ข้างใน — ทำให้เรียกจาก catch ได้ทุกที่
  const e = err as ErrorLike | null | undefined;
  const backendMsg = e?.response?.data?.error;
  if (typeof backendMsg === 'string' && backendMsg.trim().length > 0) return backendMsg;

  // เน็ตหลุด/timeout ไม่มี response กลับมาเลย
  if (e?.code === 'ECONNABORTED') return 'การเชื่อมต่อหมดเวลา กรุณาลองใหม่อีกครั้ง';
  if (e && !e.response) return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ต';

  return fallback;
}
