// 📄 components/layout/navConfig.ts — รายการเมนู (label/icon/ลิงก์) แยกตามกลุ่มสิทธิ์ ใช้ร่วม Sidebar+Drawer
//    export MEMBER_ITEMS/STAFF_ITEMS/STORE_ITEMS_*/SYSTEM_ITEMS — แก้เมนูที่เดียว มีผลทั้ง sidebar และ drawer
import {
  LayoutDashboard, Boxes, Settings, CalendarClock, BarChart3,
  ClipboardCheck, ShoppingBag, PiggyBank, Database, FileSpreadsheet, IdCard, ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItemDef {
  to: string;
  icon: LucideIcon;
  label: string;
  mobileLabel?: string; // label สั้นกว่าสำหรับ mobile bottom nav (ที่ว่างจำกัด)
}

// สมาชิก (ไม่ใช่ staff) เท่านั้น — ใช้ใน sidebar + mobile drawer
// ⭐️ รวม "บัตรสมาชิก" (/register) ไว้ที่นี่ — หลังรวมแถบล่างเป็น MobileBottomNav ตัวเดียวแล้ว
//    ปุ่มลัด ร้านค้า/บัตรสมาชิก ของ MemberBottomNav ตัวเก่าถูกลบ สมาชิกเข้าบัตรได้ทาง sidebar/drawer
export const MEMBER_ITEMS: NavItemDef[] = [
  { to: '/pre-order', icon: ShoppingBag, label: 'สั่งจอง', mobileLabel: 'จอง' },
  { to: '/register', icon: IdCard, label: 'บัตรสมาชิก' },
  { to: '/my-sales', icon: PiggyBank, label: 'ยอดฝากขาย', mobileLabel: 'ฝากขาย' },
];

// staff ทุกคน (ADMIN/CASHIER) — ใช้ใน sidebar (กลุ่ม "พนักงาน" ต่อจาก POS/ออเดอร์) + mobile drawer
export const STAFF_ITEMS: NavItemDef[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'สรุปยอดขาย' },
  { to: '/schedules', icon: CalendarClock, label: 'ตารางกะ' },
];

// ⭐️ จัดการร้าน — ADMIN + MANAGER เห็นได้ทั้งคู่ (กลุ่ม "ผู้จัดการ" ใน sidebar)
//   หมายเหตุ: หน้าราคา&แต้ม / กลุ่มสมาชิก เป็นแท็บ "ภายใน" /settings ไม่ใช่ route แยก จึงไม่มีในนี้
export const STORE_ITEMS_SIDEBAR: NavItemDef[] = [
  { to: '/summary', icon: BarChart3, label: 'สรุปข้อมูล' },
  { to: '/accounting-summary', icon: FileSpreadsheet, label: 'สรุปบัญชี' },
  { to: '/inventory', icon: Boxes, label: 'คลังสินค้า' },
  { to: '/settings', icon: Settings, label: 'ตั้งค่า' },
  { to: '/attendance-management', icon: ClipboardCheck, label: 'เข้า-ออกงาน' },
];

// ⭐️ งานระบบ — ADMIN เท่านั้น (สำรอง/กู้คืนฐานข้อมูล)
export const SYSTEM_ITEMS: NavItemDef[] = [
  { to: '/backup', icon: Database, label: 'สำรอง & กู้คืนข้อมูล' },
];

// ⭐️ SUPER ADMIN — ADMIN เท่านั้น (หน้าควบคุม POS ทุกร้านแบบ multi-tenant)
export const ADMIN_ITEMS: NavItemDef[] = [
  { to: '/super-admin', icon: ShieldCheck, label: 'Super Admin' },
];

// mobile drawer — ลำดับเดิม (ตั้งค่าอยู่ท้ายสุด ต่างจาก sidebar)
export const STORE_ITEMS_DRAWER: NavItemDef[] = [
  { to: '/summary', icon: BarChart3, label: 'สรุปข้อมูล' },
  { to: '/accounting-summary', icon: FileSpreadsheet, label: 'สรุปบัญชี' },
  { to: '/inventory', icon: Boxes, label: 'คลังสินค้า' },
  { to: '/attendance-management', icon: ClipboardCheck, label: 'เข้า-ออกงาน' },
  { to: '/settings', icon: Settings, label: 'ตั้งค่า' },
];
