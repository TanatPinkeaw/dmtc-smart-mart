import { CheckCircle, X, Printer } from 'lucide-react';
import { formatBangkokTime } from '../../utils/timezone';

interface ReceiptModalProps {
  receiptData: any;
  storeInfo: any;
  onClose: () => void;
}

export function ReceiptModal({ receiptData, storeInfo, onClose }: ReceiptModalProps) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 print:bg-white print:p-0 print:backdrop-blur-none">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden print:shadow-none print:rounded-none print:max-w-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border bg-brand-bg print:hidden">
          <h3 className="text-sm font-semibold text-brand flex items-center gap-2"><CheckCircle size={16} /> ทำรายการสำเร็จ</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors duration-150"><X size={16} /></button>
        </div>
        <div id="receipt-print-area" className="p-5 font-mono text-sm text-gray-800">
          <div className="text-center mb-3">
            <p className="font-bold text-base">{storeInfo?.store_name || 'สหกรณ์วิทยาลัย'}</p>
            {storeInfo?.address && <p className="text-xs text-gray-500">{storeInfo.address}</p>}
            {storeInfo?.tax_id && <p className="text-xs text-gray-500">เลขผู้เสียภาษี: {storeInfo.tax_id}</p>}
          </div>
          <div className="border-t border-dashed border-gray-300 my-2" />
          <div className="text-xs space-y-0.5">
            <div className="flex justify-between"><span>เลขที่บิล:</span><span>#{receiptData.sale_id}</span></div>
            <div className="flex justify-between"><span>วันที่:</span><span>{formatBangkokTime(receiptData.created_at)}</span></div>
            <div className="flex justify-between"><span>แคชเชียร์:</span><span>{receiptData.cashier_name}</span></div>
            {receiptData.member_name && <div className="flex justify-between"><span>สมาชิก:</span><span>{receiptData.member_name}</span></div>}
          </div>
          <div className="border-t border-dashed border-gray-300 my-2" />
          <div className="space-y-1">
            {receiptData.items.map((item: any, idx: number) => (
              <div key={idx} className="flex justify-between text-xs">
                <span className="flex-1 pr-2">{item.name} x{item.quantity}</span>
                <span>฿{(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-dashed border-gray-300 my-2" />
          <div className="text-xs space-y-0.5">
            <div className="flex justify-between"><span>ยอดรวม:</span><span>฿{Number(receiptData.subtotal).toFixed(2)}</span></div>
            {receiptData.discount_amount > 0 && <div className="flex justify-between"><span>ส่วนลด{receiptData.promo_name ? ` (${receiptData.promo_name})` : ''}:</span><span>-฿{Number(receiptData.discount_amount).toFixed(2)}</span></div>}
            {receiptData.points_discount > 0 && <div className="flex justify-between"><span>แลกแต้ม ({receiptData.points_redeemed} 🌟):</span><span>-฿{Number(receiptData.points_discount).toFixed(2)}</span></div>}
          </div>
          <div className="border-t border-dashed border-gray-300 my-2" />
          <div className="flex justify-between font-bold text-base"><span>ยอดสุทธิ:</span><span>฿{Number(receiptData.total_amount).toFixed(2)}</span></div>
          <div className="flex justify-between text-xs mt-1"><span>{receiptData.payment_method === 'CASH' ? 'รับเงินสด:' : 'ชำระผ่าน QR:'}</span><span>฿{Number(receiptData.amount_received).toFixed(2)}</span></div>
          <div className="flex justify-between text-xs"><span>เงินทอน:</span><span>฿{Number(receiptData.change_amount).toFixed(2)}</span></div>
          {receiptData.earn_points > 0 && <p className="text-center text-xs font-bold text-emerald-600 mt-2">+{receiptData.earn_points} 🌟 แต้มสะสม</p>}
          <p className="text-center text-xs text-gray-400 mt-3">ขอบคุณที่ใช้บริการ</p>
        </div>
        <div className="flex gap-2 p-4 border-t border-brand-border print:hidden">
          <button onClick={() => window.print()} className="flex-1 py-2.5 bg-brand-bg border border-brand-mid text-brand font-semibold text-sm rounded-xl flex items-center justify-center gap-2 hover:bg-brand hover:text-white transition-all duration-150 active:scale-95">
            <Printer size={16} /> พิมพ์ใบเสร็จ
          </button>
          <button onClick={onClose} className="flex-1 py-2.5 bg-brand hover:bg-brand-dark text-white font-semibold text-sm rounded-xl transition-all duration-150 active:scale-95">ปิด</button>
        </div>
      </div>
    </div>
  );
}
