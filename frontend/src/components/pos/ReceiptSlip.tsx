// 📄 components/pos/ReceiptSlip.tsx — หน้าตาใบเสร็จ (ตัวสลิปจริง) ใช้ทั้งใน ReceiptModal และหน้า /receipt
//    ทำอะไร: จัดวางข้อมูลบิล (สินค้า/ยอด/ทอน/ร้าน) เป็นสลิป — ใช้ forwardRef ให้แคปเป็นรูป/พิมพ์ได้
import { forwardRef } from 'react';
import { CloudOff } from 'lucide-react';
import { formatBangkokTime } from '../../utils/timezone';

interface ReceiptSlipProps {
  receiptData: any;
  storeInfo: any;
}

const Dash = () => <div className="border-t border-dashed border-gray-400 my-2" />;

export const ReceiptSlip = forwardRef<HTMLDivElement, ReceiptSlipProps>(
  ({ receiptData, storeInfo }, ref) => {
    const r = receiptData;
    const payLabel = r.payment_method === 'CASH' ? 'รับเงินสด' : r.payment_method === 'QR' ? 'ชำระผ่าน QR' : 'ชำระเงิน';

    return (
      <div
        ref={ref}
        id="receipt-print-area"
        className="bg-white w-[302px] mx-auto font-mono text-[13px] text-gray-800 px-4 py-5 leading-relaxed"
      >
        {r.offline && (
          <div className="flex items-center justify-center gap-1.5 bg-amber-50 text-amber-700 text-xs font-semibold py-1.5 rounded mb-3 print:hidden">
            <CloudOff size={13} /> บันทึกออฟไลน์
          </div>
        )}

        {/* Store header */}
        <div className="text-center mb-1">
          <p className="font-bold text-base tracking-wide">{storeInfo?.store_name || 'สหกรณ์วิทยาลัย'}</p>
          {storeInfo?.address && <p className="text-[11px] text-gray-500 mt-0.5">{storeInfo.address}</p>}
          {storeInfo?.tax_id && <p className="text-[11px] text-gray-500">เลขผู้เสียภาษี: {storeInfo.tax_id}</p>}
        </div>

        <Dash />

        {/* Bill info */}
        <div className="text-xs space-y-0.5">
          <Row left="เลขที่บิล" right={`#${r.sale_id}`} />
          <Row left="วันที่" right={formatBangkokTime(r.created_at)} />
          <Row left="แคชเชียร์" right={r.cashier_name} />
          {r.member_name && <Row left="สมาชิก" right={r.member_name} />}
        </div>

        <Dash />

        {/* Items header */}
        <div className="flex justify-between text-[11px] text-gray-500 font-semibold mb-1">
          <span>รายการ</span>
          <span>ราคา</span>
        </div>

        {/* Items */}
        <div className="space-y-1">
          {r.items.map((item: any, idx: number) => (
            <div key={idx} className="flex justify-between text-xs">
              <span className="flex-1 pr-2 truncate">{item.name} x{item.quantity}</span>
              <span className="whitespace-nowrap">฿{(item.price * item.quantity).toFixed(2)}</span>
            </div>
          ))}
        </div>

        <Dash />

        {/* Subtotals */}
        <div className="text-xs space-y-0.5">
          <Row left="ยอดรวม" right={`฿${Number(r.subtotal).toFixed(2)}`} />
          {r.discount_amount > 0 && (
            <Row left={`ส่วนลด${r.promo_name ? ` (${r.promo_name})` : ''}`} right={`-฿${Number(r.discount_amount).toFixed(2)}`} />
          )}
          {r.points_discount > 0 && (
            <Row left={`แลกแต้ม (${r.points_redeemed} แต้ม)`} right={`-฿${Number(r.points_discount).toFixed(2)}`} />
          )}
        </div>

        <Dash />

        {/* Grand total */}
        <div className="flex justify-between font-bold text-base">
          <span>ยอดสุทธิ</span>
          <span>฿{Number(r.total_amount).toFixed(2)}</span>
        </div>

        <div className="text-xs space-y-0.5 mt-1">
          <Row left={`${payLabel}:`} right={`฿${Number(r.amount_received).toFixed(2)}`} />
          <Row left="เงินทอน:" right={`฿${Number(r.change_amount).toFixed(2)}`} />
        </div>

        {r.earned_points > 0 && (
          <p className="text-center text-xs font-bold text-emerald-600 mt-3">+{r.earned_points} แต้มสะสม</p>
        )}

        <Dash />

        {/* Footer */}
        <p className="text-center text-[11px] text-gray-400 mt-1">
          {storeInfo?.receipt_footer || 'ขอบคุณที่ใช้บริการ'}
        </p>
      </div>
    );
  }
);

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex justify-between">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}
