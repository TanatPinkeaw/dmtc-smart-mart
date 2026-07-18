// ✅ CHANGED: sidebar design, bottom nav, profile modal → DMTC Mart theme
// 🔒 UNCHANGED: fetchNotificationsAndBadge, socket listeners, handleUpdateProfile, handleLogoutClick, handleOpenNotifications, isStaff logic, all navigation routes

import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  ShoppingBag, LayoutDashboard, Boxes, Settings, LogOut, X,
  User, KeyRound, Phone, ClipboardList, Bell, PiggyBank,
  ClipboardCheck, CalendarDays, CalendarClock, Store, BarChart3, Menu
} from 'lucide-react';
import Swal from '../swal';
import api from '../api';
import { SocketProvider, useSocket } from '../SocketContext';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { ChangePasswordModal } from './ChangePasswordModal';

// ─── Token shortcuts ─────────────────────────────────────────────────────────
const NAV_ACTIVE  = 'bg-[#FFF5F7] text-[#F12B6B] border-l-4 border-[#F12B6B]';
const NAV_DEFAULT = 'text-gray-400 hover:bg-[#FFF5F7] hover:text-[#F12B6B] border-l-4 border-transparent';
const MOB_ACTIVE  = 'text-[#F12B6B]';
const MOB_DEFAULT = 'text-gray-400 hover:text-[#F12B6B]';

const desktopLink = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 w-full ${isActive ? NAV_ACTIVE : NAV_DEFAULT}`;

const mobileLink = ({ isActive }: { isActive: boolean }) =>
  `flex flex-col items-center justify-center gap-0.5 w-full h-full transition-colors duration-150 ${isActive ? MOB_ACTIVE : MOB_DEFAULT}`;

// ─── NavItem helper ───────────────────────────────────────────────────────────
const NavItem = ({ to, icon, label, badge, onClick }: { to: string; icon: React.ReactNode; label: string; badge?: number; onClick?: () => void }) => (
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

const MobNavItem = ({ to, icon, label, badge, onClick }: { to: string; icon: React.ReactNode; label: string; badge?: number; onClick?: () => void }) => (
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

// ─── LayoutInner ─────────────────────────────────────────────────────────────
function LayoutInner() {
  const socket = useSocket();
  const user = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<any[]>([]);
  const [pendingOrders, setPendingOrders] = useState(0);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  // ⭐️ FIX: bottom nav มือถือเดิมมีแค่ POS/ออเดอร์/(ตั้งค่าเฉพาะ ADMIN) — ขาดหน้า Dashboard, Schedules,
  // Summary, Inventory, AttendanceManagement ที่ desktop sidebar มีครบ ทำให้กด staff เข้าหน้าพวกนี้จากมือถือไม่ได้เลย
  // เพิ่มปุ่ม "เมนู" เปิด bottom sheet รวมหน้าที่เหลือแทน ให้ครบตาม role เหมือน desktop
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [profileForm, setProfileForm] = useState({ phone_number: user.phone_number || '' });
  const [profileLoading, setProfileLoading] = useState(false);

  const sessionMode = localStorage.getItem('session_mode');
  const isStaff = ['ADMIN', 'CASHIER'].includes(user.role) && sessionMode !== 'shop';
  const unreadCount = notifications.filter(n => !n.is_read).length;

  const fetchNotificationsAndBadge = async () => {
    try {
      const t = Date.now();
      const resNoti = await api.get(`/notifications?t=${t}`);
      setNotifications(resNoti.data);
      if (isStaff) {
        const resBadge = await api.get(`/orders/pending-count?t=${t}`);
        setPendingOrders(resBadge.data.count);
      }
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (!user.id || !socket) return;
    fetchNotificationsAndBadge();
    socket.on(`notification_user_${user.id}`, (data) => {
      fetchNotificationsAndBadge();
      if (data?.message) Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: data.message, showConfirmButton: false, timer: 3500, timerProgressBar: true });
    });
    socket.on('new_order_received', () => { if (isStaff) fetchNotificationsAndBadge(); });
    socket.on('order_status_changed', () => { if (isStaff) fetchNotificationsAndBadge(); });
    socket.on('notifications_updated', (data) => {
      if (!isStaff) return;
      fetchNotificationsAndBadge();
      if (data?.message) Swal.fire({ toast: true, position: 'top-end', icon: 'warning', title: data.message, showConfirmButton: false, timer: 3500, timerProgressBar: true });
    });
    return () => {
      socket.off(`notification_user_${user.id}`);
      socket.off('new_order_received');
      socket.off('order_status_changed');
      socket.off('notifications_updated');
    };
  }, [user.id, socket]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    // ⭐️ SECURITY FIX (#4) — เปลี่ยนรหัสผ่านย้ายไปโมดัล "เปลี่ยนรหัสผ่าน" (ยืนยันรหัสเดิม) ทางเดียว
    //   ฟอร์มนี้อัปเดตแค่เบอร์โทร
    setProfileLoading(true);
    try {
      await api.put(`/users/${user.id}/profile`, { full_name: user.full_name, phone_number: profileForm.phone_number || null });
      localStorage.setItem('user', JSON.stringify({ ...user, phone_number: profileForm.phone_number }));
      Swal.fire({ icon: 'success', title: 'อัปเดตข้อมูลสำเร็จ!', showConfirmButton: false, timer: 1500 });
      setShowProfileModal(false);
    } catch (error: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(error) }); }
    finally { setProfileLoading(false); }
  };

  const handleLogoutClick = () => {
    Swal.fire({ title: 'ออกจากระบบ?', icon: 'question', showCancelButton: true, confirmButtonColor: '#F12B6B', cancelButtonColor: '#9ca3af', confirmButtonText: 'ออกจากระบบ', cancelButtonText: 'ยกเลิก' })
      .then(async (r) => {
        if (r.isConfirmed) {
          try {
            // ⭐️ Sprint 2 — B5: Call logout endpoint
            await api.post('/auth/logout');
          } catch (err) {
            console.error('Logout error:', err);
          } finally {
            // Clear localStorage and redirect
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            localStorage.removeItem('user');
            localStorage.removeItem('session_mode');
            navigate('/login');
          }
        }
      });
  };

  const handleOpenNotifications = async () => {
    if (unreadCount > 0) {
      try { await api.put('/notifications/read-all'); setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 }))); }
      catch (e) { console.error(e); }
    }
  };

  const initials = user.full_name?.charAt(0)?.toUpperCase() || 'U';

  return (
    <div className="flex h-screen bg-gray-50 font-sans overflow-hidden">

      {/* ── Desktop Sidebar ─────────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-56 lg:w-60 bg-white border-r border-[#F6C7C7] flex-col shrink-0 z-40">

        {/* Brand — ⭐️ FIX: ใช้โลโก้จริงของร้านแทนกล่องไอคอน ShoppingBag เดิม */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-[#F6C7C7]">
          <img src="/logo-192.png" alt="DMTC Mart" className="w-9 h-9 rounded-xl shrink-0 object-contain" />
          <div>
            <p className="text-sm font-bold text-gray-900">DMTC Mart</p>
            <p className="text-[10px] text-gray-400">สหกรณ์โรงเรียน</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-hide">
          <NavItem to="/notifications" icon={<Bell size={18} />} label="แจ้งเตือน" badge={unreadCount} onClick={handleOpenNotifications} />

          {/* ⭐️ PreOrder only for MEMBER (not for Cashier/Admin) */}
          {!isStaff && <NavItem to="/pre-order" icon={<ShoppingBag size={18} />} label="สั่งจอง" />}

          {!isStaff && <NavItem to="/my-sales" icon={<PiggyBank size={18} />} label="ยอดฝากขาย" />}

          {isStaff && (
            <>
              <div className="pt-2 pb-1"><p className="px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">พนักงาน</p></div>
              <NavItem to="/pos" icon={<Store size={18} />} label="หน้าขาย (POS)" />
              <NavItem to="/orders" icon={<ClipboardList size={18} />} label="จัดการออเดอร์" badge={pendingOrders} />
              <NavItem to="/dashboard" icon={<LayoutDashboard size={18} />} label="สรุปยอดขาย" />
              {/* ⭐️ CASHIER ดูตารางกะได้ด้วย (อ่านอย่างเดียว — แก้ไข/ลบทำได้เฉพาะ ADMIN ในหน้านี้เอง) */}
              <NavItem to="/schedules" icon={<CalendarClock size={18} />} label="ตารางกะ" />
            </>
          )}

          {isStaff && user.role === 'ADMIN' && (
            <>
              <div className="pt-2 pb-1"><p className="px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">ผู้จัดการ</p></div>
              <NavItem to="/summary" icon={<BarChart3 size={18} />} label="สรุปข้อมูล" />
              <NavItem to="/inventory" icon={<Boxes size={18} />} label="คลังสินค้า" />
              <NavItem to="/settings" icon={<Settings size={18} />} label="ตั้งค่า" />
              <NavItem to="/attendance-management" icon={<ClipboardCheck size={18} />} label="เข้า-ออกงาน" />
            </>
          )}
        </nav>

        {/* User footer */}
        <div className="border-t border-[#F6C7C7] p-3 space-y-1">
          <button onClick={() => setShowProfileModal(true)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-[#FFF5F7] hover:text-[#F12B6B] transition-colors duration-150">
            <div className="w-7 h-7 bg-[#F12B6B] rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">{initials}</div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-xs font-semibold text-gray-800 truncate">{user.full_name}</p>
              <p className="text-[10px] text-gray-400">{user.role}</p>
            </div>
          </button>
          {!isStaff && (
            <button onClick={handleLogoutClick} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors duration-150">
              <LogOut size={16} /> <span className="text-xs">ออกจากระบบ</span>
            </button>
          )}
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main className="flex-1 h-screen overflow-y-auto pb-16 md:pb-0">
        <Outlet />
      </main>

      {/* ── Mobile Bottom Nav ─────────────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-[#F6C7C7] flex h-14 z-50 shadow-[0_-2px_8px_rgba(241,43,107,0.06)]">
        <MobNavItem to="/notifications" icon={<Bell size={20} />} label="แจ้งเตือน" badge={unreadCount} onClick={handleOpenNotifications} />
        <MobNavItem to="/pre-order" icon={<ShoppingBag size={20} />} label="จอง" />

        {!isStaff && <MobNavItem to="/my-sales" icon={<PiggyBank size={20} />} label="ฝากขาย" />}

        {isStaff && (
          <>
            <MobNavItem to="/pos" icon={<Store size={20} />} label="POS" />
            <MobNavItem to="/orders" icon={<ClipboardList size={20} />} label="ออเดอร์" badge={pendingOrders} />
            {/* ⭐️ FIX: เดิมมีแค่ปุ่ม "ตั้งค่า" โผล่เฉพาะ ADMIN ส่วนหน้าอื่น (Dashboard, Schedules, Summary,
                Inventory, AttendanceManagement) ไม่มีทางเข้าจากมือถือเลย — รวมเป็นปุ่ม "เมนู" เดียวแทน */}
            <button onClick={() => setShowMobileMenu(true)} className="flex flex-col items-center justify-center gap-0.5 w-full h-full text-gray-400 hover:text-[#F12B6B] transition-colors duration-150">
              <Menu size={20} />
              <span className="text-[10px] font-medium">เมนู</span>
            </button>
          </>
        )}

        <button onClick={() => setShowProfileModal(true)} className={`flex flex-col items-center justify-center gap-0.5 w-full h-full transition-colors duration-150 text-gray-400 hover:text-[#F12B6B]`}>
          <User size={20} />
          <span className="text-[10px] font-medium">โปรไฟล์</span>
        </button>

        {!isStaff && (
          <button onClick={handleLogoutClick} className="flex flex-col items-center justify-center gap-0.5 w-full h-full text-gray-400 hover:text-red-400 transition-colors duration-150">
            <LogOut size={20} />
            <span className="text-[10px] font-medium">ออก</span>
          </button>
        )}
      </nav>

      {/* ── Mobile Menu Drawer (หน้าที่เหลือให้ครบตาม role เหมือน desktop sidebar) ────── */}
      {showMobileMenu && (
        <div className="md:hidden fixed inset-0 z-[90] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowMobileMenu(false)} />
          <div className="relative bg-white rounded-t-2xl shadow-xl w-full max-h-[75dvh] overflow-hidden flex flex-col animate-fade-in">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#F6C7C7] bg-[#FFF5F7] shrink-0">
              <h3 className="font-semibold text-gray-900">เมนูเพิ่มเติม</h3>
              <button onClick={() => setShowMobileMenu(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-white transition-colors duration-150"><X size={18} /></button>
            </div>
            <div className="p-3 space-y-1 overflow-y-auto">
              <NavLink to="/dashboard" onClick={() => setShowMobileMenu(false)} className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-gray-700 hover:bg-[#FFF5F7] hover:text-[#F12B6B] transition-colors duration-150">
                <LayoutDashboard size={18} /> สรุปยอดขาย
              </NavLink>
              <NavLink to="/schedules" onClick={() => setShowMobileMenu(false)} className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-gray-700 hover:bg-[#FFF5F7] hover:text-[#F12B6B] transition-colors duration-150">
                <CalendarClock size={18} /> ตารางกะ
              </NavLink>
              {user.role === 'ADMIN' && (
                <>
                  <NavLink to="/summary" onClick={() => setShowMobileMenu(false)} className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-gray-700 hover:bg-[#FFF5F7] hover:text-[#F12B6B] transition-colors duration-150">
                    <BarChart3 size={18} /> สรุปข้อมูล
                  </NavLink>
                  <NavLink to="/inventory" onClick={() => setShowMobileMenu(false)} className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-gray-700 hover:bg-[#FFF5F7] hover:text-[#F12B6B] transition-colors duration-150">
                    <Boxes size={18} /> คลังสินค้า
                  </NavLink>
                  <NavLink to="/attendance-management" onClick={() => setShowMobileMenu(false)} className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-gray-700 hover:bg-[#FFF5F7] hover:text-[#F12B6B] transition-colors duration-150">
                    <ClipboardCheck size={18} /> เข้า-ออกงาน
                  </NavLink>
                  <NavLink to="/settings" onClick={() => setShowMobileMenu(false)} className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-gray-700 hover:bg-[#FFF5F7] hover:text-[#F12B6B] transition-colors duration-150">
                    <Settings size={18} /> ตั้งค่า
                  </NavLink>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Profile Modal ─────────────────────────────────────────────────────── */}
      {showProfileModal && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowProfileModal(false)} />
          <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#F6C7C7] bg-[#FFF5F7]">
              <div className="flex items-center gap-2">
                <User size={18} className="text-[#F12B6B]" />
                <h3 className="font-semibold text-gray-900">บัญชีของฉัน</h3>
              </div>
              <button onClick={() => setShowProfileModal(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-white transition-colors duration-150"><X size={18} /></button>
            </div>

            <form onSubmit={handleUpdateProfile} className="p-5 space-y-4 max-h-[80dvh] overflow-y-auto">
              {/* Avatar */}
              <div className="flex flex-col items-center pt-1 pb-3">
                <div className="w-14 h-14 bg-[#F12B6B] rounded-full flex items-center justify-center text-white text-xl font-bold mb-2">{initials}</div>
                <p className="font-semibold text-gray-900 text-sm">{user.full_name}</p>
                <p className="text-xs text-gray-400">{user.student_id || user.username}</p>
                <span className="mt-1.5 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FFF5F7] text-[#F12B6B] border border-[#FD94B4]">{user.role}</span>
              </div>

              {/* Phone */}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500"><Phone size={13} /> เบอร์โทรศัพท์</label>
                <input type="tel" value={profileForm.phone_number} onChange={e => setProfileForm({ ...profileForm, phone_number: e.target.value })} placeholder="08X-XXX-XXXX" className="w-full px-3 py-2.5 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F12B6B] transition-colors duration-150" />
                <p className="text-[11px] text-amber-600">⚠️ รหัสผ่านเริ่มต้นคือเบอร์โทรตอนสมัคร ถ้าเปลี่ยนเบอร์ควรเปลี่ยนรหัสผ่านด้วย</p>
              </div>

              {/* Change Password Button */}
              <div className="pt-3 border-t border-[#F6C7C7]">
                <button
                  type="button"
                  onClick={() => { setShowProfileModal(false); setShowChangePasswordModal(true); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#F12B6B] hover:bg-[#FF467E] text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95"
                >
                  <KeyRound size={16} /> เปลี่ยนรหัสผ่าน
                </button>
              </div>

              {/* ⭐️ SECURITY FIX (#4) — ลบช่องเปลี่ยนรหัสซ้ำที่ตั้งรหัสใหม่ได้โดยไม่ยืนยันรหัสเดิม
                  เหลือทางเดียวคือปุ่ม "เปลี่ยนรหัสผ่าน" ด้านบน (โมดัลที่บังคับกรอกรหัสเดิม) */}

              <button type="submit" disabled={profileLoading} className="w-full py-3 bg-[#F12B6B] hover:bg-[#FF467E] text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-50">
                {profileLoading ? 'กำลังบันทึก...' : 'บันทึกการเปลี่ยนแปลง'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Change Password Modal ─────────────────────────────── */}
      {showChangePasswordModal && (
        <ChangePasswordModal
          userId={user.id}
          onClose={() => setShowChangePasswordModal(false)}
        />
      )}

      <style>{`.scrollbar-hide::-webkit-scrollbar{display:none}.scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}`}</style>
    </div>
  );
}

export default function Layout() {
  return <SocketProvider><LayoutInner /></SocketProvider>;
}
