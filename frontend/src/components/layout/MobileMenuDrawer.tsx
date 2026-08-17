// 📄 components/layout/MobileMenuDrawer.tsx — ลิ้นชักเมนู (mobile) ที่เลื่อนออกมาเมื่อกดปุ่ม Menu
//    ทำอะไร: แสดงลิงก์ครบทุกกลุ่มตาม role (ที่แถบล่างใส่ไม่หมด) + ปุ่มออกจากระบบ
import { X, LogOut, ClipboardList } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { STAFF_ITEMS, STORE_ITEMS_DRAWER, SYSTEM_ITEMS, MEMBER_ITEMS } from './navConfig';

interface MobileMenuDrawerProps {
  isStaff: boolean;
  isAdmin: boolean;
  isStoreAdmin: boolean; // ⭐️ ADMIN หรือ MANAGER
  pendingOrders?: number;
  onClose: () => void;
  onLogoutClick?: () => void;
}

const drawerLinkClass = 'flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-gray-700 hover:bg-brand-bg hover:text-brand transition-colors duration-150';

export function MobileMenuDrawer({ isStaff, isAdmin, isStoreAdmin, pendingOrders = 0, onClose, onLogoutClick }: MobileMenuDrawerProps) {
  return (
    <div className="md:hidden fixed inset-0 z-[90] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl shadow-xl w-full max-h-[75dvh] overflow-hidden flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-brand to-brand-dark shrink-0">
          <h3 className="font-semibold text-white">เมนูเพิ่มเติม</h3>
          <button onClick={onClose} className="text-white/90 hover:text-white p-1 rounded-lg hover:bg-white/20 active:scale-90 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="ปิด"><X size={18} /></button>
        </div>
        <div className="p-3 space-y-1 overflow-y-auto">
          {isStaff ? (
            <>
              {/* ⭐️ ออเดอร์ ย้ายมาจากแถบล่างเดิม (เหลือพื้นที่ให้ปุ่มหลักในแถบลอย) */}
              <NavLink to="/orders" onClick={onClose} className={drawerLinkClass}>
                <div className="relative shrink-0">
                  <ClipboardList size={18} />
                  {pendingOrders > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full border border-white">
                      {pendingOrders > 9 ? '9+' : pendingOrders}
                    </span>
                  )}
                </div>
                ออเดอร์
              </NavLink>
              {STAFF_ITEMS.map(item => (
                <NavLink key={item.to} to={item.to} onClick={onClose} className={drawerLinkClass}>
                  <item.icon size={18} /> {item.label}
                </NavLink>
              ))}
              {isStoreAdmin && STORE_ITEMS_DRAWER.map(item => (
                <NavLink key={item.to} to={item.to} onClick={onClose} className={drawerLinkClass}>
                  <item.icon size={18} /> {item.label}
                </NavLink>
              ))}
              {isAdmin && SYSTEM_ITEMS.map(item => (
                <NavLink key={item.to} to={item.to} onClick={onClose} className={drawerLinkClass}>
                  <item.icon size={18} /> {item.label}
                </NavLink>
              ))}
            </>
          ) : (
            <>
              {/* ⭐️ สั่งจอง ย้ายไปอยู่แถบลอยโดยตรงแล้ว เหลือฝากขาย + บัตรสมาชิก + ออกจากระบบ */}
              {MEMBER_ITEMS.filter(item => item.to !== '/pre-order').map(item => (
                <NavLink key={item.to} to={item.to} onClick={onClose} className={drawerLinkClass}>
                  <item.icon size={18} /> {item.label}
                </NavLink>
              ))}
              <button
                onClick={() => { onClose(); onLogoutClick?.(); }}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition-colors duration-150 w-full text-left"
              >
                <LogOut size={18} /> ออกจากระบบ
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
