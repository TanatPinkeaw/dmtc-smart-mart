import { X } from 'lucide-react';
import { formatBangkokTime } from '../../utils/timezone';

interface DetailModalData {
  type: string;
  title: string;
}

interface DetailModalProps {
  detailModal: DetailModalData;
  lowStock: any[];
  voidSummary: any;
  shiftAnomalies: any[];
  openShifts: any[];
  pendingApprovalShifts: any[];
  onApproveShift: (shiftId: number) => void;
  onClose: () => void;
}

export function DetailModal({
  detailModal, lowStock, voidSummary, shiftAnomalies, openShifts, pendingApprovalShifts,
  onApproveShift, onClose,
}: DetailModalProps) {
  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80dvh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center px-4 py-3 border-b border-brand-border">
          <h3 className="text-sm font-semibold text-gray-900">{detailModal.title}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-brand-bg transition-colors duration-150" aria-label="ปิด"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto max-h-[60dvh] p-4 space-y-2">
          {detailModal.type === 'lowstock' && (lowStock.length === 0 ? <p className="text-center text-sm text-gray-400 py-8">ไม่มีสินค้าสต๊อกใกล้หมด</p> :
            lowStock.map((p: any) => (
              <div key={p.id} className="flex justify-between items-center p-3 bg-orange-50 border border-orange-100 rounded-xl">
                <div><p className="text-sm font-semibold text-gray-900">{p.name}</p><p className="text-xs text-gray-400">{p.barcode || '-'}</p></div>
                <span className={`font-bold text-lg ${p.stock === 0 ? 'text-red-600' : 'text-orange-500'}`}>{p.stock} <span className="text-xs font-normal text-gray-400">ชิ้น</span></span>
              </div>
            )))}
          {detailModal.type === 'void' && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-5 text-center">
              <p className="text-3xl font-bold text-red-600 mb-1">{voidSummary?.void_count || 0} บิล</p>
              <p className="text-sm text-gray-600">มูลค่ารวม <span className="font-bold text-red-500">฿{Number(voidSummary?.void_amount || 0).toLocaleString()}</span></p>
              <p className="text-xs text-gray-400 mt-2">ดูรายการได้ที่หน้า "ประวัติการขาย" ในตั้งค่า</p>
            </div>
          )}
          {detailModal.type === 'anomalies' && (shiftAnomalies.length === 0 ? <p className="text-center text-sm text-gray-400 py-8">ไม่มีกะที่ผิดปกติ</p> :
            shiftAnomalies.map((s: any) => (
              <div key={s.id} className="flex justify-between items-center p-3 bg-purple-50 border border-purple-100 rounded-xl">
                <div><p className="text-sm font-semibold text-gray-900">{s.cashier_name}</p><p className="text-xs text-gray-400">{formatBangkokTime(s.closed_at)}</p></div>
                <span className={`font-bold text-lg ${Number(s.difference) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{Number(s.difference) > 0 ? '+' : ''}{Number(s.difference).toFixed(2)}</span>
              </div>
            )))}
          {detailModal.type === 'openshifts' && (openShifts.length === 0 ? <p className="text-center text-sm text-gray-400 py-8">ไม่มีกะที่ค้างอยู่</p> :
            openShifts.map((s: any) => (
              <div key={s.id} className="flex justify-between items-center p-3 bg-blue-50 border border-blue-100 rounded-xl">
                <div><p className="text-sm font-semibold text-gray-900">{s.cashier_name}</p><p className="text-xs text-gray-400">เปิดกะ {formatBangkokTime(s.opened_at)}</p></div>
                <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded-lg">เปิดอยู่</span>
              </div>
            )))}
          {detailModal.type === 'pending_approval' && (pendingApprovalShifts.length === 0 ? <p className="text-center text-sm text-gray-400 py-8">ไม่มีกะรออนุมัติ</p> :
            pendingApprovalShifts.map((s: any) => (
              <div key={s.id} className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{s.cashier_name}</p>
                    <p className="text-xs text-gray-400">เปิดกะ {new Date(s.opened_at).toLocaleString('th-TH')}</p>
                    {s.note && <p className="text-xs text-gray-500 mt-1">หมายเหตุแคชเชียร์: {s.note}</p>}
                  </div>
                  <span className="font-bold text-lg text-amber-600 shrink-0">
                    {Number(s.difference) > 0 ? '+' : ''}{Number(s.difference).toFixed(2)}
                  </span>
                </div>
                <button
                  onClick={() => onApproveShift(s.id)}
                  className="w-full py-2 bg-brand hover:bg-brand-dark text-white text-sm font-semibold rounded-lg transition-all duration-150 active:scale-95"
                >
                  อนุมัติปิดกะ
                </button>
              </div>
            )))}
        </div>
      </div>
    </div>
  );
}
