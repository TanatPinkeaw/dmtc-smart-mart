// 📄 utils/localDate.ts — "วันนี้" ตามเวลาท้องถิ่น (กันเพี้ยนจาก new Date().toISOString() ที่เป็น UTC)
//    ปัญหา: ตอน 00:00–07:00 ตามเวลาไทย UTC ยังเป็นวันก่อนหน้า → slice(0,10)/slice(0,7) จาก
//    toISOString() จะได้ "เมื่อวาน" (เคยเป็นบัคที่ AttendanceManagement / Dashboard / Schedules /
//    AccountingSummary) — เดิมแต่ละไฟล์ copy helper กันเอง มาอยู่รวมที่เดียวให้แก้จุดเดียวจบ
//
//    ใช้ getLocalDate() สำหรับ "วันนี้ตามเขตเวลาของเครื่องผู้ใช้"
//    ใช้ getBangkokDate() เมื่อต้องยึดเขตเวลาไทยจริงๆ (เช่น รายงานการเงิน/ยอดขาย)
import { THAILAND_TZ } from './timezone';

export function getLocalDate(): string {
  const tzoffset = new Date().getTimezoneOffset() * 60000;
  return new Date(Date.now() - tzoffset).toISOString().split('T')[0];
}

// ⭐️ วันนี้ตามเขตเวลา Asia/Bangkok — ไม่พึ่ง timezone ของเครื่อง (คนดูอยู่ที่ไหนก็ได้วันไทยเสมอ)
//    'en-CA' ให้รูปแบบ YYYY-MM-DD ตรงๆ ไม่ต้องไป slice อีก
export function getBangkokDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: THAILAND_TZ }).format(new Date());
}
