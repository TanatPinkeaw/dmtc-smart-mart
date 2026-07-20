import {
  LayoutDashboard, Boxes, Settings, CalendarClock, BarChart3,
  ClipboardCheck, ShoppingBag, PiggyBank,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItemDef {
  to: string;
  icon: LucideIcon;
  label: string;
  mobileLabel?: string; // label สั้นกว่าสำหรับ mobile bottom nav (ที่ว่างจำกัด)
}

// สมาชิก (ไม่ใช่ staff) เท่านั้น — ใช้ใน sidebar + mobile bottom nav
export const MEMBER_ITEMS: NavItemDef[] = [
  { to: '/pre-order', icon: ShoppingBag, label: 'สั่งจอง', mobileLabel: 'จอง' },
  { to: '/my-sales', icon: PiggyBank, label: 'ยอดฝากขาย', mobileLabel: 'ฝากขาย' },
];

// staff ทุกคน (ADMIN/CASHIER) — ใช้ใน sidebar (กลุ่ม "พนักงาน" ต่อจาก POS/ออเดอร์) + mobile drawer
export const STAFF_ITEMS: NavItemDef[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'สรุปยอดขาย' },
  { to: '/schedules', icon: CalendarClock, label: 'ตารางกะ' },
];

// ADMIN เท่านั้น — เรียงตามลำดับของ sidebar (กลุ่ม "ผู้จัดการ")
export const ADMIN_ITEMS_SIDEBAR: NavItemDef[] = [
  { to: '/summary', icon: BarChart3, label: 'สรุปข้อมูล' },
  { to: '/inventory', icon: Boxes, label: 'คลังสินค้า' },
  { to: '/settings', icon: Settings, label: 'ตั้งค่า' },
  { to: '/attendance-management', icon: ClipboardCheck, label: 'เข้า-ออกงาน' },
];

// ADMIN เท่านั้น — ลำดับเดิมของ mobile drawer (ตั้งค่าอยู่ท้ายสุด ต่างจาก sidebar)
export const ADMIN_ITEMS_DRAWER: NavItemDef[] = [
  { to: '/summary', icon: BarChart3, label: 'สรุปข้อมูล' },
  { to: '/inventory', icon: Boxes, label: 'คลังสินค้า' },
  { to: '/attendance-management', icon: ClipboardCheck, label: 'เข้า-ออกงาน' },
  { to: '/settings', icon: Settings, label: 'ตั้งค่า' },
];
