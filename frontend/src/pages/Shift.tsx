// ✅ CHANGED: colors, layout → DMTC Mart theme
// 🔒 UNCHANGED: handleAdminCheckIn, handleOpenShift, checkAttendance, checkCurrentShift, all state/logic

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, LogOut, Camera, Banknote } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';

const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 1];

export default function Shift() {
  const [denomCounts, setDenomCounts] = useState<Record<number, number | ''>>({});
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const user = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2
  const isAdmin = user.role === 'ADMIN';

  const [pageLoading, setPageLoading] = useState(true);
  const [needsCheckIn, setNeedsCheckIn] = useState(false);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkInPhoto, setCheckInPhoto] = useState<File | null>(null);
  const [checkInPhotoPreview, setCheckInPhotoPreview] = useState<string | null>(null);
  const [lastClosedCash, setLastClosedCash] = useState<number | null>(null);

  const openingCash = DENOMINATIONS.reduce((sum, d) => sum + d * (Number(denomCounts[d]) || 0), 0);

  useEffect(() => {
    if (isAdmin) {
      const checkAttendance = async () => {
        try { const res = await api.get('/attendance/today'); if (res.data) { navigate('/dashboard'); return; } setNeedsCheckIn(true); }
        catch { setNeedsCheckIn(true); } finally { setPageLoading(false); }
      };
      checkAttendance(); return;
    }
    const checkCurrentShift = async () => {
      try { const res = await api.get(`/shifts/current?cashier_id=${user.id}`); if (res.data?.id) { navigate('/pos'); return; } } catch {}
      try {
        const lastRes = await api.get(`/shifts/last-closed?cashier_id=${user.id}`);
        if (lastRes.data) { setLastClosedCash(Number(lastRes.data.actual_cash)); if (lastRes.data.closing_cash_breakdown) setDenomCounts(lastRes.data.closing_cash_breakdown); }
      } catch {}
      setPageLoading(false);
    };
    checkCurrentShift();
  }, [user.id, user.role, navigate]);

  const handleAdminCheckIn = async () => {
    if (!checkInPhoto) return Swal.fire({ icon: 'warning', title: 'กรุณาถ่ายรูปยืนยันสถานที่ก่อน' });
    setCheckInLoading(true);
    try {
      const fd = new FormData(); fd.append('photo', checkInPhoto);
      const uploadRes = await api.post('/attendance/upload-photo?type=clock-in', fd);
      await api.post('/attendance/check-in', { check_in_photo: uploadRes.data.photo_url });
      navigate('/dashboard');
    } catch (err: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
    finally { setCheckInLoading(false); }
  };

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (openingCash <= 0) return Swal.fire({ icon: 'warning', title: 'กรุณานับเงินทอนตั้งต้นก่อน' });
    if (!checkInPhoto) return Swal.fire({ icon: 'warning', title: 'กรุณาถ่ายรูปยืนยันสถานที่ก่อนเปิดกะ' });
    setLoading(true);
    try {
      const fd = new FormData(); fd.append('photo', checkInPhoto);
      const uploadRes = await api.post('/attendance/upload-photo?type=clock-in', fd);
      await api.post('/shifts/open', { cashier_id: user.id, opening_cash: openingCash, cash_breakdown: denomCounts, open_photo: uploadRes.data.photo_url });
      navigate('/pos');
    } catch (err: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
    finally { setLoading(false); }
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (pageLoading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-10 h-10 border-2 border-[#F12B6B] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-gray-400">กำลังตรวจสอบ...</p>
      </div>
    </div>
  );

  // ── Shared wrapper ────────────────────────────────────────────────────────────
  const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white border border-[#F6C7C7] rounded-2xl shadow-sm overflow-hidden">
        {/* Brand strip */}
        <div className="bg-[#F12B6B] px-5 py-4 flex items-center gap-3">
          <ShoppingBag size={22} className="text-white" />
          <div>
            <p className="text-white font-bold text-sm">DMTC Mart</p>
            <p className="text-pink-200 text-xs">{user.full_name}</p>
          </div>
          <button onClick={() => { localStorage.clear(); navigate('/login'); }} className="ml-auto p-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors duration-150" title="สลับบัญชี">
            <LogOut size={16} className="text-white" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );

  // ── ADMIN check-in ────────────────────────────────────────────────────────────
  if (isAdmin && needsCheckIn) return (
    <Card>
      <div className="text-center mb-5">
        <h2 className="text-lg font-bold text-gray-900">ลงชื่อเข้างาน</h2>
        <p className="text-xs text-gray-500 mt-1">ถ่ายรูปยืนยันว่าอยู่ที่สหกรณ์</p>
      </div>

      <label className="block cursor-pointer mb-4">
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => {
          const f = e.target.files?.[0]; if (f) { setCheckInPhoto(f); setCheckInPhotoPreview(URL.createObjectURL(f)); }
        }} />
        {checkInPhotoPreview
          ? <img src={checkInPhotoPreview} alt="preview" className="w-full h-44 object-cover rounded-xl border border-[#F6C7C7]" />
          : <div className="w-full h-44 rounded-xl border-2 border-dashed border-[#F6C7C7] flex flex-col items-center justify-center gap-2 text-[#FD94B4] hover:bg-[#FFF5F7] transition-colors duration-150">
              <Camera size={28} /> <span className="text-sm font-medium">แตะเพื่อถ่ายรูป</span>
            </div>
        }
      </label>

      <button onClick={handleAdminCheckIn} disabled={checkInLoading} className="w-full py-3 bg-[#F12B6B] hover:bg-[#FF467E] text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-50">
        {checkInLoading ? 'กำลังลงชื่อ...' : 'ลงชื่อเข้างาน'}
      </button>
    </Card>
  );

  // ── Cashier open shift ────────────────────────────────────────────────────────
  return (
    <Card>
      <div className="text-center mb-4">
        <h2 className="text-lg font-bold text-gray-900">เปิดกะการขาย</h2>
        <p className="text-xs text-gray-500 mt-1">นับเงินทอนตั้งต้นแยกแบงก์/เหรียญ</p>
        {lastClosedCash !== null && (
          <p className="text-[11px] text-gray-400 mt-0.5">อ้างอิงกะก่อน ฿{lastClosedCash.toLocaleString()}</p>
        )}
      </div>

      <form onSubmit={handleOpenShift} className="space-y-4">
        {/* Denomination grid */}
        <div className="grid grid-cols-2 gap-2">
          {DENOMINATIONS.map(d => (
            <div key={d} className="flex items-center gap-2 bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl px-3 py-2">
              <span className="text-xs font-semibold text-gray-600 w-10 shrink-0">฿{d}</span>
              <input type="number" min="0" value={denomCounts[d] ?? ''} placeholder="0"
                onChange={e => setDenomCounts({ ...denomCounts, [d]: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-full text-center text-sm bg-transparent outline-none focus:ring-0 border-none" />
            </div>
          ))}
        </div>

        {/* Total */}
        <div className="bg-[#FFF5F7] border border-[#F6C7C7] rounded-xl p-3 text-center">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">ยอดรวมตั้งต้น</p>
          <p className="text-2xl font-bold text-[#F12B6B]">฿{openingCash.toLocaleString()}</p>
        </div>

        {/* Photo */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1"><Camera size={12} /> ถ่ายรูปยืนยันสถานที่ <span className="text-red-400">*</span></p>
          <label className="block cursor-pointer">
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => {
              const f = e.target.files?.[0]; if (f) { setCheckInPhoto(f); setCheckInPhotoPreview(URL.createObjectURL(f)); }
            }} />
            {checkInPhotoPreview
              ? <img src={checkInPhotoPreview} alt="preview" className="w-full h-28 object-cover rounded-xl border border-[#F6C7C7]" />
              : <div className="w-full h-28 rounded-xl border-2 border-dashed border-[#F6C7C7] flex flex-col items-center justify-center gap-1.5 text-[#FD94B4] hover:bg-[#FFF5F7] transition-colors duration-150">
                  <Camera size={22} /><span className="text-xs font-medium">แตะเพื่อถ่ายรูป</span>
                </div>
            }
          </label>
        </div>

        <button type="submit" disabled={loading} className="w-full py-3 bg-[#F12B6B] hover:bg-[#FF467E] text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
          <Banknote size={16} /> {loading ? 'กำลังเปิดกะ...' : 'เริ่มขายสินค้า'}
        </button>
      </form>
    </Card>
  );
}
