// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/timezone.ts — helper แปลง/แสดงวันเวลาเป็นเวลาไทย (Asia/Bangkok) ฝั่ง frontend
// ทำอะไร: formatBangkokTime() ฯลฯ แปลง Date/string เป็นข้อความวันเวลาไทย (DD/MM/YYYY HH:mm:ss)
//   ใช้แสดงผลบนจอให้ตรงเวลาไทยเสมอ ไม่ว่าเครื่องผู้ใช้จะตั้ง timezone อะไร
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Sprint 2 — B8: Thailand Timezone Utilities
export const THAILAND_TZ = 'Asia/Bangkok';

/**
 * Format timestamp to Bangkok time with full date and time
 * Output format: DD/MM/BBBB HH:mm (BBBB = พุทธศักราช เช่น 2569)
 *
 * 🐛 FIX — เดิมใช้ toLocaleString('th-TH', ...) แล้วเข้าใจผิดว่า output เป็น MM/DD/YYYY
 * (แบบ en-US) จึงสลับ day/month กลับ — แต่ th-TH ให้ DD/MM/BBBB มาแล้ว (เช่น "16/08/2569")
 * ผลคือทุก timestamp ในแอป (ใบเสร็จ/ออเดอร์/กะ) แสดงวันกับเดือนสลับกัน เช่น 13 ส.ค. → "08/13/2569"
 * (และในบาง environment มี comma "16/8/2569, 13:30" ที่ split เอา day/month ผิดซ้ำไปอีก)
 * ใหม่: ใช้ formatToParts อ่าน field ทีละตัวแล้วประกอบเอง ไม่พึ่งการเรียงลำดับ/เครื่องหมายของ locale
 * คงพุทธศักราช (th-TH default) ให้ตรงกับที่คนไทยใช้และส่วนอื่นของแอป (เช่น DetailModal)
 */
export function formatBangkokTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat('th-TH', {
    timeZone: THAILAND_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

