import { Camera, X } from 'lucide-react';

const inputCls = "w-full px-3 py-2 bg-brand-bg border border-brand-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand transition-colors duration-150";

const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 1];

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
  shiftSummary: any;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  onLogout: () => void;
}

export function CloseShiftModal({
  denomCounts, onDenomChange, discrepancyCategory, onDiscrepancyCategoryChange,
  closeNote, onCloseNoteChange, closePhotoPreview, onPhotoSelected,
  closeLoading, actualCash, shiftSummary, onSubmit, onClose, onLogout,
}: CloseShiftModalProps) {
  return (
    <div className="fixed inset-0 z-[90] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-xl w-full md:max-w-md overflow-hidden">
        {!shiftSummary ? (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border bg-brand-bg">
              <h3 className="text-sm font-semibold text-gray-900">ปิดกะการขาย</h3>
              <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white transition-colors duration-150"><X size={18} /></button>
            </div>
            <div className="p-5 max-h-[75dvh] overflow-y-auto">
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
                  <label className="block text-xs font-medium text-gray-500 mb-1">สาเหตุส่วนต่าง (ถ้ามี)</label>
                  <select value={discrepancyCategory} onChange={e => onDiscrepancyCategoryChange(e.target.value)} className={inputCls}>
                    <option value="">— ไม่ระบุ —</option>
                    <option value="SHORT_CHANGE">ทอนผิด</option>
                    <option value="FAKE_BILL">รับเงินปลอม</option>
                    <option value="FORGOT_RECEIPT">ลืมบันทึก</option>
                    <option value="CUSTOMER_RETURN">คืนสินค้า</option>
                    <option value="OTHER">อื่นๆ</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">หมายเหตุเพิ่มเติม (ถ้าส่วนต่างเกิน ±20 บาท ระบบบังคับให้กรอก)</label>
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
                <button type="submit" disabled={closeLoading} className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-50">
                  {closeLoading ? 'กำลังตรวจสอบ...' : 'ยืนยันการปิดกะ'}
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="p-6 text-center">
            <h3 className="text-lg font-bold text-gray-900 mb-1">สรุปยอดการขาย</h3>
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
            <button onClick={onLogout} className="w-full py-3 bg-brand hover:bg-brand-dark text-white font-semibold rounded-xl transition-all duration-150 active:scale-95">ออกจากระบบ</button>
          </div>
        )}
      </div>
    </div>
  );
}
