// 📄 components/dashboard/CloseShiftModal.tsx — popup ปิดกะการขาย (แคชเชียร์นับเงิน+ถ่ายรูปยืนยัน)
//    ทำอะไร: กรอกเงินสดจริงในลิ้นชัก + ถ่ายรูป แล้วส่งปิดกะ (ระบบเทียบกับยอดที่ควรมี = เงินขาด/เกิน)
import { Camera } from 'lucide-react';
import { inputCls } from '../ui/fieldStyles';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { FieldLabel } from '../ui/FieldLabel';

const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 1];

// สรุปยอดหลังปิดกะ — backend POST /shifts/close คืน summary มาแสดงใน popup
// (field บางตัว backend อาจไม่ส่งตอนกะยังไม่ปิดจริง เช่น ส่วนต่างเกิน 100 บาท)
export interface ShiftSummary {
  bill_count?: number;
  total_sales?: number;
  cash_sales?: number;
  qr_sales?: number;
  expected_cash?: number;
  actual_cash?: number;
  difference?: number;
}

interface CloseShiftModalProps {
  denomCounts: Record<number, number | ''>;
  onDenomChange: (denom: number, value: number | '') => void;
  discrepancyCategory: string;
  onDiscrepancyCategoryChange: (value: string) => void;
  closeNote: string;
  onCloseNoteChange: (value: string) => void;
  closePhotoPreview: string | null;
  onPhotoSelected: (file: File) => void;
  closeLoading: boolean;
  actualCash: number;
  shiftSummary: ShiftSummary | null;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  // ⭐️ เดิมชื่อ onLogout (ปิดกะเสร็จแล้วบังคับออกจากระบบ) — ตอนนี้แค่จบ flow กลับหน้าหลัก
  onDone: () => void;
}

export function CloseShiftModal({
  denomCounts, onDenomChange, discrepancyCategory, onDiscrepancyCategoryChange,
  closeNote, onCloseNoteChange, closePhotoPreview, onPhotoSelected,
  closeLoading, actualCash, shiftSummary, onSubmit, onClose, onDone,
}: CloseShiftModalProps) {
  return (
    <Modal onClose={onClose} widthClassName="md:max-w-md" title={!shiftSummary ? 'ปิดกะการขาย' : 'สรุปยอดการขาย'}>
        {!shiftSummary ? (
          <>
            <div className="p-5">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 text-xs text-blue-700">
                <p className="font-semibold mb-1">📋 วิธีนับเงินปิดกะ</p>
                <p>• เงินสด: นับแบงก์/เหรียญในลิ้นชักแล้วใส่ด้านล่าง</p>
                <p>• โอน/QR: ระบบนับจากบิลให้อัตโนมัติ ไม่ต้องนับเอง</p>
              </div>
              <form onSubmit={onSubmit} className="space-y-4">
                {/* Denom grid */}
                <div className="grid grid-cols-2 gap-2">
                  {DENOMINATIONS.map(d => (
                    <div key={d} className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-xl px-3 py-2">
                      <span className="text-xs font-semibold text-gray-600 w-10 shrink-0">฿{d}</span>
                      <input type="number" min="0" value={denomCounts[d] ?? ''} onChange={e => onDenomChange(d, e.target.value === '' ? '' : Number(e.target.value))} placeholder="0" className="w-full text-center bg-transparent text-sm outline-none" />
                    </div>
                  ))}
                </div>
                <div className="bg-brand-bg border border-brand-border rounded-xl p-3 text-center">
                  <p className="text-[10px] text-gray-400 mb-1">เงินสดที่นับได้จริง</p>
                  <p className="text-2xl font-bold text-brand">฿{actualCash.toLocaleString()}</p>
                </div>
                <div>
                  <FieldLabel size="xs">สาเหตุส่วนต่าง (ถ้ามี)</FieldLabel>
                  <select value={discrepancyCategory} onChange={e => onDiscrepancyCategoryChange(e.target.value)} className={`${inputCls} w-full`}>
                    <option value="">— ไม่ระบุ —</option>
                    <option value="SHORT_CHANGE">ทอนผิด</option>
                    <option value="FAKE_BILL">รับเงินปลอม</option>
                    <option value="FORGOT_RECEIPT">ลืมบันทึก</option>
                    <option value="CUSTOMER_RETURN">คืนสินค้า</option>
                    <option value="OTHER">อื่นๆ</option>
                  </select>
                </div>
                <div>
                  <FieldLabel size="xs">หมายเหตุเพิ่มเติม (ถ้าส่วนต่างเกิน ±20 บาท ระบบบังคับให้กรอก)</FieldLabel>
                  <input type="text" value={closeNote} onChange={e => onCloseNoteChange(e.target.value)} placeholder="เช่น ทอนผิดตอนเช้า" className={inputCls} />
                </div>
                {/* Photo */}
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1"><Camera size={12} /> ถ่ายรูปยืนยันสถานที่ <span className="text-red-400">*</span></p>
                  <label className="block cursor-pointer">
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onPhotoSelected(f); }} />
                    {closePhotoPreview
                      ? <img src={closePhotoPreview} alt="preview" className="w-full h-28 object-cover rounded-xl border border-brand-border" />
                      : <div className="w-full h-28 rounded-xl border-2 border-dashed border-brand-border flex flex-col items-center justify-center gap-2 text-brand-mid hover:bg-brand-bg transition-colors duration-150"><Camera size={24} /><span className="text-xs font-medium">แตะเพื่อถ่ายรูป</span></div>
                    }
                  </label>
                </div>
                <Button type="submit" variant="danger" disabled={closeLoading} className="w-full">
                  {closeLoading ? 'กำลังตรวจสอบ...' : 'ยืนยันการปิดกะ'}
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="p-6 text-center">
            <p className="text-xs text-gray-400 mb-4">ปิดกะสำเร็จ บันทึกเรียบร้อยแล้ว</p>
            <div className="bg-brand-bg border border-brand-border rounded-xl p-4 text-left space-y-2 mb-5 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">จำนวนบิล</span><span className="font-semibold">{Number(shiftSummary.bill_count || 0)} บิล</span></div>
              <div className="flex justify-between font-bold border-t border-brand-border pt-2"><span className="text-gray-800">ยอดรวมทั้งหมด</span><span className="text-brand">฿{Number(shiftSummary.total_sales || 0).toFixed(2)}</span></div>
              <div className="flex justify-between text-xs pl-2"><span className="text-gray-400">• เงินสด</span><span>฿{Number(shiftSummary.cash_sales || 0).toFixed(2)}</span></div>
              <div className="flex justify-between text-xs pl-2"><span className="text-gray-400">• โอน/QR</span><span>฿{Number(shiftSummary.qr_sales || 0).toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-brand-border pt-2"><span className="font-bold text-gray-800">เงินสดที่ควรมี</span><span className="font-bold text-brand">฿{Number(shiftSummary.expected_cash).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="font-bold text-gray-800">นับได้จริง</span><span className="font-bold">฿{Number(shiftSummary.actual_cash).toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-brand-border pt-2">
                <span className="font-bold text-gray-800">ส่วนต่าง</span>
                <span className={`font-bold ${Number(shiftSummary.difference) < 0 ? 'text-red-500' : Number(shiftSummary.difference) > 0 ? 'text-emerald-500' : 'text-gray-500'}`}>
                  {Number(shiftSummary.difference) > 0 ? '+' : ''}{Number(shiftSummary.difference).toFixed(2)} {Number(shiftSummary.difference) === 0 && '✅'}
                </span>
              </div>
            </div>
            <Button onClick={onDone} className="w-full">กลับหน้าหลัก</Button>
          </div>
        )}
    </Modal>
  );
}
