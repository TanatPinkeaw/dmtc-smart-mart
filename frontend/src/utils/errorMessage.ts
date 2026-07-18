// ⭐️ F9 — ข้อความ error กลาง ใช้แทนการดึง error.response?.data?.error ตรงๆ ทั่วแอป
// เหตุผล: backend ส่ง { error: "ข้อความไทยที่อ่านง่าย" } เกือบทุก route อยู่แล้ว (ไม่ใช่ stack trace)
// จุดที่พังคือตอนไม่มี response เลย (เน็ตหลุด, timeout, CORS พัง) หรือ response ไม่มี field "error"
// (เช่น 500 ที่ไม่ผ่าน error handler, หรือ HTML error page) —ตอนนั้น text จะเป็น undefined/blank
// ฟังก์ชันนี้ปิดช่องว่างนั้นด้วย fallback ข้อความที่ user อ่านเข้าใจ ไม่ใช่ศัพท์เทคนิค
export function getErrorMessage(err: any, fallback = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'): string {
  const backendMsg = err?.response?.data?.error;
  if (typeof backendMsg === 'string' && backendMsg.trim().length > 0) return backendMsg;

  // เน็ตหลุด/timeout ไม่มี response กลับมาเลย
  if (err?.code === 'ECONNABORTED') return 'การเชื่อมต่อหมดเวลา กรุณาลองใหม่อีกครั้ง';
  if (err && !err.response) return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ต';

  return fallback;
}
