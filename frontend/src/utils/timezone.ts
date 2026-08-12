// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 utils/timezone.ts — helper แปลง/แสดงวันเวลาเป็นเวลาไทย (Asia/Bangkok) ฝั่ง frontend
// ทำอะไร: formatBangkokTime() ฯลฯ แปลง Date/string เป็นข้อความวันเวลาไทย (DD/MM/YYYY HH:mm:ss)
//   ใช้แสดงผลบนจอให้ตรงเวลาไทยเสมอ ไม่ว่าเครื่องผู้ใช้จะตั้ง timezone อะไร
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭐️ Sprint 2 — B8: Thailand Timezone Utilities
export const THAILAND_TZ = 'Asia/Bangkok';

/**
 * Format timestamp to Bangkok time with full date and time
 * Output format: DD/MM/YYYY HH:mm:ss
 */
export function formatBangkokTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const formatted = d.toLocaleString('th-TH', {
    timeZone: THAILAND_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  // Convert from MM/DD/YYYY HH:mm:ss to DD/MM/YYYY HH:mm
  const parts = formatted.split(' ');
  const dateParts = parts[0].split('/');
  return `${dateParts[1]}/${dateParts[0]}/${dateParts[2]} ${parts[1].slice(0, 5)}`;
}

