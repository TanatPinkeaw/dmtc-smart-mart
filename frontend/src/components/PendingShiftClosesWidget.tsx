import { useState, useEffect } from 'react';
import { Clock, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../api';
import Swal from '../swal';
import { useSocket } from '../SocketContext';
import AuthImage, { openAuthImage } from './AuthImage'; // ⭐️ SECURITY FIX #1 — โหลดรูปเข้างานผ่าน JWT

interface PendingShift {
  id: number;
  cashier_id: number;
  cashier_name: string;
  opening_cash: number;
  expected_cash: number;
  actual_cash: number | null;
  difference?: number;
  variance?: number;
  opened_at: string;
  note?: string;
  close_photo?: string;
  discrepancy_category?: string;
}

export default function PendingShiftClosesWidget() {
  const [pending, setPending] = useState<PendingShift[]>([]);
  const [loading, setLoading] = useState(false);
  const socket = useSocket();

  useEffect(() => {
    loadPending();

    if (socket) {
      socket.on('shift_pending_close', () => {
        loadPending();
      });

      return () => {
        socket.off('shift_pending_close');
      };
    }
  }, [socket]);

  const loadPending = async () => {
    setLoading(true);
    try {
      const res = await api.get('/shifts/pending');
      setPending(res.data);
    } catch (err: any) {
      console.error('Failed to load pending shifts:', err);
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: 'ไม่สามารถโหลดข้อมูลรายการรออนุมัติได้' });
    } finally {
      setLoading(false);
    }
  };

  const getVarianceColor = (variance: number) => {
    if (variance < 50) return 'text-green-600 bg-green-50';
    if (variance < 100) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const getVarianceBgColor = (variance: number) => {
    if (variance < 50) return 'bg-green-100';
    if (variance < 100) return 'bg-yellow-100';
    return 'bg-red-100';
  };

  const handleApprove = async (shift: PendingShift) => {
    const { value: password } = await Swal.fire({
      title: 'ยืนยันการอนุมัติ',
      text: `ยืนยันการอนุมัติปิดกะของ ${shift.cashier_name}?`,
      input: 'password',
      inputPlaceholder: 'ระบุรหัสผ่านของคุณ',
      showCancelButton: true,
      confirmButtonText: 'อนุมัติ',
      cancelButtonText: 'ยกเลิก',
      inputAttributes: {
        autocapitalize: 'off',
        autocorrect: 'off'
      }
    });

    if (!password) return;

    const { value: approvalNotes } = await Swal.fire({
      title: 'หมายเหตุการอนุมัติ',
      input: 'textarea',
      inputPlaceholder: 'ระบุหมายเหตุ (ถ้ามี)',
      showCancelButton: true,
      confirmButtonText: 'ยืนยัน',
      cancelButtonText: 'ยกเลิก'
    });

    if (approvalNotes === undefined) return;

    try {
      await api.put(`/shifts/${shift.id}/approve`, {
        approval_notes: approvalNotes || 'ผ่านการตรวจสอบ',
        password
      });

      Swal.fire({
        icon: 'success',
        title: 'อนุมัติปิดกะสำเร็จ',
        text: `กะของ ${shift.cashier_name} ได้รับการอนุมัติแล้ว`,
        confirmButtonText: 'ตกลง'
      });
      loadPending();
    } catch (err: any) {
      Swal.fire({
        icon: 'error',
        title: 'ผิดพลาด',
        text: err.response?.data?.error || 'ไม่สามารถอนุมัติได้',
        confirmButtonText: 'ตกลง'
      });
    }
  };

  const handleReject = async (shift: PendingShift) => {
    const { value: reason } = await Swal.fire({
      title: 'ปฏิเสธการปิดกะ',
      text: `คุณแน่ใจหรือไม่ที่จะปฏิเสธการปิดกะของ ${shift.cashier_name}?`,
      input: 'textarea',
      inputPlaceholder: 'ระบุเหตุผลในการปฏิเสธ',
      showCancelButton: true,
      confirmButtonText: 'ปฏิเสธ',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#ef4444'
    });

    if (!reason) return;

    try {
      await api.put(`/shifts/${shift.id}/reject`, {
        reason
      });

      Swal.fire({
        icon: 'info',
        title: 'ปฏิเสธการปิดกะเรียบร้อย',
        text: `กะของ ${shift.cashier_name} ถูกเปิดใหม่ เขาสามารถลองปิดอีกครั้งได้`,
        confirmButtonText: 'ตกลง'
      });
      loadPending();
    } catch (err: any) {
      Swal.fire({
        icon: 'error',
        title: 'ผิดพลาด',
        text: err.response?.data?.error || 'ไม่สามารถปฏิเสธได้',
        confirmButtonText: 'ตกลง'
      });
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex items-center justify-center h-32">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#F12B6B]"></div>
            <p className="text-gray-600 mt-2">กำลังโหลด...</p>
          </div>
        </div>
      </div>
    );
  }

  if (pending.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
        <div className="flex items-center gap-3">
          <CheckCircle className="w-6 h-6 text-green-600" />
          <div>
            <h3 className="font-bold text-green-800">ไม่มีการรอการอนุมัติ</h3>
            <p className="text-sm text-green-700">ทั้งหมดรอจนนี้สำเร็จแล้ว</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow mb-6">
      <div className="bg-gradient-to-r from-[#F12B6B] to-[#E91E5F] px-6 py-4 rounded-t-lg">
        <div className="flex items-center gap-2">
          <Clock className="w-6 h-6 text-white" />
          <h2 className="text-xl font-bold text-white">
            การรอการอนุมัติปิดกะ ({pending.length})
          </h2>
        </div>
      </div>

      <div className="divide-y">
        {pending.map((shift) => {
          const variance = shift.variance ?? Math.abs(shift.difference ?? 0);
          const openedTime = new Date(shift.opened_at).toLocaleString('th-TH', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });

          return (
            <div key={shift.id} className="p-6 hover:bg-gray-50 transition-colors">
              {/* Header: Cashier name and time */}
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-lg text-gray-800">{shift.cashier_name}</h3>
                  <p className="text-sm text-gray-500">{openedTime}</p>
                </div>
                <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-xs font-bold">
                  รอการอนุมัติ
                </span>
              </div>

              {/* Cash Summary Grid */}
              {/* ⭐️ FIX: DB stores these as DECIMAL(10,2) baht already (not satang) — money.js converts
                  satang→baht before writing to the column. Dividing by 100 here double-converted the
                  values, showing ฿5.55 as ฿0.0555 etc. Removed the /100. */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-600 mb-1">เงินเปิดกะ</p>
                  <p className="font-bold text-gray-800">
                    ฿{Number(shift.opening_cash).toFixed(2)}
                  </p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-600 mb-1">เงินที่คาดว่า</p>
                  <p className="font-bold text-gray-800">
                    ฿{Number(shift.expected_cash).toFixed(2)}
                  </p>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs text-blue-600 mb-1">เงินที่นำมา</p>
                  <p className="font-bold text-blue-800">
                    ฿{Number(shift.actual_cash || 0).toFixed(2)}
                  </p>
                </div>
                <div className={`${getVarianceBgColor(variance)} p-3 rounded-lg`}>
                  <p className={`text-xs mb-1 ${getVarianceColor(variance)}`}>ส่วนต่าง</p>
                  <p className={`font-bold ${getVarianceColor(variance)}`}>
                    ฿{Number(variance).toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Variance indicator */}
              {variance > 100 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex gap-2">
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-red-800 text-sm">
                      ส่วนต่างเงินสดเกิน 100 บาท
                    </p>
                    <p className="text-xs text-red-700">
                      โปรดตรวจสอบตัวเลขและหมายเหตุอย่างละเอียด
                    </p>
                  </div>
                </div>
              )}

              {/* Cashier notes */}
              {shift.note && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                  <p className="text-xs font-bold text-yellow-800 mb-1">หมายเหตุของแคชเชียร์:</p>
                  <p className="text-sm text-yellow-900">{shift.note}</p>
                </div>
              )}

              {/* Discrepancy category */}
              {shift.discrepancy_category && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4">
                  <p className="text-xs font-bold text-purple-800 mb-1">สาเหตุที่คาดว่า:</p>
                  <p className="text-sm text-purple-900">
                    {shift.discrepancy_category === 'SHORT_CHANGE' && 'ทอนเงินผิด'}
                    {shift.discrepancy_category === 'FAKE_BILL' && 'เงินปลอม'}
                    {shift.discrepancy_category === 'FORGOT_RECEIPT' && 'ลืมเช็ครายการ'}
                    {shift.discrepancy_category === 'CUSTOMER_RETURN' && 'ลูกค้าคืนสินค้า'}
                    {shift.discrepancy_category === 'OTHER' && 'อื่น ๆ'}
                  </p>
                </div>
              )}

              {/* Close photo preview */}
              {/* ⭐️ SECURITY FIX #1 — close_photo (/uploads/shift-photos/...) ถูกล็อกให้ต้องมี JWT แล้ว
                  โหลดผ่าน AuthImage แทน <img src> ตรงๆ (ซึ่งจะโดน 401) กดดูรูปใหญ่ผ่าน openAuthImage */}
              {shift.close_photo && (
                <div className="mb-4">
                  <p className="text-xs font-bold text-gray-600 mb-2">รูปยืนยันสถานที่:</p>
                  <AuthImage
                    path={shift.close_photo}
                    alt="Close shift confirmation"
                    className="w-full max-w-xs rounded-lg border border-gray-200 cursor-pointer hover:shadow-lg transition-shadow"
                    onClick={() => openAuthImage(shift.close_photo)}
                    fallback={<p className="text-xs text-gray-400">โหลดรูปไม่ได้</p>}
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => handleApprove(shift)}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  ✅ อนุมัติ
                </button>
                <button
                  onClick={() => handleReject(shift)}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  ❌ ปฏิเสธ
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
