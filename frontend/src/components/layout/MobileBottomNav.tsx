// 📄 components/layout/MobileBottomNav.tsx — แถบเมนูล่างจอ (mobile) สำหรับ staff/cashier
//    ทำอะไร: โชว์แท็บลัดตาม role (CASHIER→POS, staff→สรุปยอด, + เมนู/แจ้งเตือน/Home) + ปุ่มเปิด drawer
import { Link } from 'react-router-dom';
import { Bell, Store, Menu, User, Home, ShoppingBag, LayoutDashboard } from 'lucide-react';
import { MobNavItem } from './NavItem';

interface MobileBottomNavProps {
  isStaff: boolean;
  isCashier: boolean; // ⭐️ ช่อง POS เป็นของ CASHIER เท่านั้น — ADMIN ให้เป็นช่องสั่งจองแทน
  unreadCount: number;
  pendingOrders: number;
  onOpenMobileMenu: () => void;
  onOpenProfile: () => void;
}

// ⭐️ FIX: เดิมยัด 6 ปุ่มในแถวเดียวดูอึดอัด — เปลี่ยนเป็นแถบลอยเป็นเกาะ (ธีม/การจัดวางแบบหน้า
// Home) เหลือ 4 ปุ่มหลัก + ปุ่มยกสูงตรงกลางแบบ FAB
// ⭐️ Design-ref update — สลับให้ "หน้าหลัก" เป็นปุ่ม FAB ตรงกลางแทน (ตามดีไซน์อ้างอิงใหม่ที่ให้
// หน้าหลักเป็นจุดศูนย์กลางเด่นสุดของแถบ) ส่วน "เมนู" (รวมออเดอร์/ฝากขาย/ออกจากระบบ/เมนูผู้จัดการ
// ผ่าน MobileMenuDrawer) ย้ายไปอยู่ช่องซ้ายแทนที่หน้าหลักเดิม — badge ออเดอร์ค้างย้ายตามไปด้วย
export function MobileBottomNav({
  isStaff, isCashier, unreadCount, pendingOrders,
  onOpenMobileMenu, onOpenProfile,
}: MobileBottomNavProps) {
  const moreBadge = isStaff ? pendingOrders : 0;

  return (
    <div className="md:hidden fixed bottom-3 inset-x-3 z-50">
      <nav className="relative bg-white rounded-full shadow-[0_8px_24px_rgba(241,43,107,0.18)] border border-brand-border h-16 flex items-center px-1">
        <div className="flex-1 flex items-center justify-around h-full">
          <button onClick={onOpenMobileMenu} className="relative flex flex-col items-center justify-center gap-0.5 w-full h-full text-gray-400 hover:text-brand transition-colors duration-150">
            <span className="relative">
              <Menu size={20} />
              {moreBadge > 0 && (
                <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full border border-white">
                  {moreBadge > 9 ? '9+' : moreBadge}
                </span>
              )}
            </span>
            <span className="text-[10px] font-medium">เมนู</span>
          </button>
          {/* ⭐️ ไม่มาร์คว่าอ่านตอนกดเข้าไปดูอีกแล้ว — ดูรายละเอียดที่ Sidebar.tsx */}
          <MobNavItem to="/notifications" icon={<Bell size={20} />} label="แจ้งเตือน" badge={unreadCount} />
        </div>

        {/* ⭐️ ที่ว่างตรงกลางให้ปุ่ม FAB ลอยทับ */}
        <div className="w-16 shrink-0" />

        <div className="flex-1 flex items-center justify-around h-full">
          {/* ⭐️ CASHIER → POS, ADMIN/MANAGER (staff อื่น) → สรุปยอดขาย, MEMBER → สั่งจอง
              (เดิม staff ที่ไม่ใช่ CASHIER ตกไป else = /pre-order ซึ่งตอนนี้ MEMBER-only จะโดนบล็อก) */}
          {isCashier
            ? <MobNavItem to="/pos" icon={<Store size={20} />} label="POS" />
            : isStaff
              ? <MobNavItem to="/dashboard" icon={<LayoutDashboard size={20} />} label="สรุป" />
              : <MobNavItem to="/pre-order" icon={<ShoppingBag size={20} />} label="จอง" />}
          <button onClick={onOpenProfile} className="flex flex-col items-center justify-center gap-0.5 w-full h-full text-gray-400 hover:text-brand transition-colors duration-150">
            <User size={20} />
            <span className="text-[10px] font-medium">โปรไฟล์</span>
          </button>
        </div>

        <Link
          to="/home"
          className="absolute left-1/2 -translate-x-1/2 -top-5 w-14 h-14 bg-gradient-to-br from-brand to-brand-dark text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          aria-label="หน้าหลัก"
        >
          <Home size={22} />
        </Link>
      </nav>
    </div>
  );
}
