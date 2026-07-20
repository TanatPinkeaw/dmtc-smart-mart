import { X } from 'lucide-react';
import { formatBangkokTime } from '../../utils/timezone';

const STATUS_BADGE: Record<string, string> = {
  PENDING_VERIFY: 'bg-blue-100 text-blue-700',
  WAITING_CASH: 'bg-yellow-100 text-yellow-700',
  PREPARING: 'bg-orange-100 text-orange-700',
  READY: 'bg-green-100 text-green-700',
  COMPLETED: 'bg-gray-100 text-gray-500',
  CANCELLED: 'bg-red-100 text-red-600',
  SLIP_REJECTED: 'bg-red-100 text-red-700',
  REFUND_REQUESTED: 'bg-purple-100 text-purple-700',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING_VERIFY: '⏳ รอตรวจสลิป',
  WAITING_CASH: '💵 รอชำระเงิน',
  PREPARING: '📦 กำลังเตรียมของ',
  READY: '✅ พร้อมรับสินค้า!',
  COMPLETED: 'สำเร็จ',
  CANCELLED: 'ยกเลิกแล้ว',
  SLIP_REJECTED: '⚠️ สลิปผิด — ส่งสลิปใหม่',
  REFUND_REQUESTED: '💰 รอคืนเงิน',
};

interface MyOrdersModalProps {
  myOrders: any[];
  onClose: () => void;
  onSelectOrder: (order: any) => void;
}

export function MyOrdersModal({ myOrders, onClose, onSelectOrder }: MyOrdersModalProps) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-fade-in">
      {/* ⭐️ FIX: vh → dvh กันโดน URL bar มือถือตัด (เหมือน modal รายละเอียดออเดอร์) */}
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[80dvh] flex flex-col overflow-hidden">
        <div className="p-4 bg-brand-bg border-b border-brand-border flex justify-between items-center shrink-0">
          <h2 className="font-bold text-lg text-gray-800">ประวัติการสั่งจองของฉัน</h2>
          <button onClick={onClose} className="p-1 hover:bg-brand-border text-gray-500 rounded-lg"><X size={20} /></button>
        </div>
        <div className="p-4 md:p-6 overflow-y-auto flex-1 space-y-4 bg-gray-50">
          {myOrders.length === 0 ? (
            <p className="text-center text-gray-400 py-10">ยังไม่มีประวัติการสั่งจอง</p>
          ) : (
            myOrders.map(order => (
              <div key={order.id} className="bg-white p-4 rounded-2xl border border-brand-border shadow-md hover:shadow-lg hover:border-brand-mid transition-all cursor-pointer"
                onClick={() => onSelectOrder(order)}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-lg text-gray-800">ออเดอร์ #{order.id}</h3>
                    <p className="text-xs text-gray-500 mt-1">{formatBangkokTime(order.created_at)}</p>
                  </div>
                  <span className={`px-3 py-1.5 rounded-full text-[11px] md:text-xs font-bold whitespace-nowrap ${STATUS_BADGE[order.status] || 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABEL[order.status] || order.status}
                  </span>
                </div>

                <div className="text-sm text-gray-600 mb-3 space-y-1.5 bg-gray-50 p-2.5 rounded-lg">
                  {order.items?.map((item: any) => (
                    <div key={item.id} className="flex justify-between text-xs md:text-sm">
                      <span className="text-gray-700">{item.quantity}x {item.product_name}</span>
                      <span className="font-semibold text-gray-800">฿{Number(item.subtotal).toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                {Number(order.points_discount) > 0 && (
                  <p className="text-xs text-yellow-600 font-bold mb-2 bg-yellow-50 p-2 rounded-lg">🌟 ใช้แต้มลด {order.points_redeemed} (-฿{Number(order.points_discount).toFixed(2)})</p>
                )}

                <div className="flex justify-between items-center border-t border-gray-200 pt-3">
                  <span className="font-bold text-brand text-base">฿{Number(order.total_amount).toFixed(2)}</span>
                  <span className="text-xs text-gray-500">แตะเพื่อดูละเอียด →</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
