import { X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { STAFF_ITEMS, ADMIN_ITEMS_DRAWER } from './navConfig';

interface MobileMenuDrawerProps {
  isAdmin: boolean;
  onClose: () => void;
}

const drawerLinkClass = 'flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-gray-700 hover:bg-brand-bg hover:text-brand transition-colors duration-150';

export function MobileMenuDrawer({ isAdmin, onClose }: MobileMenuDrawerProps) {
  return (
    <div className="md:hidden fixed inset-0 z-[90] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl shadow-xl w-full max-h-[75dvh] overflow-hidden flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border bg-brand-bg shrink-0">
          <h3 className="font-semibold text-gray-900">เมนูเพิ่มเติม</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-white transition-colors duration-150"><X size={18} /></button>
        </div>
        <div className="p-3 space-y-1 overflow-y-auto">
          {STAFF_ITEMS.map(item => (
            <NavLink key={item.to} to={item.to} onClick={onClose} className={drawerLinkClass}>
              <item.icon size={18} /> {item.label}
            </NavLink>
          ))}
          {isAdmin && ADMIN_ITEMS_DRAWER.map(item => (
            <NavLink key={item.to} to={item.to} onClick={onClose} className={drawerLinkClass}>
              <item.icon size={18} /> {item.label}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}
