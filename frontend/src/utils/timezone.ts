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

/**
 * Format date to Bangkok timezone date only
 * Output format: YYYY-MM-DD
 */
export function formatBangkokDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const formatted = d.toLocaleString('th-TH', {
    timeZone: THAILAND_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  // Convert from MM/DD/YYYY to YYYY-MM-DD
  const dateParts = formatted.split('/');
  return `${dateParts[2]}-${dateParts[0]}-${dateParts[1]}`;
}

/**
 * Get today's date in Bangkok timezone as YYYY-MM-DD string
 */
export function getTodayBangkok(): string {
  const now = new Date();
  const bkkDate = new Date(now.toLocaleString('en-US', { timeZone: THAILAND_TZ }));
  const year = bkkDate.getFullYear();
  const month = String(bkkDate.getMonth() + 1).padStart(2, '0');
  const day = String(bkkDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get yesterday's date in Bangkok timezone as YYYY-MM-DD string
 */
export function getYesterdayBangkok(): string {
  const now = new Date();
  const bkkDate = new Date(now.toLocaleString('en-US', { timeZone: THAILAND_TZ }));
  bkkDate.setDate(bkkDate.getDate() - 1);
  const year = bkkDate.getFullYear();
  const month = String(bkkDate.getMonth() + 1).padStart(2, '0');
  const day = String(bkkDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
