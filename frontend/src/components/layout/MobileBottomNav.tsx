import { Bell, Store, Menu, User, Home, ShoppingBag } from 'lucide-react';
import { MobNavItem } from './NavItem';

interface MobileBottomNavProps {
  isStaff: boolean;
  unreadCount: number;
  pendingOrders: number;
  onOpenNotifications: () => void;
  onOpenMobileMenu: () => void;
  onOpenProfile: () => void;
}

// ⭐️ FIX: เดิมยัด 6 ปุ่มในแถวเดียว (หน้าหลัก/แจ้งเตือน/POS/ออเดอร์/เมนู/โปรไฟล์ หรือ
// หน้าหลัก/แจ้งเตือน/จอง/ฝากขาย/โปรไฟล์/ออกจากระบบ ฝั่งสมาชิก) ดูอึดอัดมากหลังเพิ่มปุ่มหน้าหลัก
// เปลี่ยนเป็นแถบลอยเป็นเกาะ (ธีม/การจัดวางแบบหน้า Home) เหลือ 4 ปุ่มหลักที่ใช้บ่อยสุด + ปุ่ม
// "เมนู" ยกสูงตรงกลางแบบ FAB รวมปุ่มที่เหลือ (ออเดอร์/ฝากขาย/ออกจากระบบ/เมนูผู้จัดการ) ไว้ใน
// MobileMenuDrawer แทน — ตัวเลข badge ของออเดอร์ค้าง ย้ายไปโชว์บนปุ่ม FAB แทนกันหลงไม่เห็น
export function MobileBottomNav({
  isStaff, unreadCount, pendingOrders, onOpenNotifications,
  onOpenMobileMenu, onOpenProfile,
}: MobileBottomNavProps) {
  const moreBadge = isStaff ? pendingOrders : 0;

  return (
    <div className="md:hidden fixed bottom-3 inset-x-3 z-50">
      <nav className="relative bg-white rounded-full shadow-[0_8px_24px_rgba(241,43,107,0.18)] border border-brand-border h-16 flex items-center px-1">
        <div className="flex-1 flex items-center justify-around h-full">
          <MobNavItem to="/home" icon={<Home size={20} />} label="หน้าหลัก" />
          <MobNavItem to="/notifications" icon={<Bell size={20} />} label="แจ้งเตือน" badge={unreadCount} onClick={onOpenNotifications} />
        </div>

        {/* ⭐️ ที่ว่างตรงกลางให้ปุ่ม FAB ลอยทับ */}
        <div className="w-16 shrink-0" />

        <div className="flex-1 flex items-center justify-around h-full">
          {isStaff
            ? <MobNavItem to="/pos" icon={<Store size={20} />} label="POS" />
            : <MobNavItem to="/pre-order" icon={<ShoppingBag size={20} />} label="จอง" />}
          <button onClick={onOpenProfile} className="flex flex-col items-center justify-center gap-0.5 w-full h-full text-gray-400 hover:text-brand transition-colors duration-150">
            <User size={20} />
            <span className="text-[10px] font-medium">โปรไฟล์</span>
          </button>
        </div>

        <button
          onClick={onOpenMobileMenu}
          className="absolute left-1/2 -translate-x-1/2 -top-5 w-14 h-14 rounded-full bg-gradient-to-br from-brand to-brand-dark shadow-lg flex items-center justify-center text-white active:scale-90 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          aria-label="เมนูเพิ่มเติม"
        >
          <Menu size={22} />
          {moreBadge > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full border-2 border-white">
              {moreBadge > 9 ? '9+' : moreBadge}
            </span>
          )}
        </button>
      </nav>
    </div>
  );
}
