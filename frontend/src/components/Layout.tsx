// ✅ CHANGED: sidebar design, bottom nav, profile modal → DMTC Mart theme
// 🔒 UNCHANGED: fetchNotificationsAndBadge, socket listeners, handleUpdateProfile, handleLogoutClick, handleOpenNotifications, isStaff logic, all navigation routes

import { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Swal from '../swal';
import { BRAND } from '../theme';
import api from '../api';
import { performLogout } from '../utils/logout';
import { SocketProvider, useSocket } from '../SocketContext';
import { getCurrentUser, getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { ChangePasswordModal } from './ChangePasswordModal';
import { Sidebar } from './layout/Sidebar';
import { MobileBottomNav } from './layout/MobileBottomNav';
import { MobileMenuDrawer } from './layout/MobileMenuDrawer';

// ─── LayoutInner ─────────────────────────────────────────────────────────────
function LayoutInner() {
  const socket = useSocket();
  const user = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<any[]>([]);
  const [pendingOrders, setPendingOrders] = useState(0);
  // ⭐️ Security remediation — บังคับเปลี่ยนรหัสผ่านชั่วคราวก่อนใช้งานหน้าอื่น (ปิด modal เองไม่ได้ ดู ChangePasswordModal forceChange)
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(!!user.must_change_password);
  // ⭐️ FIX: bottom nav มือถือเดิมมีแค่ POS/ออเดอร์/(ตั้งค่าเฉพาะ ADMIN) — ขาดหน้า Dashboard, Schedules,
  // Summary, Inventory, AttendanceManagement ที่ desktop sidebar มีครบ ทำให้กด staff เข้าหน้าพวกนี้จากมือถือไม่ได้เลย
  // เพิ่มปุ่ม "เมนู" เปิด bottom sheet รวมหน้าที่เหลือแทน ให้ครบตาม role เหมือน desktop
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  // ⭐️ รูปโปรไฟล์โชว์ใน sidebar — หน้า /profile เป็นคนอัปโหลด แล้วยิง event 'profilePhotoChanged'
  //   มาบอกให้อ่านค่าใหม่จาก localStorage (ไม่งั้นรูปในเมนูค้างเป็นรูปเก่าจนกว่าจะรีเฟรชหน้า)
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(user.profile_image_url || null);

  const sessionMode = localStorage.getItem('session_mode');
  // ⭐️ ADMIN ไม่ถูกกรองด้วยสถานะเข้างาน — งานหลังบ้าน (ตั้งค่า/รายงาน/จัดการพนักงาน) ไม่ใช่กะขายของ
  //   จะบังคับให้ลงชื่อเข้างานก่อนถึงจะเข้าเมนูผู้จัดการได้ไม่สมเหตุสมผล
  //   ส่วน CASHIER ยังกรองตามโหมด (ไม่ได้เปิดกะ = ใช้งานได้เท่าสมาชิก) ตามที่ตกลงไว้
  const isStaff = user.role === 'ADMIN' || (user.role === 'CASHIER' && sessionMode !== 'shop');
  const isAdmin = user.role === 'ADMIN';
  // ⭐️ POS เปิดให้เฉพาะ CASHIER — ADMIN ขายหน้าร้านไม่ได้ (เปิดกะไม่ได้ = เงินสดไม่มีกะรองรับ)
  const isCashier = user.role === 'CASHIER';
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

  // ⭐️ ฟอร์มแก้เบอร์/อัปโหลดรูป ย้ายไปหน้า /profile แล้ว — ที่นี่แค่ฟัง event เพื่ออัปเดตรูปใน sidebar
  useEffect(() => {
    const syncPhoto = () => setProfileImageUrl(getCurrentUser()?.profile_image_url || null);
    window.addEventListener('profilePhotoChanged', syncPhoto);
    return () => window.removeEventListener('profilePhotoChanged', syncPhoto);
  }, []);

  const handleLogoutClick = () => {
    Swal.fire({ title: 'ออกจากระบบ?', icon: 'question', showCancelButton: true, confirmButtonColor: BRAND, cancelButtonColor: '#9ca3af', confirmButtonText: 'ออกจากระบบ', cancelButtonText: 'ยกเลิก' })
      .then(async (r) => {
        if (r.isConfirmed) {
          // ⭐️ Sprint 2 — B5 / Security remediation: performLogout เรียก POST /auth/logout ให้ backend
          // เคลียร์ cookie + เพิกถอน token ก่อน แล้วค่อยล้าง user/session_mode/csrf ฝั่ง client
          await performLogout();
          navigate('/login');
        }
      });
  };

  const handleOpenNotifications = async () => {
    if (unreadCount > 0) {
      try { await api.put('/notifications/read-all'); setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 }))); }
      catch (e) { console.error(e); }
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 font-sans overflow-hidden">
      <Sidebar
        isStaff={isStaff}
        isAdmin={isAdmin}
        isCashier={isCashier}
        unreadCount={unreadCount}
        pendingOrders={pendingOrders}
        onOpenNotifications={handleOpenNotifications}
        fullName={user.full_name}
        role={user.role}
        profileImageUrl={profileImageUrl}
        onOpenProfile={() => navigate('/profile')}
        onLogoutClick={handleLogoutClick}
      />

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main className="flex-1 h-screen overflow-y-auto pb-28 md:pb-0">
        <Outlet />
      </main>

      <MobileBottomNav
        isStaff={isStaff}
        isCashier={isCashier}
        unreadCount={unreadCount}
        pendingOrders={pendingOrders}
        onOpenNotifications={handleOpenNotifications}
        onOpenMobileMenu={() => setShowMobileMenu(true)}
        onOpenProfile={() => navigate('/profile')}
      />

      {showMobileMenu && (
        <MobileMenuDrawer
          isStaff={isStaff}
          isAdmin={isAdmin}
          pendingOrders={pendingOrders}
          onClose={() => setShowMobileMenu(false)}
          onLogoutClick={handleLogoutClick}
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
