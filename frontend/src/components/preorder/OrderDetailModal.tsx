import { X } from 'lucide-react';
import api from '../../api';
import Swal from '../../swal';
import { getErrorMessage } from '../../utils/errorMessage';
import { formatBangkokTime } from '../../utils/timezone';
import AuthImage from '../AuthImage'; // ⭐️ SECURITY FIX #1 — โหลดสลิปผ่าน JWT

// ⭐️ Construct slip image path from created_at date + filename
// รูปใหม่เก็บเป็น URL/พาธเต็ม (https://cloudinary... หรือ /uploads/...) → คืนตรงๆ
// รูปเก่าเก็บเป็นชื่อไฟล์ล้วน → ประกอบพาธจากวันที่เหมือนเดิม
function getSlipImagePath(createdAt: string, filename: string): string {
  if (!filename) return '';
  if (/^https?:\/\//i.test(filename) || filename.startsWith('/')) return filename;
  const date = new Date(createdAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `/uploads/slips/${year}-${month}-${day}/${filename}`;
}

interface OrderDetailModalProps {
  selectedOrder: any;
  refundReason: string;
  onRefundReasonChange: (value: string) => void;
  onClose: () => void;
  onCancelOrder: (order: any, reason: string) => void;
  fetchMyOrders: () => Promise<void>;
}

export function OrderDetailModal({ selectedOrder, refundReason, onRefundReasonChange, onClose, onCancelOrder, fetchMyOrders }: OrderDetailModalProps) {
  return (
    // ⭐️ FIX: z-50 เดิมเท่ากับ bottom nav (z-50 ใน Layout.tsx) — เพราะ nav อยู่หลัง <main> ใน DOM ทำให้
    // แม้ backdrop คลุมเต็มจอ nav ก็ยังโผล่ทับด้านบนอยู่ (ตามภาพที่แจ้ง) ยกเป็น z-[80] ให้อยู่เหนือ nav แน่นอน
    <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4 backdrop-blur-sm transition-opacity duration-300">
      {/* ⭐️ FIX: ปรับให้เหมือนสไตล์การ์ด/หัวข้อหน้า POS — แบนขึ้น ตัดไล่สีออก ใช้ theme token ตรงๆ
          เดิม max-h-[90vh] บนมือถือจริง vh นับรวมแถบ URL bar ทำให้ modal โดนตัดปุ่มด้านล่าง เปลี่ยนเป็น dvh */}
      {/* ⭐️ FIX: เดิมไม่มี overflow-hidden — header สีชมพูมุมตรง (ไม่ได้ใส่ rounded-t) เลยล้นทับมุมโค้ง
          ของการ์ดแม่ (rounded-2xl) ทำให้ขอบบนดูเหลี่ยม ไม่มน ใส่ overflow-hidden ให้ครอบตัดตามการ์ดแม่ */}
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[85dvh] flex flex-col overflow-hidden animate-fade-in">
        {/* Header - Sticky */}
        <div className="shrink-0 bg-gradient-to-r from-brand to-brand-dark px-4 py-3 flex justify-between items-center gap-3 shadow-sm">
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-base truncate">ออเดอร์ #{selectedOrder.id}</h2>
            <p className="text-white/80 text-xs mt-0.5">{formatBangkokTime(selectedOrder.created_at)}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-white transition-colors duration-150"
            aria-label="ปิด"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* ⭐️ FIX: เอาคำว่า "สำเร็จแล้ว" ออก — ซ่อนป้ายสถานะทั้งอันตอน COMPLETED เพราะดูซ้ำซ้อน
              ในมุมมองประวัติออเดอร์ที่รู้อยู่แล้วว่าสำเร็จ (สถานะอื่นที่ยังต้องติดตามยังโชว์ตามปกติ) */}
          {selectedOrder.status !== 'COMPLETED' && (
          <div className="flex justify-center">
            <span className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs sm:text-sm font-semibold shadow-sm transition-transform duration-150 ${
              selectedOrder.status === 'PENDING_VERIFY' ? 'bg-blue-100 text-blue-800' :
              selectedOrder.status === 'WAITING_CASH' ? 'bg-yellow-100 text-yellow-800' :
              selectedOrder.status === 'PREPARING' ? 'bg-orange-100 text-orange-800' :
              selectedOrder.status === 'READY' ? 'bg-green-100 text-green-800' :
              selectedOrder.status === 'COMPLETED' ? 'bg-gray-100 text-gray-700' :
              selectedOrder.status === 'CANCELLED' ? 'bg-red-100 text-red-700' :
              selectedOrder.status === 'SLIP_REJECTED' ? 'bg-red-100 text-red-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {selectedOrder.status === 'PENDING_VERIFY' && '⏳ รอตรวจสลิป'}
              {selectedOrder.status === 'WAITING_CASH' && '💵 รอชำระเงิน'}
              {selectedOrder.status === 'PREPARING' && '📦 กำลังเตรียมของ'}
              {selectedOrder.status === 'READY' && '✅ พร้อมรับสินค้า'}
              {selectedOrder.status === 'CANCELLED' && '❌ ยกเลิกแล้ว'}
              {selectedOrder.status === 'SLIP_REJECTED' && '⚠️ สลิปผิด'}
            </span>
          </div>
          )}

          {/* Slip Image Section */}
          {(selectedOrder.payment_method === 'QR' || selectedOrder.slip_image) && (
            <div className="bg-brand-bg rounded-xl p-4 text-center border border-brand-border">
              <p className="text-xs sm:text-sm text-gray-600 font-semibold mb-3 flex items-center justify-center gap-2">
                <span className="text-lg">🧾</span> หลักฐานการชำระเงิน
              </p>
              {selectedOrder.slip_image ? (
                // ⭐️ FIX: เดิมไม่มี max-height เลย ถ้าสลิปเป็นรูปแนวตั้ง/ความละเอียดสูงจะดันความสูงทั้ง
                // modal บวมจนต้องเลื่อนไกลกว่าจะเจอปุ่มด้านล่าง — จำกัดความสูงไว้ + object-contain
                // ⭐️ SECURITY FIX #1 — โหลดผ่าน AuthImage (แนบ JWT) แทน <img src> ตรงๆ
                <AuthImage
                  path={getSlipImagePath(selectedOrder.created_at, selectedOrder.slip_image)}
                  alt="slip"
                  className="w-full max-h-64 sm:max-h-80 object-contain rounded-xl border border-brand-border bg-white"
                  fallback={<p className="text-gray-500 text-sm py-8">โหลดรูปสลิปไม่ได้</p>}
                />
              ) : (
                <p className="text-gray-500 text-sm py-8">ยังไม่ได้อัปโหลดสลิป</p>
              )}
            </div>
          )}

          {/* Upload Slip Section */}
          {selectedOrder.status === 'PENDING_VERIFY' && !selectedOrder.slip_image && (
            <label className="block cursor-pointer group">
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0]; if (!file) return;
                try {
                  const fd = new FormData(); fd.append('slip', file);
                  await api.post(`/orders/${selectedOrder.id}/upload-slip`, fd);
                  // ⭐️ Fetch updated orders BEFORE closing modal to avoid stale selectedOrder
                  await fetchMyOrders();
                  onClose();
                  Swal.fire({ icon: 'success', title: 'อัปโหลดสลิปสำเร็จ', text: 'รอพนักงานตรวจสอบสักครู่', showConfirmButton: false, timer: 2000 });
                } catch (err: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
              }} />
              <div className="border-2 border-dashed border-brand-mid rounded-2xl p-6 sm:p-7 text-center bg-brand-bg group-hover:bg-brand-border group-active:bg-brand-border transition-colors duration-150">
                <p className="text-brand font-bold text-sm sm:text-base">📎 แตะเพื่ออัปโหลดสลิป</p>
                <p className="text-brand text-xs sm:text-sm mt-2">(รูปภาพขนาดไม่เกิน 5 MB)</p>
              </div>
            </label>
          )}

          {/* Resubmit Slip */}
          {selectedOrder.status === 'SLIP_REJECTED' && (
            <label className="block cursor-pointer group">
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0]; if (!file) return;
                try {
                  const fd = new FormData(); fd.append('slip', file);
                  await api.post(`/orders/${selectedOrder.id}/upload-slip`, fd);
                  // ⭐️ Fetch updated orders BEFORE closing modal to avoid stale selectedOrder
                  await fetchMyOrders();
                  onClose();
                  Swal.fire({ icon: 'success', title: 'ส่งสลิปใหม่สำเร็จ', text: 'รอพนักงานตรวจสอบสักครู่', showConfirmButton: false, timer: 2000 });
                } catch (err: any) { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) }); }
              }} />
              <div className="border-2 border-dashed border-red-300 rounded-2xl p-6 sm:p-7 text-center bg-red-50 group-hover:bg-red-100 group-active:bg-red-75 transition-colors duration-150">
                <p className="text-red-600 font-bold text-sm sm:text-base">📎 แตะเพื่อส่งสลิปใหม่</p>
                <p className="text-red-500 text-xs sm:text-sm mt-2">สลิปของท่านไม่ถูกต้อง กรุณาส่งสลิปใหม่</p>
              </div>
            </label>
          )}

          {/* Items Section */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <h3 className="font-bold text-gray-800 text-sm mb-3 flex items-center gap-2">
              <span className="text-lg">📦</span> รายการสินค้า ({selectedOrder.items?.length})
            </h3>
            <div className="space-y-2">
              {selectedOrder.items?.map((item: any) => (
                <div key={item.id} className="flex justify-between items-center gap-3 py-2.5 px-3 bg-white rounded-lg border border-gray-100">
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-800 font-medium text-sm truncate">{item.product_name}</p>
                    <p className="text-gray-500 text-xs mt-0.5">จำนวน: {item.quantity} ชิ้น</p>
                  </div>
                  <p className="font-bold text-brand text-sm whitespace-nowrap">฿{Number(item.subtotal).toFixed(2)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Points Discount */}
          {Number(selectedOrder.points_discount) > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
              <p className="text-sm text-yellow-800 font-semibold flex items-center gap-2">
                <span className="text-lg">🌟</span> ใช้แต้มลด {selectedOrder.points_redeemed} แต้ม
              </p>
              <p className="text-base font-bold text-yellow-700 mt-2">ลด ฿{Number(selectedOrder.points_discount).toFixed(2)}</p>
            </div>
          )}

          {/* Reject Reason */}
          {selectedOrder.status === 'SLIP_REJECTED' && selectedOrder.reject_reason && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-xs sm:text-sm text-red-700 font-bold">⚠️ เหตุผลที่ปฏิเสธ:</p>
              <p className="text-sm text-red-800 mt-2 leading-relaxed">{selectedOrder.reject_reason}</p>
            </div>
          )}

          {/* Total Amount */}
          <div className="bg-brand-bg border border-brand-border rounded-xl p-4">
            <p className="text-gray-700 text-xs sm:text-sm font-medium mb-1">ยอดรวมทั้งสิ้น</p>
            <p className="text-2xl sm:text-3xl font-bold text-brand">
              ฿{Number(selectedOrder.total_amount).toFixed(2)}
            </p>
          </div>

          {/* Refund Reason Input */}
          {['PENDING_VERIFY', 'WAITING_CASH', 'SLIP_REJECTED'].includes(selectedOrder.status) && (
            <div className="space-y-2.5 pt-2">
              <label className="block text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                🔍 เหตุผลในการยกเลิก
                <span className="text-red-500 font-bold">*</span>
              </label>
              <textarea
                placeholder="ระบุเหตุผลการยกเลิก เช่น เปลี่ยนใจ, ส่วนลดน้อยเกินไป, ฯลฯ"
                value={refundReason}
                onChange={(e) => onRefundReasonChange(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-border transition-colors duration-150 resize-none h-24 bg-gray-50 placeholder:text-gray-400"
              />
              <p className="text-xs text-gray-500 text-right">{refundReason.length} / 200</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2.5 pt-2 pb-1">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 active:scale-95 text-gray-800 font-bold rounded-xl transition-all duration-150 text-sm"
            >
              ปิด
            </button>
            {['PENDING_VERIFY', 'WAITING_CASH', 'SLIP_REJECTED'].includes(selectedOrder.status) && (
              <button
                onClick={() => onCancelOrder(selectedOrder, refundReason)}
                disabled={!refundReason.trim()}
                className="flex-1 px-4 py-3 bg-red-500 hover:bg-red-600 active:scale-95 text-white font-bold rounded-xl transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                ยกเลิกออเดอร์
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
