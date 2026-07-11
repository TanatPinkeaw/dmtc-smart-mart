import { useState } from 'react'; // ⭐️ นำเข้า useState
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Store, LayoutDashboard, Boxes, Settings, LogOut, Lock, X, CheckCircle } from 'lucide-react'; // ⭐️ นำเข้าไอคอนเพิ่ม
import Swal from 'sweetalert2';
import api from '../api';

export default function Layout() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const navigate = useNavigate();

  // ⭐️ States สำหรับหน้าต่างปิดกะสุดพรีเมียม
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [actualCash, setActualCash] = useState<number | ''>('');
  const [closeLoading, setCloseLoading] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<any>(null);

  // เมื่อกดปุ่ม "ออก" ที่เมนู
  const handleLogoutClick = () => {
    if (user.role === 'CASHIER') {
      // ถ้าเป็นแคชเชียร์ ให้เปิดหน้าต่างปิดกะแบบสวยๆ
      setShowCloseModal(true);
    } else {
      // ถ้าเป็น ADMIN ใช้ Swal ถามสั้นๆ เหมือนเดิม
      Swal.fire({
        title: 'ออกจากระบบ?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#9ca3af',
        confirmButtonText: 'ออกจากระบบ',
        cancelButtonText: 'ยกเลิก'
      }).then((result) => {
        if (result.isConfirmed) {
          localStorage.clear();
          navigate('/login');
        }
      });
    }
  };

  // ฟังก์ชันยิง API ปิดกะ (แบบเดียวกับหน้า POS)
  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (actualCash === '') return Swal.fire({ icon: 'warning', title: 'กรุณาระบุยอดเงิน' });

    setCloseLoading(true);
    try {
      const response = await api.post('/shifts/close', {
        cashier_id: user.id,
        actual_cash: Number(actualCash)
      });
      // ได้รับสรุปยอดกลับมา ให้เปลี่ยนสเตปใน Modal
      setShiftSummary(response.data.summary);
    } catch (error: any) {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: error.response?.data?.error });
    } finally {
      setCloseLoading(false);
    }
  };

  // ฟังก์ชันเคลียร์ค่าและกลับไปหน้า Login
  const finishAndLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  const desktopLinkStyle = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center p-3 rounded-xl transition w-full ${isActive ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`;

  const mobileLinkStyle = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center justify-center w-full h-full space-y-1 transition ${isActive ? 'text-blue-500' : 'text-gray-400 hover:text-gray-200'}`;

  return (
    <div className="flex h-screen bg-gray-100 font-sans overflow-hidden relative">
      
      {/* ================= Sidebar (สำหรับจอคอมและแท็บเล็ต) ================= */}
      <aside className="hidden md:flex w-24 bg-gray-900 flex-col items-center py-6 shadow-2xl z-50">
        
        <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white mb-8 shadow-lg">
          <Store size={28} />
        </div>
        
        <nav className="flex-1 flex flex-col gap-4 w-full px-3">
          <NavLink to="/pos" className={desktopLinkStyle}>
            <Store size={24} className="mb-1" />
            <span className="text-xs font-bold">POS</span>
          </NavLink>
          
          <NavLink to="/dashboard" className={desktopLinkStyle}>
            <LayoutDashboard size={24} className="mb-1" />
            <span className="text-xs font-bold text-center">สรุปยอด</span>
          </NavLink>

          {user.role === 'ADMIN' && (
            <NavLink to="/inventory" className={desktopLinkStyle}>
              <Boxes size={24} className="mb-1" />
              <span className="text-xs font-bold">คลัง</span>
            </NavLink>
          )}

          {user.role === 'ADMIN' && (
            <NavLink to="/settings" className={desktopLinkStyle}>
              <Settings size={24} className="mb-1" />
              <span className="text-xs font-bold">ตั้งค่า</span>
            </NavLink>
          )}
        </nav>
        
        <div className="mt-auto flex flex-col items-center w-full px-2">
          <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center text-white font-bold mb-1 shadow-inner">
            {user.full_name ? user.full_name.charAt(0).toUpperCase() : 'U'}
          </div>
          <span className="text-[10px] text-gray-400 font-bold mb-4 truncate w-full text-center">{user.full_name}</span>
          
          <button onClick={handleLogoutClick} className="text-gray-500 hover:text-red-400 p-2 rounded-xl hover:bg-gray-800 transition w-full flex justify-center" title="ออกจากระบบ">
            <LogOut size={20} />
          </button>
        </div>
      </aside>

      {/* ================= พื้นที่แสดงผล (Main Content) ================= */}
      <main className="flex-1 h-screen overflow-y-auto pb-16 md:pb-0">
        <Outlet />
      </main>

      {/* ================= Bottom Navigation (สำหรับจอมือถือ) ================= */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-gray-900 border-t border-gray-800 flex justify-around items-center h-16 z-[60] shadow-[0_-4px_10px_rgba(0,0,0,0.2)]">
        
        <NavLink to="/pos" className={mobileLinkStyle}>
          <Store size={20} />
          <span className="text-[10px] font-bold">POS</span>
        </NavLink>
        
        <NavLink to="/dashboard" className={mobileLinkStyle}>
          <LayoutDashboard size={20} />
          <span className="text-[10px] font-bold">สรุปยอด</span>
        </NavLink>

        {user.role === 'ADMIN' && (
          <NavLink to="/inventory" className={mobileLinkStyle}>
            <Boxes size={20} />
            <span className="text-[10px] font-bold">คลัง</span>
          </NavLink>
        )}

        {user.role === 'ADMIN' && (
          <NavLink to="/settings" className={mobileLinkStyle}>
            <Settings size={20} />
            <span className="text-[10px] font-bold">ตั้งค่า</span>
          </NavLink>
        )}

        {/* ⭐️ ปุ่มกดออก นำไปสู่ Modal สวยๆ */}
        <button onClick={handleLogoutClick} className="flex flex-col items-center justify-center w-full h-full space-y-1 text-gray-400 hover:text-red-400 transition">
          <LogOut size={20} />
          <span className="text-[10px] font-bold">ออก</span>
        </button>

      </nav>

      {/* ================= MODAL ปิดกะ (ดีไซน์พรีเมียมแบบหน้า POS) ================= */}
      {showCloseModal && (
        // z-[90] เพื่อทับเมนูด้านล่างสุดๆ
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90] flex items-end md:items-center justify-center sm:p-4 animate-fade-in">
          <div className="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all">
            
            {!shiftSummary ? (
              // สเตป 1: กรอกเงินที่นับได้
              <div className="p-6 pb-12 md:p-8">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2"><Lock className="text-red-500" /> ปิดกะการขาย</h2>
                  <button onClick={() => setShowCloseModal(false)} className="text-gray-400 hover:text-gray-600 p-1.5 bg-gray-100 rounded-lg transition"><X size={20} /></button>
                </div>
                <p className="text-gray-600 text-sm md:text-base mb-6">กรุณานับเงินสดทั้งหมดในลิ้นชักและกรอกยอดที่นับได้จริง</p>
                <form onSubmit={handleCloseShift}>
                  <div className="mb-6">
                    <label className="block text-sm font-bold text-gray-700 mb-2">เงินสดที่นับได้จริง (บาท)</label>
                    <input 
                      type="number" required min="0" value={actualCash}
                      onChange={(e) => setActualCash(e.target.value ? Number(e.target.value) : '')}
                      className="w-full text-center text-3xl font-bold p-4 border border-gray-300 rounded-xl focus:ring-4 focus:ring-red-100 focus:border-red-500 focus:outline-none transition"
                      placeholder="0.00"
                    />
                  </div>
                  <button type="submit" disabled={closeLoading} className="w-full bg-red-500 text-white py-4 rounded-xl font-bold text-lg hover:bg-red-600 transition active:scale-95 disabled:bg-gray-300">
                    {closeLoading ? 'กำลังตรวจสอบ...' : 'ยืนยันการปิดกะ'}
                  </button>
                </form>
              </div>
            ) : (
              // สเตป 2: แสดงสรุปยอดหลังปิดกะเสร็จ
              <div className="p-6 pb-12 md:p-8 text-center">
                <div className="w-16 h-16 md:w-20 md:h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 md:mb-6">
                  <CheckCircle className="text-green-500 w-8 h-8 md:w-10 md:h-10" />
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-gray-800 mb-2">สรุปยอดการขาย</h2>
                <p className="text-gray-500 text-sm mb-6">ปิดกะสำเร็จ บันทึกข้อมูลเรียบร้อยแล้ว</p>
                
                <div className="bg-gray-50 rounded-xl p-4 space-y-2 md:space-y-3 text-left mb-6 md:mb-8 border border-gray-100 text-sm md:text-base">
                  <div className="flex justify-between"><span className="text-gray-600">เงินทอนตั้งต้น:</span><span className="font-semibold">฿{Number(shiftSummary.opening_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">ยอดขายเงินสด:</span><span className="font-semibold">฿{Number(shiftSummary.cash_sales).toFixed(2)}</span></div>
                  <div className="flex justify-between border-t pt-2 md:pt-3"><span className="text-gray-800 font-bold">เงินที่ควรมี:</span><span className="font-bold text-blue-600">฿{Number(shiftSummary.expected_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-800 font-bold">นับได้จริง:</span><span className="font-bold">฿{Number(shiftSummary.actual_cash).toFixed(2)}</span></div>
                  <div className="flex justify-between pt-2 border-t">
                    <span className="text-gray-600 font-bold">ส่วนต่าง:</span>
                    <span className={`font-bold ${Number(shiftSummary.difference) < 0 ? 'text-red-500' : Number(shiftSummary.difference) > 0 ? 'text-green-500' : 'text-gray-500'}`}>
                      {Number(shiftSummary.difference) > 0 ? '+' : ''}{Number(shiftSummary.difference).toFixed(2)}
                    </span>
                  </div>
                </div>

                <button onClick={finishAndLogout} className="w-full bg-gray-800 text-white py-4 rounded-xl font-bold text-lg hover:bg-gray-900 transition active:scale-95">
                  ออกจากระบบ
                </button>
              </div>
            )}
            
          </div>
        </div>
      )}

    </div>
  );
}