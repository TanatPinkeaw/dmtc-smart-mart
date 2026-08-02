import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getCurrentUser } from './utils/getCurrentUser'; // ⭐️ Sprint 0 — B2
import api from './api';
import Swal from './swal';
import Login from './pages/Login';
import Home from './pages/Home'; // ⭐️ หน้ากลางหลัง login (ทุก role) — เลือกโมดูลที่จะเข้าใช้งาน
import Profile from './pages/Profile'; // ⭐️ บัญชีของฉัน (เดิมเป็น ProfileModal)
import ForgotPassword from './pages/ForgotPassword'; // ⭐️ F1 — ลืมรหัสผ่าน
import ResetPassword from './pages/ResetPassword'; // ⭐️ F1 — ตั้งรหัสผ่านใหม่
import Register from './pages/Register'; // ⭐️ LINE LIFF — หน้าสมัคร/ผูกบัญชีสมาชิกผ่าน LIFF
import Shift from './pages/Shift';
import POS from './pages/POS';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Settings from './pages/Settings'; 
import Preorder from './pages/PreOrder'; 
import OrderManagement from './pages/OrderManagement'; // ⭐️ 1. นำเข้าหน้าตรวจสลิป/จัดการออเดอร์
import Schedules from './pages/Schedules'; // ⭐️ หน้าตั้งตารางเวลาทำงาน (ADMIN)
import AttendanceManagement from './pages/AttendanceManagement';
import Layout from './components/Layout';
import Notifications from './pages/Notifications'; // 👈 นำเข้าหน้าใหม่
import VendorSales from './pages/VendorSales'; // ⭐️ หน้ายอดฝากขายของฉัน (สำหรับ MEMBER ที่ฝากขายสินค้า)
import Summary from './pages/Summary'; // ⭐️ หน้าสรุปข้อมูล (ชั่วโมงทำงาน/มาสาย/ค่าจ้าง) — ADMIN เท่านั้น
import AccountingSummary from './pages/AccountingSummary'; // ⭐️ สรุปบัญชีสหกรณ์ — หมวดหมู่/ยอดจ่ายคืนผู้ฝากขาย/Export Excel
import BackupManagement from './pages/BackupManagement'; // ⭐️ หน้าสำรอง & กู้คืนข้อมูล — ADMIN เท่านั้น

// 🐛 FIX (MEMBER login bug) — ไม่เคยมี route guard เลยตั้งแต่แรก: MEMBER ที่พิมพ์ URL /pos ตรงๆ
// (หรือกด back/forward จากแท็บเก่า) โหลดหน้า POS ได้เต็มๆ แม้ Layout.tsx จะซ่อนลิงก์ไปหน้านี้ไว้แล้ว
// (ซ่อนแค่ลิงก์ ไม่ได้กันเส้นทาง) พอ POS.tsx ยิง GET /api/users/search ซึ่งเป็น endpoint เฉพาะ
// CASHIER/ADMIN โดยตั้งใจ (ถูกต้องแล้ว — ไม่ควรเปิดให้ MEMBER ค้นหาข้อมูลสมาชิกคนอื่นได้ เพราะคืน
// เบอร์โทร/แต้มของคนอื่น) ก็โดน 403 แล้ว interceptor เดิมใน api.ts (แก้แล้วในไฟล์นั้น) force logout
// ทั้ง session ทำให้ดูเหมือนแอป "crash" — ตัวกันนี้คือชั้นป้องกันที่สอง (defense in depth):
// กัน MEMBER ไม่ให้โหลดหน้า staff-only ได้ตั้งแต่แรก แทนที่จะปล่อยให้โหลดแล้วค่อยพังตอนยิง API
function RequireStaff({ children }: { children: ReactNode }) {
  // ⭐️ Sprint 0 — B2: เปลี่ยนจาก JSON.parse ตรงๆ เป็น getCurrentUser() (มี try/catch, กัน localStorage
  // เสียแล้วพังทั้งแอป) — MANAGER นับเป็น staff ด้วย
  const user = getCurrentUser();
  if (!user || (user.role !== 'ADMIN' && user.role !== 'MANAGER' && user.role !== 'CASHIER')) {
    return <Navigate to="/pre-order" replace />;
  }
  return <>{children}</>;
}

// ⭐️ Require ADMIN or MANAGER (หน้าจัดการร้าน: ตั้งค่า/รายงาน/สินค้า/กลุ่มสมาชิก) — กันไม่ให้ CASHIER
//   เข้าถึงด้วยการพิมพ์ URL (เดิม /settings, /attendance-management ใช้แค่ RequireStaff = CASHIER หลุดเข้าได้)
function RequireManager({ children }: { children: ReactNode }) {
  const user = getCurrentUser();
  if (!user || (user.role !== 'ADMIN' && user.role !== 'MANAGER')) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

// ⭐️ Require MEMBER only (PreOrder/Shopping)
function RequireMember({ children }: { children: ReactNode }) {
  const user = getCurrentUser();
  if (!user || user.role !== 'MEMBER') {
    return <Navigate to="/shift" replace />;
  }
  return <>{children}</>;
}

// ⭐️ Require CASHIER only (หน้า POS) — ADMIN ขายหน้าร้านไม่ได้ตามนโยบาย เพราะเปิดกะไม่ได้
//   บิลจึงผูก shift_id ไม่ได้ = เงินสดไม่มีกะรองรับ ตอนปิดกะยอดจะไม่ตรง (backend บล็อกไว้อีกชั้นที่
//   POST /api/sales/checkout ซึ่งเปิดให้เฉพาะ CASHIER) ตัวนี้กันไม่ให้เปิดหน้า POS ตั้งแต่แรก
function RequireCashier({ children }: { children: ReactNode }) {
  const user = getCurrentUser();
  if (!user || user.role !== 'CASHIER') {
    return <Navigate to="/home" replace />;
  }
  return <>{children}</>;
}

// ⭐️ Require ADMIN only (หน้าสรุปข้อมูล/payroll — ข้อมูลค่าจ้างพนักงาน ห้าม CASHIER เห็น)
function RequireAdmin({ children }: { children: ReactNode }) {
  const user = getCurrentUser();
  if (!user || user.role !== 'ADMIN') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

// ⭐️ Sprint 0 — A1 (แก้ต่อ): หน้าแรก ("/") เดิม hardcode ไป /shift หรือ /pre-order ตาม role — ตอนนี้
// ทุก role (รวม MEMBER) ผ่านหน้า Home กลางก่อนเสมอ ให้เลือกเองว่าจะเข้าโมดูลไหน ไม่ login เลยไป /login
// ⭐️ Update — ADMIN เป็นข้อยกเว้น: ไม่ต้องผ่านหน้า Home กลาง เด้งตรงไปหน้าสั่งจอง/ซื้อสินค้าเลย
function DefaultRoute() {
  const user = getCurrentUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'ADMIN') return <Navigate to="/pre-order" replace />;
  return <Navigate to="/home" replace />;
}

// ⭐️ Sprint 0 — A4: ตรวจ backend restart ระหว่างที่ user เปิดแอปค้างไว้
// หมายเหตุ (deviation จาก spec เดิม): spec ต้นฉบับเทียบ backend boot time กับเวลา login ที่เก็บใน
// localStorage ('backend_restart_time') — ลอจิกนั้นจะ false-positive เกือบตลอดเวลาในสถานการณ์จริง
// เพราะ backend มักจะ boot ขึ้นมา "ก่อน" ที่ user จะ login เสมออยู่แล้ว (server รันรอไว้ก่อน)
// ทำให้ backendTime < lastRestartTime เกือบทุกครั้งและเด้งเตือนผิดตลอด แก้เป็น pattern ที่ถูกต้อง:
// จำค่า timestamp ที่ backend ตอบกลับมาตอนโหลดแอปครั้งแรก แล้ว poll เทียบว่าเปลี่ยนไปไหมในภายหลัง —
// ถ้าเปลี่ยน แปลว่า backend restart ไปแล้วจริงๆ ระหว่างที่ผู้ใช้เปิดหน้าเว็บค้างไว้
let lastSeenBackendTimestamp: string | null = null;
let staleWarningShown = false;

function useStaleBackendWarning() {
  useEffect(() => {
    const checkVersion = async () => {
      try {
        const res = await api.get('/version');
        const currentTimestamp = res.data?.timestamp;
        if (!currentTimestamp) return;

        if (lastSeenBackendTimestamp === null) {
          lastSeenBackendTimestamp = currentTimestamp; // baseline ครั้งแรกที่โหลดแอป
          return;
        }

        if (currentTimestamp !== lastSeenBackendTimestamp && !staleWarningShown) {
          staleWarningShown = true;
          Swal.fire({
            icon: 'warning',
            title: 'เซิร์ฟเวอร์อัปเดตแล้ว',
            text: 'ระบบหลังบ้านเพิ่งรีสตาร์ท กรุณารีเฟรชหน้านี้เพื่อใช้งานเวอร์ชันล่าสุด',
            confirmButtonText: 'รีเฟรชตอนนี้',
            allowOutsideClick: false,
          }).then(() => window.location.reload());
        }
      } catch (err) {
        console.error('Version check failed:', err);
      }
    };

    checkVersion();
    const interval = setInterval(checkVersion, 60000); // ⭐️ ทุก 1 นาที ตามสเปก
    return () => clearInterval(interval);
  }, []);
}

function App() {
  useStaleBackendWarning();
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} /> {/* ⭐️ F1 */}
        <Route path="/reset-password" element={<ResetPassword />} /> {/* ⭐️ F1 */}
        <Route path="/register" element={<Register />} /> {/* ⭐️ LINE LIFF endpoint URL — สมัคร/ผูกบัญชี ไม่มี auth guard เพราะเปิดก่อน login เข้าแอปนี้เสมอ */}

        {/* ⭐️ Sprint 0 — A1: หน้าแรกแยกตาม role แล้ว (ดู DefaultRoute ด้านบน) */}
        <Route path="/" element={<DefaultRoute />} />
        {/* ⭐️ หน้ากลางหลัง login — ทุก role (ADMIN/CASHIER/MEMBER) เข้าที่นี่ก่อนเสมอ ไม่มี Sidebar
            ครอบ (เหมือน /shift) เพราะเป็นจุดเลือกโมดูล ไม่ใช่หน้าใช้งานจริง */}
        <Route path="/home" element={<Home />} />
        {/* ⭐️ Sprint 0 — A1: /shift เดิมไม่มี guard เลย MEMBER พิมพ์ URL ตรงเข้าได้ ห่อ RequireStaff แล้ว */}
        <Route path="/shift" element={<RequireStaff><Shift /></RequireStaff>} />
        
        {/* โซนที่ต้องมี Sidebar ครอบอยู่ */}
        <Route element={<Layout />}>
          {/* 🐛 FIX — หน้าเหล่านี้เป็นของ CASHIER/ADMIN เท่านั้น ห่อด้วย RequireStaff กันเข้าตรงด้วย URL */}
          <Route path="/pos" element={<RequireCashier><POS /></RequireCashier>} />
          <Route path="/dashboard" element={<RequireStaff><Dashboard /></RequireStaff>} />
          <Route path="/inventory" element={<RequireStaff><Inventory /></RequireStaff>} />
          <Route path="/orders" element={<RequireStaff><OrderManagement /></RequireStaff>} />
          <Route path="/schedules" element={<RequireStaff><Schedules /></RequireStaff>} />
          {/* ⭐️ ปิดช่องโหว่: /settings + /attendance-management เดิมเป็น RequireStaff (CASHIER พิมพ์ URL เข้าได้)
              เปลี่ยนเป็น RequireManager = ADMIN/MANAGER เท่านั้น */}
          <Route path="/attendance-management" element={<RequireManager><AttendanceManagement /></RequireManager>} />
          <Route path="/settings" element={<RequireManager><Settings /></RequireManager>} />
          {/* ⭐️ /summary เปิดให้ MANAGER ด้วย แต่ตารางเงินเดือน (payroll) ยังซ่อนเฉพาะ ADMIN ในหน้า Summary เอง */}
          <Route path="/summary" element={<RequireManager><Summary /></RequireManager>} />
          <Route path="/accounting-summary" element={<RequireManager><AccountingSummary /></RequireManager>} />
          {/* ⭐️ /backup ยังคง ADMIN-only (งานระบบ) */}
          <Route path="/backup" element={<RequireAdmin><BackupManagement /></RequireAdmin>} />

          <Route path="/pre-order" element={<Preorder />} />
          <Route path="/notifications" element={<Notifications />} /> {/* 👈 เพิ่มบรรทัดนี้ */}
          <Route path="/my-sales" element={<VendorSales />} /> {/* ⭐️ ยอดฝากขายของฉัน */}
          <Route path="/profile" element={<Profile />} /> {/* ⭐️ เดิมเป็น modal — ย้ายมาเป็นหน้าเต็ม */}
        </Route>

      </Routes>
    </BrowserRouter>
  );
}

export default App;