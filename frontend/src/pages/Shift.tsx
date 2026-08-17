// 📄 pages/Shift.tsx — หน้าจัดการกะ/เข้า-ออกงาน (จุดเดียวครบ 4 สถานะ)
//    ทำอะไร: แสดงสถานะที่ตรงกับผู้ใช้ตอนนี้ — CASHIER เปิดกะ/ปิดกะ (นับเงิน+ถ่ายรูป), ADMIN/MANAGER
//    ลงชื่อเข้างาน/ออกงาน; รวมมาจากเดิมที่กระจายอยู่หลายหน้า
// ✅ CHANGED: consolidated check-in AND check-out (ADMIN attendance + CASHIER shift open/close) into
//   this single page — check-out used to live on Dashboard.tsx (ADMIN "ลงชื่อออกงาน" button +
//   CASHIER "ปิดกะการขาย" → CloseShiftModal), scattered across two pages. Now /shift alone shows
//   whichever of the 4 states applies (check-in / check-out / open shift / close shift) based on
//   today's attendance/shift status, reusing CloseShiftModal as-is for the close-shift step.
// 🔒 UNCHANGED: handleManagerCheckIn, handleOpenShift, checkAttendance/checkCurrentShift logic, denom counting

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, LogOut, Camera, Banknote, Home } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { BRAND } from '../theme';
import { getErrorMessage } from '../utils/errorMessage';
import { getCurrentUserOrRedirect } from '../utils/getCurrentUser';
import { performLogout } from '../utils/logout'; // 🐛 FIX — ออกจากระบบต้องเพิกถอน session ฝั่ง backend ด้วย
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/layout/PageHeader';
import { CloseShiftModal, type ShiftSummary } from '../components/dashboard/CloseShiftModal';

const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 1];

// ── Shared wrapper (module-level — เดิมนิยามใน component = สร้าง component ใหม่ทุก render)
function ShiftCard({ fullName, onHome, onLogout, children }: {
  fullName: string;
  onHome: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white border border-brand-border rounded-3xl shadow-sm overflow-hidden">
        {/* ⭐️ แถบหัวหน้ามาตรฐานเดียวกับทุกหน้า (PageHeader — ชื่อพนักงานเป็น subtitle, ปุ่มกลับหน้า Home + สลับบัญชี เป็น actions; shadow-none กันเงาโผล่ในกล่องการ์ด) */}
        <PageHeader
          icon={ShoppingBag}
          title="DMTC Mart"
          subtitle={fullName}
          className="shadow-none"
          actions={
            <>
              {/* ⭐️ ทางกลับหน้า Home กลาง — หน้านี้ไม่มี Sidebar/bottom nav (standalone เหมือนหน้า login) */}
              <button onClick={onHome} className="p-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors duration-150" title="กลับหน้าหลัก">
                <Home size={16} className="text-white" />
              </button>
              <button onClick={onLogout} className="p-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors duration-150" title="สลับบัญชี">
                <LogOut size={16} className="text-white" />
              </button>
            </>
          }
        />
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function Shift() {
  const [denomCounts, setDenomCounts] = useState<Record<number, number | ''>>({});
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const user = getCurrentUserOrRedirect(); // ⭐️ Sprint 0 — B2
  // ⭐️ Clock-in/out (ลงชื่อเข้า-ออกงาน) เปิดให้เฉพาะ CASHIER และ MANAGER เท่านั้น
  //   MANAGER ใช้ flow ถ่ายรูป+ลงชื่อแบบเดิมที่ ADMIN เคยใช้ (ย้ายสิทธิ์มาให้ MANAGER แทน)
  //   ส่วน ADMIN ไม่มีสิทธิ์ลงชื่อเข้า-ออกงานอีกต่อไป — เด้งออกจากหน้านี้ทันที (ดู useEffect ด้านล่าง)
  const isManager = user.role === 'MANAGER';
  const isAdmin = user.role === 'ADMIN';

  const [pageLoading, setPageLoading] = useState(true);
  const [needsCheckIn, setNeedsCheckIn] = useState(false);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkInPhoto, setCheckInPhoto] = useState<File | null>(null);
  const [checkInPhotoPreview, setCheckInPhotoPreview] = useState<string | null>(null);
  const [lastClosedCash, setLastClosedCash] = useState<number | null>(null);

  // ⭐️ NEW — MANAGER check-out (เดิมย้ายมาจาก Dashboard.tsx ตอนยังเป็นสิทธิ์ ADMIN)
  const [checkOutLoading, setCheckOutLoading] = useState(false);
  const [checkOutPhoto, setCheckOutPhoto] = useState<File | null>(null);
  const [checkOutPhotoPreview, setCheckOutPhotoPreview] = useState<string | null>(null);

  // ⭐️ NEW — CASHIER close shift (ย้ายมาจาก Dashboard.tsx)
  const [hasOpenShift, setHasOpenShift] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  const [discrepancyCategory, setDiscrepancyCategory] = useState('');
  const [closeLoading, setCloseLoading] = useState(false);
  const [closePhoto, setClosePhoto] = useState<File | null>(null);
  const [closePhotoPreview, setClosePhotoPreview] = useState<string | null>(null);
  const [shiftSummary, setShiftSummary] = useState<ShiftSummary | null>(null);

  const openingCash = DENOMINATIONS.reduce((sum, d) => sum + d * (Number(denomCounts[d]) || 0), 0);
  const actualCash = openingCash; // เลขเดียวกัน ใช้ทั้งนับเงินเปิดกะและปิดกะ (denomCounts คนละรอบ)

  // ⭐️ ADMIN ไม่มีสิทธิ์ลงชื่อเข้า-ออกงานอีกต่อไป — เด้งออกทันทีถ้าหลุดมาที่หน้านี้ (เช่นพิมพ์ URL ตรง)
  useEffect(() => {
    if (isAdmin) navigate('/dashboard', { replace: true });
  }, [isAdmin, navigate]);

  useEffect(() => {
    if (isAdmin) return; // เด้งออกอยู่แล้วด้านบน ไม่ต้องยิง API ให้เสียเที่ยว
    if (isManager) {
      const checkAttendance = async () => {
        try { const res = await api.get('/attendance/today'); setNeedsCheckIn(!res.data); }
        catch { setNeedsCheckIn(true); } finally { setPageLoading(false); }
      };
      checkAttendance(); return;
    }
    const checkCurrentShift = async () => {
      try {
        const res = await api.get(`/shifts/current?cashier_id=${user.id}`);
        if (res.data?.id) { setHasOpenShift(true); setPageLoading(false); return; }
      } catch { /* ไม่มีกะเปิดอยู่ → ไปเช็คกะล่าสุดต่อ */ }
      try {
        const lastRes = await api.get(`/shifts/last-closed?cashier_id=${user.id}`);
        if (lastRes.data) { setLastClosedCash(Number(lastRes.data.actual_cash)); if (lastRes.data.closing_cash_breakdown) setDenomCounts(lastRes.data.closing_cash_breakdown); }
      } catch { /* ดึงกะล่าสุดไม่ได้ — คงเป็นกะแรก */ }
      setPageLoading(false);
    };
    checkCurrentShift();
  }, [user.id, user.role, isAdmin, isManager]);

  const handleManagerCheckIn = async () => {
    if (!checkInPhoto) return Swal.fire({ icon: 'warning', title: 'กรุณาถ่ายรูปยืนยันสถานที่ก่อน' });
    setCheckInLoading(true);
    try {
      const fd = new FormData(); fd.append('photo', checkInPhoto);
      const uploadRes = await api.post('/attendance/upload-photo?type=clock-in', fd);
      await api.post('/attendance/check-in', { check_in_photo: uploadRes.data.photo_url });
      navigate('/dashboard');
    } catch (err) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
    finally { setCheckInLoading(false); }
  };

  // ⭐️ NEW — ย้ายมาจาก Dashboard.tsx handleCheckOutPhotoSelected (ตัด confirm dialog ออกเพราะ
  // หน้านี้เป็นจุดหมายที่ตั้งใจมาแล้ว ไม่ต้องถามซ้ำ)
  const handleManagerCheckOut = async () => {
    if (!checkOutPhoto) return Swal.fire({ icon: 'warning', title: 'กรุณาถ่ายรูปยืนยันสถานที่ก่อน' });
    setCheckOutLoading(true);
    try {
      const fd = new FormData(); fd.append('photo', checkOutPhoto);
      const uploadRes = await api.post('/attendance/upload-photo', fd);
      await api.put('/attendance/check-out', { check_out_photo: uploadRes.data.photo_url });
      Swal.fire({ icon: 'success', title: 'ลงชื่อออกงานสำเร็จ', showConfirmButton: false, timer: 1500 });
      // ⭐️ ลงชื่อออกงานเสร็จแล้วไม่ต้องเตะออกจากระบบ (ตามคำขอผู้ใช้) — กลับหน้า Home ให้เลือกทำอย่างอื่นต่อได้
      setTimeout(() => navigate('/home'), 1500);
    } catch (err) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
    finally { setCheckOutLoading(false); }
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
    } catch (err) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
    finally { setLoading(false); }
  };

  // ⭐️ NEW — ย้ายมาจาก Dashboard.tsx handleCloseShift
  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (actualCash <= 0) return Swal.fire({ icon: 'warning', title: 'กรุณานับเงินสดในลิ้นชักก่อน' });
    if (!closePhoto) return Swal.fire({ icon: 'warning', title: 'กรุณาถ่ายรูปยืนยันสถานที่ก่อนปิดกะ' });
    setCloseLoading(true);
    try {
      const fd = new FormData(); fd.append('photo', closePhoto);
      const uploadRes = await api.post('/attendance/upload-photo?type=clock-out', fd);
      const response = await api.post('/shifts/close', { cashier_id: user.id, actual_cash: actualCash, note: closeNote || undefined, discrepancy_category: discrepancyCategory || undefined, cash_breakdown: denomCounts, close_photo: uploadRes.data.photo_url });
      // ⭐️ F2 — status 202 = ส่วนต่างเกิน 100 บาท กะยังไม่ปิดจริง ต้องรอ ADMIN คนอื่นอนุมัติก่อน
      if (response.status === 202) {
        await Swal.fire({
          icon: 'warning',
          title: 'ส่วนต่างเงินสดเกิน 100 บาท',
          text: `${response.data.message || 'กะนี้ต้องรอ ADMIN อนุมัติก่อนถึงจะปิดกะสำเร็จ'} กรุณาออกจากระบบ`,
          confirmButtonColor: BRAND,
          confirmButtonText: 'ออกจากระบบ',
          allowOutsideClick: false,
        });
        // ⭐️ F2 — เคสนี้ยังบังคับออกจากระบบอยู่ (ต่างจาก flow ปกติ) เพราะกะยังไม่ปิดจริง
        //   ห้ามให้ขายต่อระหว่างรอ ADMIN อนุมัติ — แต่ต้องเพิกถอน session ฝั่ง backend ให้ถูกต้อง
        await performLogout();
        navigate('/login');
        return;
      }
      setShiftSummary(response.data.summary);
    } catch (error) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(error) }); }
    finally { setCloseLoading(false); }
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (pageLoading) return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-10 h-10 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-gray-400">กำลังตรวจสอบ...</p>
      </div>
    </div>
  );


  // ── MANAGER check-in ──────────────────────────────────────────────────────────
  if (isManager && needsCheckIn) return (
    <ShiftCard fullName={user.full_name} onHome={() => navigate('/home')} onLogout={async () => { await performLogout(); navigate('/login'); }}>
      <div className="text-center mb-5">
        <h2 className="text-lg font-bold text-gray-900">ลงชื่อเข้างาน</h2>
        <p className="text-xs text-gray-500 mt-1">ถ่ายรูปยืนยันว่าอยู่ที่สหกรณ์</p>
      </div>

      <label className="block cursor-pointer mb-4">
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => {
          const f = e.target.files?.[0]; if (f) { setCheckInPhoto(f); setCheckInPhotoPreview(URL.createObjectURL(f)); }
        }} />
        {checkInPhotoPreview
          ? <img src={checkInPhotoPreview} alt="preview" className="w-full h-44 object-cover rounded-xl border border-brand-border" />
          : <div className="w-full h-44 rounded-xl border-2 border-dashed border-brand-border flex flex-col items-center justify-center gap-2 text-brand-mid hover:bg-brand-bg transition-colors duration-150">
              <Camera size={28} /> <span className="text-sm font-medium">แตะเพื่อถ่ายรูป</span>
            </div>
        }
      </label>

      <Button onClick={handleManagerCheckIn} loading={checkInLoading} className="w-full py-3.5">
        {checkInLoading ? 'กำลังลงชื่อ...' : 'ลงชื่อเข้างาน'}
      </Button>
    </ShiftCard>
  );

  // ── MANAGER check-out (⭐️ เดิมเป็นสิทธิ์ ADMIN ย้ายมาให้ MANAGER ตามนโยบายใหม่) ─────────────
  if (isManager) return (
    <ShiftCard fullName={user.full_name} onHome={() => navigate('/home')} onLogout={async () => { await performLogout(); navigate('/login'); }}>
      <div className="text-center mb-5">
        <h2 className="text-lg font-bold text-gray-900">ลงชื่อออกงาน</h2>
        <p className="text-xs text-gray-500 mt-1">ถ่ายรูปยืนยันก่อนออกจากระบบ</p>
      </div>

      <label className="block cursor-pointer mb-4">
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => {
          const f = e.target.files?.[0]; if (f) { setCheckOutPhoto(f); setCheckOutPhotoPreview(URL.createObjectURL(f)); }
        }} />
        {checkOutPhotoPreview
          ? <img src={checkOutPhotoPreview} alt="preview" className="w-full h-44 object-cover rounded-xl border border-brand-border" />
          : <div className="w-full h-44 rounded-xl border-2 border-dashed border-brand-border flex flex-col items-center justify-center gap-2 text-brand-mid hover:bg-brand-bg transition-colors duration-150">
              <Camera size={28} /> <span className="text-sm font-medium">แตะเพื่อถ่ายรูป</span>
            </div>
        }
      </label>

      <Button variant="danger" onClick={handleManagerCheckOut} loading={checkOutLoading} className="w-full py-3.5">
        {checkOutLoading ? 'กำลังลงชื่อ...' : 'ลงชื่อออกงาน'}
      </Button>
    </ShiftCard>
  );

  // ── CASHIER close shift (⭐️ NEW — เดิมอยู่ปุ่ม "ปิดกะการขาย" ในหน้า Dashboard) ────────────────
  if (hasOpenShift) return (
    <CloseShiftModal
      denomCounts={denomCounts}
      onDenomChange={(d, value) => setDenomCounts({ ...denomCounts, [d]: value })}
      discrepancyCategory={discrepancyCategory}
      onDiscrepancyCategoryChange={setDiscrepancyCategory}
      closeNote={closeNote}
      onCloseNoteChange={setCloseNote}
      closePhotoPreview={closePhotoPreview}
      onPhotoSelected={(file) => { setClosePhoto(file); setClosePhotoPreview(URL.createObjectURL(file)); }}
      closeLoading={closeLoading}
      actualCash={actualCash}
      shiftSummary={shiftSummary}
      onSubmit={handleCloseShift}
      onClose={() => navigate('/home')}
      onDone={() => {
        navigate('/home');
      }}
    />
  );

  // ── Cashier open shift ────────────────────────────────────────────────────────
  return (
    <ShiftCard fullName={user.full_name} onHome={() => navigate('/home')} onLogout={async () => { await performLogout(); navigate('/login'); }}>
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
            <div key={d} className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-xl px-3 py-2">
              <span className="text-xs font-semibold text-gray-600 w-10 shrink-0">฿{d}</span>
              <input type="number" min="0" value={denomCounts[d] ?? ''} placeholder="0"
                onChange={e => setDenomCounts({ ...denomCounts, [d]: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-full text-center text-sm bg-transparent outline-none focus:ring-0 border-none" />
            </div>
          ))}
        </div>

        {/* Total */}
        <div className="bg-brand-bg border border-brand-border rounded-xl p-3 text-center">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">ยอดรวมตั้งต้น</p>
          <p className="text-2xl font-bold text-brand">฿{openingCash.toLocaleString()}</p>
        </div>

        {/* Photo */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1"><Camera size={12} /> ถ่ายรูปยืนยันสถานที่ <span className="text-red-400">*</span></p>
          <label className="block cursor-pointer">
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => {
              const f = e.target.files?.[0]; if (f) { setCheckInPhoto(f); setCheckInPhotoPreview(URL.createObjectURL(f)); }
            }} />
            {checkInPhotoPreview
              ? <img src={checkInPhotoPreview} alt="preview" className="w-full h-28 object-cover rounded-xl border border-brand-border" />
              : <div className="w-full h-28 rounded-xl border-2 border-dashed border-brand-border flex flex-col items-center justify-center gap-1.5 text-brand-mid hover:bg-brand-bg transition-colors duration-150">
                  <Camera size={22} /><span className="text-xs font-medium">แตะเพื่อถ่ายรูป</span>
                </div>
            }
          </label>
        </div>

        <Button type="submit" loading={loading} className="w-full py-3.5">
          <Banknote size={16} /> {loading ? 'กำลังเปิดกะ...' : 'เริ่มขายสินค้า'}
        </Button>
      </form>
    </ShiftCard>
  );
}
