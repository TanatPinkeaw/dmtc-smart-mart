import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Shift from './pages/Shift';
import POS from './pages/POS';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Settings from './pages/Settings'; 
import Preorder from './pages/PreOrder'; 
import OrderManagement from './pages/OrderManagement'; // ⭐️ 1. นำเข้าหน้าตรวจสลิป/จัดการออเดอร์
import Schedules from './pages/Schedules'; // ⭐️ หน้าตั้งตารางเวลาทำงาน (ADMIN)
import AttendanceManagement from './pages/AttendanceManagement'; // ⭐️ หน้าจัดการเข้า-ออกงาน (ADMIN only)
import StaffCalendar from './pages/StaffCalendar'; // ⭐️ ปฏิทินวันหยุด+ตารางงาน (ทุก role)
import Layout from './components/Layout';
import Notifications from './pages/Notifications'; // 👈 นำเข้าหน้าใหม่
import VendorSales from './pages/VendorSales'; // ⭐️ หน้ายอดฝากขายของฉัน (สำหรับ MEMBER ที่ฝากขายสินค้า)

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* หน้าแรกของระบบยังคงวิ่งไปที่ Shift เหมือนเดิม */}
        <Route path="/" element={<Navigate to="/shift" replace />} />
        <Route path="/shift" element={<Shift />} />
        
        {/* โซนที่ต้องมี Sidebar ครอบอยู่ */}
        <Route element={<Layout />}>
          <Route path="/pos" element={<POS />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/inventory" element={<Inventory />} />
          
          <Route path="/pre-order" element={<Preorder />} />
          <Route path="/orders" element={<OrderManagement />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/attendance-management" element={<AttendanceManagement />} />
          <Route path="/calendar" element={<StaffCalendar />} />
          {/* /schedules route ซ่อนไว้ — ยังเข้าได้ด้วย URL ตรง แต่ไม่มีลิงก์ใน nav */}
          <Route path="/notifications" element={<Notifications />} /> {/* 👈 เพิ่มบรรทัดนี้ */}
          <Route path="/my-sales" element={<VendorSales />} /> {/* ⭐️ ยอดฝากขายของฉัน */}
          <Route path="/settings" element={<Settings />} />
        </Route>

      </Routes>
    </BrowserRouter>
  );
}

export default App;