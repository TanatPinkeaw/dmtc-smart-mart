import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

const NAV_ACTIVE = 'bg-brand text-white shadow-sm';
const NAV_DEFAULT = 'text-gray-500 hover:bg-brand-bg hover:text-brand';
const MOB_ACTIVE = 'text-brand';
const MOB_DEFAULT = 'text-gray-400 hover:text-brand';

const desktopLink = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 w-full ${isActive ? NAV_ACTIVE : NAV_DEFAULT}`;

const mobileLink = ({ isActive }: { isActive: boolean }) =>
  `flex flex-col items-center justify-center gap-0.5 w-full h-full transition-colors duration-150 ${isActive ? MOB_ACTIVE : MOB_DEFAULT}`;

interface NavItemProps {
  to: string;
  icon: ReactNode;
  label: string;
  badge?: number;
  onClick?: () => void;
}

export const NavItem = ({ to, icon, label, badge, onClick }: NavItemProps) => (
  <NavLink to={to} onClick={onClick} className={desktopLink}>
    <div className="relative shrink-0">
      {icon}
      {!!badge && (
        <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full border border-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </div>
    <span className="truncate">{label}</span>
  </NavLink>
);

export const MobNavItem = ({ to, icon, label, badge, onClick }: NavItemProps) => (
  <NavLink to={to} onClick={onClick} className={mobileLink}>
    <div className="relative">
      {icon}
      {!!badge && (
        <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full border border-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </div>
    <span className="text-[10px] font-medium">{label}</span>
  </NavLink>
);
