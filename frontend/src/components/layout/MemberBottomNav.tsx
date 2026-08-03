import { NavLink } from 'react-router-dom';
import { Store, IdCard } from 'lucide-react';

// ⭐️ Phase 1 (5-day plan) — In-App Navigation สำหรับ MEMBER โดยเฉพาะ แยกจาก MobileBottomNav ของ
// staff/POS เดิมทั้งหมด (component นั้นออกแบบมาสำหรับ Menu/Notifications/FAB Home/POS ซึ่งไม่ตรงกับ
// สิ่งที่ต้องการที่นี่: ให้สมาชิกสลับไปมาระหว่าง "ร้านค้า" (/pre-order) กับ "บัตรสมาชิก" (/register)
// ได้ง่ายๆ โดยไม่ต้องพึ่ง LINE Rich Menu ?path= ที่เจอปัญหา deep-link ใน LINE in-app browser
// ใช้ที่ 2 จุดเท่านั้น: PreOrder.tsx (แทนที่ MobileBottomNav เดิมใน Layout.tsx เฉพาะ path /pre-order
// กันไม่ให้มีแถบล่างซ้อนกัน 2 อัน) และ Register.tsx (stage === 'authenticated' เท่านั้น)
const ITEMS = [
  { to: '/pre-order', icon: Store, label: 'ร้านค้า' },
  { to: '/register', icon: IdCard, label: 'บัตรสมาชิก' },
] as const;

export function MemberBottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 w-full z-40 bg-white border-t border-brand-border shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
      <div className="flex items-stretch justify-around max-w-lg mx-auto">
        {ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-bold transition-colors duration-150 ${
                isActive ? 'text-brand' : 'text-gray-400 hover:text-brand-mid'
              }`
            }
          >
            <Icon size={22} />
            {label}
          </NavLink>
        ))}
      </div>
      {/* ⭐️ เผื่อพื้นที่ safe-area ของมือถือ (iPhone home indicator ฯลฯ) ไม่ให้แถบชิดขอบจอเกินไป */}
      <div style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
    </nav>
  );
}
