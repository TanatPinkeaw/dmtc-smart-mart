import { Bell, Store, ClipboardList, Menu, User, LogOut } from 'lucide-react';
import { MobNavItem } from './NavItem';
import { MEMBER_ITEMS } from './navConfig';

interface MobileBottomNavProps {
  isStaff: boolean;
  unreadCount: number;
  pendingOrders: number;
  onOpenNotifications: () => void;
  onOpenMobileMenu: () => void;
  onOpenProfile: () => void;
  onLogoutClick: () => void;
}

export function MobileBottomNav({
  isStaff, unreadCount, pendingOrders, onOpenNotifications,
  onOpenMobileMenu, onOpenProfile, onLogoutClick,
}: MobileBottomNavProps) {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-brand-border flex h-14 z-50 shadow-[0_-2px_8px_rgba(241,43,107,0.06)]">
      <MobNavItem to="/notifications" icon={<Bell size={20} />} label="แจ้งเตือน" badge={unreadCount} onClick={onOpenNotifications} />

      {!isStaff && MEMBER_ITEMS.map(item => (
        <MobNavItem key={item.to} to={item.to} icon={<item.icon size={20} />} label={item.mobileLabel ?? item.label} />
      ))}

      {isStaff && (
        <>
          <MobNavItem to="/pos" icon={<Store size={20} />} label="POS" />
          <MobNavItem to="/orders" icon={<ClipboardList size={20} />} label="ออเดอร์" badge={pendingOrders} />
          <button onClick={onOpenMobileMenu} className="flex flex-col items-center justify-center gap-0.5 w-full h-full text-gray-400 hover:text-brand transition-colors duration-150">
            <Menu size={20} />
            <span className="text-[10px] font-medium">เมนู</span>
          </button>
        </>
      )}

      <button onClick={onOpenProfile} className="flex flex-col items-center justify-center gap-0.5 w-full h-full transition-colors duration-150 text-gray-400 hover:text-brand">
        <User size={20} />
        <span className="text-[10px] font-medium">โปรไฟล์</span>
      </button>

      {!isStaff && (
        <button onClick={onLogoutClick} className="flex flex-col items-center justify-center gap-0.5 w-full h-full text-gray-400 hover:text-red-400 transition-colors duration-150">
          <LogOut size={20} />
          <span className="text-[10px] font-medium">ออก</span>
        </button>
      )}
    </nav>
  );
}
