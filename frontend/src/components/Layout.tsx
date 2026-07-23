// ✅ CHANGED: sidebar design, bottom nav, profile modal → DMTC Mart theme
// 🔒 UNCHANGED: fetchNotificationsAndBadge, socket listeners, handleUpdateProfile, handleLogoutClick, handleOpenNotifications, isStaff logic, all navigation routes

import { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Swal from '../swal';
import { BRAND } from '../theme';
import api from '../api';
import { SocketProvider, useSocket } from '../SocketContext';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { ChangePasswordModal } from './ChangePasswordModal';
import { Sidebar } from './layout/Sidebar';
import { MobileBottomNav } from './layout/MobileBottomNav';
import { MobileMenuDrawer } from './layout/MobileMenuDrawer';
import { ProfileModal } from './layout/ProfileModal';

// ─── LayoutInner ─────────────────────────────────────────────────────────────
function LayoutInner() {
  const socket = useSocket();
  const user = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<any[]>([]);
  const [pendingOrders, setPendingOrders] = useState(0);
  const [showProfileModal, setShowProfileModal] = useState(false);
  // ⭐️ Security remediation — บังคับเปลี่ยนรหัสผ่านชั่วคราวก่อนใช้งานหน้าอื่น (ปิด modal เองไม่ได้ ดู ChangePasswordModal forceChange)
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(!!user.must_change_password);
  // ⭐️ FIX: bottom nav มือถือเดิมมีแค่ POS/ออเดอร์/(ตั้งค่าเฉพาะ ADMIN) — ขาดหน้า Dashboard, Schedules,
  // Summary, Inventory, AttendanceManagement ที่ desktop sidebar มีครบ ทำให้กด staff เข้าหน้าพวกนี้จากมือถือไม่ได้เลย
  // เพิ่มปุ่ม "เมนู" เปิด bottom sheet รวมหน้าที่เหลือแทน ให้ครบตาม role เหมือน desktop
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [profileForm, setProfileForm] = useState({ phone_number: user.phone_number || '' });
  const [profileLoading, setProfileLoading] = useState(false);

  const sessionMode = localStorage.getItem('session_mode');
  const isStaff = ['ADMIN', 'CASHIER'].includes(user.role) && sessionMode !== 'shop';
  const isAdmin = isStaff && user.role === 'ADMIN';
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
    Swal.fire({ title: 'ออกจากระบบ?', icon: 'question', showCancelButton: true, confirmButtonColor: BRAND, cancelButtonColor: '#9ca3af', confirmButtonText: 'ออกจากระบบ', cancelButtonText: 'ยกเลิก' })
      .then(async (r) => {
        if (r.isConfirmed) {
          try {
            // ⭐️ Sprint 2 — B5: Call logout endpoint
            await api.post('/auth/logout');
          } catch (err) {
            console.error('Logout error:', err);
          } finally {
            // ⭐️ Security remediation — token cookie ถูก backend เคลียร์เองใน /auth/logout แล้ว
            // เหลือแค่ล้างข้อมูล user (ไม่ลับ) ฝั่ง client
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
      <Sidebar
        isStaff={isStaff}
        isAdmin={isAdmin}
        unreadCount={unreadCount}
        pendingOrders={pendingOrders}
        onOpenNotifications={handleOpenNotifications}
        initials={initials}
        fullName={user.full_name}
        role={user.role}
        onOpenProfile={() => setShowProfileModal(true)}
        onLogoutClick={handleLogoutClick}
      />

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main className="flex-1 h-screen overflow-y-auto pb-16 md:pb-0">
        <Outlet />
      </main>

      <MobileBottomNav
        isStaff={isStaff}
        unreadCount={unreadCount}
        pendingOrders={pendingOrders}
        onOpenNotifications={handleOpenNotifications}
        onOpenMobileMenu={() => setShowMobileMenu(true)}
        onOpenProfile={() => setShowProfileModal(true)}
        onLogoutClick={handleLogoutClick}
      />

      {showMobileMenu && (
        <MobileMenuDrawer isAdmin={isAdmin} onClose={() => setShowMobileMenu(false)} />
      )}

      {showProfileModal && (
        <ProfileModal
          initials={initials}
          fullName={user.full_name}
          studentIdOrUsername={user.student_id || user.username}
          role={user.role}
          phoneNumber={profileForm.phone_number}
          onPhoneNumberChange={(value) => setProfileForm({ ...profileForm, phone_number: value })}
          onSubmit={handleUpdateProfile}
          loading={profileLoading}
          onClose={() => setShowProfileModal(false)}
          onOpenChangePassword={() => { setShowProfileModal(false); setShowChangePasswordModal(true); }}
        />
      )}

      {showChangePasswordModal && (
        <ChangePasswordModal
          userId={user.id}
          forceChange={!!user.must_change_password}
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
