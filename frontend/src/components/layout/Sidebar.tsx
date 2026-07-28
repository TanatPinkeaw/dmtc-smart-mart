import { Bell, Store, ClipboardList, LogOut, Home } from 'lucide-react';
import { NavItem } from './NavItem';
import { MEMBER_ITEMS, STAFF_ITEMS, STORE_ITEMS_SIDEBAR, SYSTEM_ITEMS } from './navConfig';

interface SidebarProps {
  isStaff: boolean;
  isAdmin: boolean;
  isStoreAdmin: boolean; // ⭐️ ADMIN หรือ MANAGER — เห็นเมนูจัดการร้าน
  isCashier: boolean; // ⭐️ POS เป็นเมนูของ CASHIER เท่านั้น (ADMIN/MANAGER ขายหน้าร้านไม่ได้)
  unreadCount: number;
  pendingOrders: number;
  fullName: string;
  role: string;
  profileImageUrl?: string | null; // ⭐️ Home page feature — รูปโปรไฟล์ (fallback: Default profile.png)
  onOpenProfile: () => void;
  onLogoutClick: () => void;
}

export function Sidebar({
  isStaff, isAdmin, isStoreAdmin, isCashier, unreadCount, pendingOrders,
  fullName, role, profileImageUrl, onOpenProfile, onLogoutClick,
}: SidebarProps) {
  return (
    <aside className="hidden md:flex w-56 lg:w-60 bg-white border-r border-brand-border shadow-sm flex-col shrink-0 z-40">
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-brand-border">
        <img src="/logo-192.png" alt="DMTC Mart" className="w-9 h-9 rounded-xl shrink-0 object-contain" />
        <div>
          <p className="text-sm font-bold text-gray-900">DMTC Mart</p>
          <p className="text-[10px] text-gray-400">สหกรณ์โรงเรียน</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-hide">
        {/* ⭐️ ทางกลับหน้า Home กลาง — ไม่งั้นเข้าโมดูลนึงแล้วจะสลับ work/shop หรือไปโมดูลอื่นไม่ได้เลย
            นอกจากพิมพ์ URL เอง (ผู้ใช้สับสนว่าตัวเลือก "เข้างาน/ซื้อของ" หายไปไหน — จริงๆ ย้ายไปอยู่ที่นี่) */}
        <NavItem to="/home" icon={<Home size={18} />} label="หน้าหลัก" />
        {/* ⭐️ ไม่มี onClick มาร์คว่าอ่านแล้วที่นี่อีก — แค่เปิดหน้าแจ้งเตือนไม่ถือว่าอ่าน
            ผู้ใช้ต้องคลิกรายการนั้นๆ หรือกดปุ่ม "อ่านทั้งหมด" ในหน้านั้นเอง */}
        <NavItem to="/notifications" icon={<Bell size={18} />} label="แจ้งเตือน" badge={unreadCount} />

        {!isStaff && MEMBER_ITEMS.map(item => (
          <NavItem key={item.to} to={item.to} icon={<item.icon size={18} />} label={item.label} />
        ))}

        {isStaff && (
          <>
            <div className="pt-2 pb-1"><p className="px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">พนักงาน</p></div>
            {isCashier && <NavItem to="/pos" icon={<Store size={18} />} label="หน้าขาย (POS)" />}
            <NavItem to="/orders" icon={<ClipboardList size={18} />} label="จัดการออเดอร์" badge={pendingOrders} />
            {STAFF_ITEMS.map(item => (
              <NavItem key={item.to} to={item.to} icon={<item.icon size={18} />} label={item.label} />
            ))}
          </>
        )}

        {isStoreAdmin && (
          <>
            <div className="pt-2 pb-1"><p className="px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">ผู้จัดการ</p></div>
            {STORE_ITEMS_SIDEBAR.map(item => (
              <NavItem key={item.to} to={item.to} icon={<item.icon size={18} />} label={item.label} />
            ))}
            {/* ⭐️ งานระบบ (สำรอง/กู้คืน) เฉพาะ ADMIN */}
            {isAdmin && SYSTEM_ITEMS.map(item => (
              <NavItem key={item.to} to={item.to} icon={<item.icon size={18} />} label={item.label} />
            ))}
          </>
        )}
      </nav>

      {/* User footer */}
      <div className="border-t border-brand-border p-3 space-y-1">
        <button onClick={onOpenProfile} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-brand-bg hover:text-brand transition-colors duration-150">
          <img src={profileImageUrl || '/Default profile.png'} alt={fullName} className="w-7 h-7 rounded-full object-cover shrink-0" />
          <div className="flex-1 text-left min-w-0">
            <p className="text-xs font-semibold text-gray-800 truncate">{fullName}</p>
            <p className="text-[10px] text-gray-400">{role}</p>
          </div>
        </button>
        {!isStaff && (
          <button onClick={onLogoutClick} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors duration-150">
            <LogOut size={16} /> <span className="text-xs">ออกจากระบบ</span>
          </button>
        )}
      </div>
    </aside>
  );
}
