// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 components/Layout.tsx — โครงหน้าเว็บของทุกหน้าที่ล็อกอินแล้ว (sidebar + bottom nav + แถวเตือน)
// ─────────────────────────────────────────────────────────────────────────────────────
// ทำอะไร: ห่อเนื้อหาแต่ละหน้า (<Outlet/>) ด้วย Sidebar (desktop) / MobileBottomNav+Drawer (mobile) ตาม role,
//   จัดการ badge แจ้งเตือน (socket realtime), แถบเตือนสลิปไม่ผ่านด้านบน, และบังคับเปลี่ยนรหัส (ChangePasswordModal)
// จุดสำคัญ: หน้าที่ต้อง login ทั้งหมดถูก render ข้างใน Layout นี้ (ดู App.tsx) — nav อยู่ที่นี่ที่เดียว
// ═══════════════════════════════════════════════════════════════════════════════════
// ✅ CHANGED: sidebar design, bottom nav, profile modal → DMTC Mart theme
// 🔒 UNCHANGED: fetchNotificationsAndBadge, socket listeners, handleUpdateProfile, handleLogoutClick, handleOpenNotifications, isStaff logic, all navigation routes

import { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Swal from '../swal';
import { BRAND } from '../theme';
import api from '../api';
import { performLogout } from '../utils/logout';
import { SocketProvider } from '../SocketContext';
import { useSocket } from '../hooks/useSocket';
import { getCurrentUser, getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { ChangePasswordModal } from './auth/ChangePasswordModal';
import { Sidebar } from './layout/Sidebar';
import { MobileBottomNav } from './layout/MobileBottomNav';
import { MobileMenuDrawer } from './layout/MobileMenuDrawer';
import { UploadSlipModal } from './preorder/UploadSlipModal';

// ─── LayoutInner ─────────────────────────────────────────────────────────────
function LayoutInner() {
  const socket = useSocket();
  const user = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2
  const navigate = useNavigate();

  // รูปร่างขั้นต่ำของข้อมูลจาก API (field ที่ Layout อ่านจริง) — field อื่นเป็น unknown
  interface NotificationAlert { id: number; is_read?: boolean; [key: string]: unknown; }
  interface OrderAlert { id: number; status?: string; reject_reason?: string | null; [key: string]: unknown; }
  const [notifications, setNotifications] = useState<NotificationAlert[]>([]);
  const [pendingOrders, setPendingOrders] = useState(0);
  // ⭐️ ออเดอร์ที่สลิปไม่ผ่าน (ฝั่งลูกค้า) — ใช้โชว์แถบเตือนด้านบน + เปิดโมดัลส่งสลิปใหม่
  const [rejectedOrders, setRejectedOrders] = useState<OrderAlert[]>([]);
  const [slipOrder, setSlipOrder] = useState<OrderAlert | null>(null);
  // ⭐️ Security remediation — บังคับเปลี่ยนรหัสผ่านชั่วคราวก่อนใช้งานหน้าอื่น (ปิด modal เองไม่ได้ ดู ChangePasswordModal forceChange)
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(!!user.must_change_password);
  // ⭐️ FIX: bottom nav มือถือเดิมมีแค่ POS/ออเดอร์/(ตั้งค่าเฉพาะ ADMIN) — ขาดหน้า Dashboard, Schedules,
  // Summary, Inventory, AttendanceManagement ที่ desktop sidebar มีครบ ทำให้กด staff เข้าหน้าพวกนี้จากมือถือไม่ได้เลย
  // เพิ่มปุ่ม "เมนู" เปิด bottom sheet รวมหน้าที่เหลือแทน ให้ครบตาม role เหมือน desktop
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  // ⭐️ รูปโปรไฟล์โชว์ใน sidebar — หน้า /profile เป็นคนอัปโหลด แล้วยิง event 'profilePhotoChanged'
  //   มาบอกให้อ่านค่าใหม่จาก localStorage (ไม่งั้นรูปในเมนูค้างเป็นรูปเก่าจนกว่าจะรีเฟรชหน้า)
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(user.profile_image_url || null);

  // ⭐️ staff = ADMIN/MANAGER/CASHIER (ตาม role ล้วนๆ) — เดิม CASHIER ถูกกรองด้วย session_mode='shop'
  //   (โหมดซื้อของ) ให้กลายเป็นสมาชิกชั่วคราว แต่ตอนนี้ถอด "โหมดซื้อของ" ของ staff ออกทั้งหมดแล้ว
  //   (staff จัดการการซื้อ/จองผ่านเว็บไม่ได้ — หน้า /pre-order เป็นของ MEMBER เท่านั้น) CASHIER จึงเป็น
  //   staff เสมอ ส่วนการบังคับเปิดกะก่อนขายจริงยังคุมที่ backend (/sales/checkout) + การ์ดในหน้า Home
  const isStaff = user.role === 'ADMIN' || user.role === 'MANAGER' || user.role === 'CASHIER';
  const isAdmin = user.role === 'ADMIN';
  // ⭐️ เมนูจัดการร้าน (ตั้งค่า/รายงาน/สินค้า/กลุ่มสมาชิก) เปิดให้ทั้ง ADMIN และ MANAGER
  const isStoreAdmin = user.role === 'ADMIN' || user.role === 'MANAGER';
  // ⭐️ POS เปิดให้เฉพาะ CASHIER — ADMIN/MANAGER ขายหน้าร้านไม่ได้ (เปิดกะไม่ได้ = เงินสดไม่มีกะรองรับ)
  const isCashier = user.role === 'CASHIER';
  const unreadCount = notifications.filter(n => !n.is_read).length;
  // ⭐️ ทุกหน้าใช้ MobileBottomNav ตัวเดียวกัน (รวม member บน /pre-order) — กัน UI แถบล่างเพี้ยน
  //    ต่างกันไปทีละหน้า; สมาชิกที่ต้องการ "บัตรสมาชิก" ไปได้ทาง เมนู → บัตรสมาชิก (navConfig)
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

  // ⭐️ ออเดอร์ที่สลิปไม่ผ่าน — ต้องเด้งให้เห็นทุกหน้า ไม่ใช่ซ่อนอยู่ในโมดัลประวัติออเดอร์
  // staff ก็สั่งจองของตัวเองได้แล้ว (staff-shopping) → ต้องโชว์แถบเตือนด้วย แต่ขอ ?mine=1
  // เพื่อเห็นเฉพาะออเดอร์ตัวเอง (default ของ staff คือ "ดูทั้งหมด" = หน้า OrderManagement —
  // ดึง unscoped มาจะรั่วออเดอร์ลูกค้าคนอื่นลงแถบเตือน)
  const fetchRejectedOrders = async () => {
    try {
      const res = await api.get(`/orders?${isStaff ? 'mine=1&' : ''}t=${Date.now()}`);
      setRejectedOrders((res.data || []).filter((o: OrderAlert) => o.status === 'SLIP_REJECTED'));
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (!user.id || !socket) return;
    // fetch ทั้งคู่ setState หลัง await (ไม่ใช่ sync setState — ไม่มี cascading render) และต้องอยู่
    // component scope เพราะ socket handlers ข้างล่างก็เรียกใช้ (ฟังก์ชันใหม่ทุก render → ใส่ deps =
    // subscribe/off ทุก render — เดิม [user.id, socket] จึงถูกต้อง)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchNotificationsAndBadge();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRejectedOrders();
    // ⭐️ สถานะออเดอร์เปลี่ยน (รวมตอนโดน reject สลิป / ตอนส่งสลิปใหม่แล้วกลับเป็น PENDING_VERIFY)
    // ให้แถบเตือนด้านบนอัปเดตตามทันที ไม่ต้องรีเฟรชหน้า
    socket.on(`order_update_user_${user.id}`, fetchRejectedOrders);
    socket.on(`notification_user_${user.id}`, (data) => {
      fetchNotificationsAndBadge();
      fetchRejectedOrders();
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
      socket.off(`order_update_user_${user.id}`, fetchRejectedOrders);
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

  // 🐛 FIX — เดิมมี handleOpenNotifications ที่ยิง PUT /notifications/read-all ทันทีที่ "กดกระดิ่ง"
  // = แค่เปิดเข้าไปดูก็ถูกมาร์คว่าอ่านหมดทั้งกล่อง ทั้งที่ผู้ใช้ยังไม่ได้อ่านอะไรเลย badge หายทันที
  // ตอนนี้การมาร์คว่าอ่านเกิดขึ้นเฉพาะตอนผู้ใช้คลิกรายการนั้นๆ หรือกดปุ่ม "อ่านทั้งหมด"
  // ในหน้า Notifications เท่านั้น (ดู pages/Notifications.tsx)

  return (
    <div className="flex h-screen bg-gray-50 font-sans overflow-hidden">
      <Sidebar
        isStaff={isStaff}
        isAdmin={isAdmin}
        isStoreAdmin={isStoreAdmin}
        isCashier={isCashier}
        unreadCount={unreadCount}
        pendingOrders={pendingOrders}
        fullName={user.full_name}
        role={user.role}
        profileImageUrl={profileImageUrl}
        onOpenProfile={() => navigate('/profile')}
        onLogoutClick={handleLogoutClick}
      />

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main className="flex-1 h-screen overflow-y-auto pb-28 md:pb-0">
        {/* ⭐️ แถบเตือนสลิปไม่ผ่าน — ค้างอยู่ทุกหน้าจนกว่าจะส่งสลิปใหม่สำเร็จ
            ไม่ใช่ modal ที่บังหน้าจอ ผู้ใช้ยังกดใช้งานส่วนอื่นได้ตามปกติ */}
        {rejectedOrders.map(order => (
          <div key={order.id} className="bg-red-50 border-b border-red-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-red-700">
              ⚠️ ออเดอร์ #{order.id} สลิปไม่ผ่าน
              {order.reject_reason && <span className="font-normal text-red-600"> — {order.reject_reason}</span>}
            </p>
            <button
              onClick={() => setSlipOrder(order)}
              className="shrink-0 px-4 py-1.5 rounded-full bg-gradient-to-br from-red-500 to-red-600 text-white text-xs font-bold transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1"
            >
              ส่งสลิปใหม่
            </button>
          </div>
        ))}
        <Outlet />
      </main>

      <MobileBottomNav
        isStaff={isStaff}
        isCashier={isCashier}
        unreadCount={unreadCount}
        pendingOrders={pendingOrders}
        onOpenMobileMenu={() => setShowMobileMenu(true)}
        onOpenProfile={() => navigate('/profile')}
      />

      {showMobileMenu && (
        <MobileMenuDrawer
          isStaff={isStaff}
          isAdmin={isAdmin}
          isStoreAdmin={isStoreAdmin}
          pendingOrders={pendingOrders}
          onClose={() => setShowMobileMenu(false)}
          onLogoutClick={handleLogoutClick}
        />
      )}

      {slipOrder && (
        <UploadSlipModal
          orderId={slipOrder.id}
          rejectReason={slipOrder.reject_reason}
          onClose={() => setSlipOrder(null)}
          onUploaded={fetchRejectedOrders}
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
