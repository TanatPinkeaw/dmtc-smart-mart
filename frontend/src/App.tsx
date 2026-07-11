import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Shift from './pages/Shift';
import POS from './pages/POS';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Settings from './pages/Settings'; // <-- 1. นำเข้าหน้า Settings
import Layout from './components/Layout';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Navigate to="/shift" replace />} />
        <Route path="/shift" element={<Shift />} />
        
        {/* โซนที่ต้องมี Sidebar ครอบอยู่ */}
        <Route element={<Layout />}>
          <Route path="/pos" element={<POS />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/inventory" element={<Inventory />} />
          
          {/* 2. เพิ่ม Route หน้า Settings ตรงนี้ */}
          <Route path="/settings" element={<Settings />} />
        </Route>

      </Routes>
    </BrowserRouter>
  );
}

export default App;