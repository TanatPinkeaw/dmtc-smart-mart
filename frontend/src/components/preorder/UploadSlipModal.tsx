// ⭐️ โมดัลส่งสลิปใหม่แบบใช้ซ้ำได้ — ดึงตรรกะอัปโหลดที่เดิมฝังอยู่ใน OrderDetailModal ออกมา
// เพื่อให้เรียกได้จากหลายที่โดยไม่ต้องเปิดหน้ารายละเอียดออเดอร์ก่อน:
//   1. การ์ดแจ้งเตือนสลิปไม่ผ่าน (pages/Notifications.tsx)
//   2. แถบเตือนด้านบนของ Layout (components/Layout.tsx)
//   3. การ์ดออเดอร์ในประวัติการสั่งจอง (components/preorder/MyOrdersModal.tsx)
// endpoint เดิม: POST /orders/:id/upload-slip (multipart, field ชื่อ 'slip')
// backend จะรีเซ็ตสถานะ SLIP_REJECTED กลับเป็น PENDING_VERIFY ให้เองหลังอัปสำเร็จ

import { useState } from 'react';
import { X, Upload } from 'lucide-react';
import api from '../../api';
import Swal from '../../swal';
import { getErrorMessage } from '../../utils/errorMessage';

interface UploadSlipModalProps {
  orderId: number;
  /** เหตุผลที่สลิปเดิมไม่ผ่าน (ถ้ามี) — ช่วยให้ผู้ใช้รู้ว่าต้องแก้อะไร */
  rejectReason?: string | null;
  onClose: () => void;
  /** เรียกหลังอัปโหลดสำเร็จ เพื่อให้หน้าที่เปิดโมดัลไป refetch ข้อมูลของตัวเอง */
  onUploaded?: () => void | Promise<void>;
}

export function UploadSlipModal({ orderId, rejectReason, onClose, onUploaded }: UploadSlipModalProps) {
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('slip', file);
      await api.post(`/orders/${orderId}/upload-slip`, fd);
      // ⭐️ refetch ให้เสร็จก่อนปิดโมดัล กัน UI ค้างสถานะเก่า (pattern เดียวกับ OrderDetailModal เดิม)
      if (onUploaded) await onUploaded();
      onClose();
      Swal.fire({ icon: 'success', title: 'ส่งสลิปใหม่สำเร็จ', text: 'รอพนักงานตรวจสอบสักครู่', showConfirmButton: false, timer: 2000 });
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: getErrorMessage(err) });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="p-4 bg-gradient-to-r from-brand to-brand-dark flex justify-between items-center shrink-0">
          <h2 className="font-semibold text-base text-white">ส่งสลิปใหม่ — ออเดอร์ #{orderId}</h2>
          <button
            onClick={onClose}
            disabled={uploading}
            className="p-1 hover:bg-white/20 text-white rounded-lg active:scale-90 transition-all duration-150 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="ปิด"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {rejectReason && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-3">
              <p className="text-xs font-bold text-red-700 mb-0.5">เหตุผลที่สลิปเดิมไม่ผ่าน</p>
              <p className="text-sm text-red-600 leading-snug">{rejectReason}</p>
            </div>
          )}

          <label className={`block ${uploading ? 'cursor-wait' : 'cursor-pointer'} group`}>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                // ⭐️ ล้างค่า input เพื่อให้เลือกไฟล์เดิมซ้ำได้ถ้าอัปรอบแรกพลาด
                e.target.value = '';
              }}
            />
            <div className="border-2 border-dashed border-brand-border rounded-2xl p-7 text-center bg-brand-bg group-hover:bg-brand-bg/70 transition-colors duration-150">
              <Upload size={22} className="text-brand mx-auto mb-2" />
              <p className="text-brand font-bold text-sm">
                {uploading ? 'กำลังอัปโหลด...' : '📎 แตะเพื่อเลือกรูปสลิปใหม่'}
              </p>
              <p className="text-gray-500 text-xs mt-1.5">รองรับไฟล์รูปภาพ ขนาดไม่เกิน 10 MB</p>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
