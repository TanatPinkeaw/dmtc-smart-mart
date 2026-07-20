import { ShoppingCart, Plus, Minus, X, CheckCircle, UserPlus, Gift, ChevronUp, ChevronDown } from 'lucide-react';
import generatePayload from 'promptpay-qr';
import QRCode from 'react-qr-code';
import { EmptyState } from '../ui/EmptyState';

interface Product { id: number; barcode: string; name: string; price: string | number; image_url: string; category_id: number | null; stock?: number; }
interface CartItem extends Product { quantity: number; }

interface CartPanelProps {
  isCartOpen: boolean;
  onCloseCart: () => void;
  payOpen: boolean;
  onTogglePay: () => void;
  cart: CartItem[];
  products: Product[];
  onUpdateQuantity: (id: number, delta: number) => void;
  currentMember: any;
  onClearMember: () => void;
  searchMemberQuery: string;
  onSearchMemberQueryChange: (value: string) => void;
  memberLoading: boolean;
  onSearchMember: (e?: React.FormEvent) => void;
  onOpenRegisterModal: () => void;
  promotions: any[];
  selectedPromoId: number | '';
  onSelectPromoId: (id: number | '') => void;
  appliedPromo: { id: number; name: string; discount_amount: number } | null;
  promoLoading: boolean;
  onApplyPromo: () => void;
  onRemovePromo: () => void;
  maxRedeemable: number;
  redeemPoints: number | '';
  onRedeemPointsChange: (value: number | '') => void;
  grandTotal: number;
  pointsDiscount: number;
  finalTotal: number;
  paymentMethod: 'CASH' | 'QR';
  onSetPaymentMethod: (method: 'CASH' | 'QR') => void;
  amountReceived: number | '';
  onAmountReceivedChange: (value: number | '') => void;
  promptpayId: string;
  onCheckout: () => void;
  loading: boolean;
  checkoutDisabled: boolean;
}

export function CartPanel({
  isCartOpen, onCloseCart, payOpen, onTogglePay, cart, products, onUpdateQuantity,
  currentMember, onClearMember, searchMemberQuery, onSearchMemberQueryChange, memberLoading, onSearchMember, onOpenRegisterModal,
  promotions, selectedPromoId, onSelectPromoId, appliedPromo, promoLoading, onApplyPromo, onRemovePromo,
  maxRedeemable, redeemPoints, onRedeemPointsChange,
  grandTotal, pointsDiscount, finalTotal,
  paymentMethod, onSetPaymentMethod, amountReceived, onAmountReceivedChange, promptpayId,
  onCheckout, loading, checkoutDisabled,
}: CartPanelProps) {
  return (
    <div className={`${isCartOpen ? 'fixed inset-0 z-[60] flex' : 'hidden'} md:flex md:relative md:w-2/5 flex-col bg-white border-l border-brand-border`}>
      {/* Cart header */}
      <div className="bg-brand px-4 py-3 flex items-center justify-between shrink-0 shadow-sm">
        <div className="flex items-center gap-2">
          <ShoppingCart size={18} className="text-white" />
          <h2 className="text-base font-semibold text-white">ตะกร้าสินค้า</h2>
          {cart.length > 0 && <span className="bg-white text-brand text-xs font-bold px-1.5 py-0.5 rounded-full">{cart.reduce((a, c) => a + c.quantity, 0)}</span>}
        </div>
        <button onClick={onCloseCart} className="md:hidden p-1.5 bg-white/20 rounded-lg text-white hover:bg-white/30 active:scale-90 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"><X size={18} /></button>
      </div>

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {cart.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState icon={<ShoppingCart size={36} />} title="ยังไม่มีสินค้าในตะกร้า" />
          </div>
        ) : cart.map(item => {
          // ⭐️ Sprint 2 — B7: Get current product stock to show warnings
          const product = products.find(p => p.id === item.id);
          const isStockExceeded = product && item.quantity > (product.stock ?? 0);
          return (
          <div key={item.id} className={`flex justify-between items-center rounded-xl px-3 py-2 border transition-all duration-150 hover:shadow-sm ${
            isStockExceeded
              ? 'bg-yellow-50 border-yellow-300'
              : 'bg-brand-bg border-brand-border'
          }`}>
            <div className="flex-1 min-w-0 pr-2">
              <p className="text-xs font-semibold text-gray-900 truncate">{item.name}</p>
              <p className="text-xs text-brand font-bold">฿{Number(item.price).toFixed(2)}</p>
              {/* ⭐️ Sprint 2 — B7: Show stock warning */}
              {isStockExceeded && (
                <p className="text-xs text-yellow-700 font-semibold mt-1">
                  ⚠️ มีเฉพาะ {product?.stock} ชิ้น
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 bg-white border border-brand-border rounded-lg p-1 shrink-0">
              <button onClick={() => onUpdateQuantity(item.id, -1)} className="w-6 h-6 flex items-center justify-center hover:bg-brand-bg rounded text-gray-600 hover:text-red-500 active:scale-90 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"><Minus size={11} /></button>
              <span className="text-xs font-bold text-gray-900 w-5 text-center">{item.quantity}</span>
              <button onClick={() => onUpdateQuantity(item.id, 1)} className="w-6 h-6 flex items-center justify-center hover:bg-brand-bg rounded text-gray-600 hover:text-emerald-500 active:scale-90 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"><Plus size={11} /></button>
            </div>
            <p className="text-xs font-bold text-gray-900 w-14 text-right shrink-0">฿{(Number(item.price) * item.quantity).toFixed(2)}</p>
          </div>
        );
        })}
      </div>

      {/* Checkout panel */}
      {/* ⭐️ FIX: เดิม pb-20 กันชนกับ bottom nav แต่ตะกร้ามือถือเป็น fixed inset-0 z-[60] คลุมเต็มจอ
          ทับ nav (z-50) อยู่แล้ว 100% เลยไม่มี nav ให้ต้องกันเว้นระยะ — เหลือ pb-20 ไว้กลายเป็นช่องว่างเปล่าๆ
          ใต้ปุ่ม "ชำระเงิน" เอาออกให้เนื้อหาทั้งแผงขยับลงมาชิดขอบล่างจริง */}
      <div className="border-t border-brand-border bg-white shrink-0">
        {/* ⭐️ มือถือ: แถบสรุป + ปุ่มยุบ/ขยายแผงชำระเงิน — จอสั้นจะได้เห็นรายการสินค้าเต็มๆ แล้วค่อยกดขยายตอนจะจ่าย */}
        <div className="md:hidden flex items-center justify-between gap-2 px-3 py-2 border-b border-brand-border">
          <div className="text-sm"><span className="text-gray-500">ยอดสุทธิ </span><span className="font-bold text-brand">฿{finalTotal.toFixed(2)}</span></div>
          <button onClick={onTogglePay} className="flex items-center gap-1 text-xs font-bold text-brand bg-brand-bg border border-brand-border px-3 py-1.5 rounded-full active:scale-95 transition-all duration-150">
            {payOpen ? <><ChevronDown size={14} /> ย่อลง</> : <><ChevronUp size={14} /> ชำระเงิน</>}
          </button>
        </div>
        <div className={`${payOpen ? 'block' : 'hidden'} md:block p-3 pt-2 md:pt-3 space-y-3 overflow-y-auto max-h-[72vh] md:max-h-none md:overflow-visible`}>

        {/* Member search — ⭐️ FIX: rounded-xl → rounded-lg ให้ตรงกับสไตล์หน้าจองทั้งแผง */}
        <div className="bg-brand-bg border border-brand-border rounded-lg p-3">
          {!currentMember ? (
            // ⭐️ FIX: ย้ายปุ่ม "สมัครสมาชิกใหม่" จากปุ่มเขียวแยกด้านนอก ไปเป็นไอคอนเล็กฝังในช่องค้นหาแทน
            // ลดความรก ยังกดสมัครสมาชิกได้เหมือนเดิม (ระบบมีจุดสมัครจุดเดียว ไม่ได้ตัดฟีเจอร์)
            <form onSubmit={onSearchMember} className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <input type="text" placeholder="เบอร์โทร หรือ รหัสนักศึกษา..." value={searchMemberQuery} onChange={e => onSearchMemberQueryChange(e.target.value)} className="w-full pl-3 pr-9 py-2 bg-white border border-brand-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand transition-colors duration-150" />
                <button type="button" onClick={onOpenRegisterModal} title="สมัครสมาชิกใหม่" className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-emerald-500 hover:bg-emerald-50 active:scale-90 rounded-lg transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
                  <UserPlus size={15} />
                </button>
              </div>
              <button type="submit" disabled={memberLoading} className="px-3 py-2 bg-brand hover:bg-brand-dark text-white text-xs font-semibold rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1">{memberLoading ? '...' : 'ค้นหา'}</button>
            </form>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-gray-400">{currentMember.student_id}</p>
                <p className="text-sm font-semibold text-gray-900">{currentMember.full_name}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">{currentMember.points} 🌟</span>
                <button onClick={onClearMember} className="p-1 text-red-400 hover:bg-red-50 rounded-lg transition-colors duration-150"><X size={14} /></button>
              </div>
            </div>
          )}
        </div>

        {/* Promo */}
        {!appliedPromo ? (
          <div className="flex gap-2">
            {/* ⭐️ FIX: ไม่ใช้ inputCls ตรงๆ เพราะมี rounded-xl ฝังอยู่ ต่อ class ซ้อนแบบเดิมไม่การันตี override
                (ลำดับ class ใน CSS ไม่ตรงกับลำดับใน className) เขียน class ใหม่ทั้งชุดแทนให้ rounded-lg ชัวร์ */}
            <select value={selectedPromoId} onChange={e => onSelectPromoId(e.target.value ? Number(e.target.value) : '')} className="flex-1 min-w-0 px-3 py-2.5 bg-brand-bg border border-brand-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand transition-colors duration-150">
              <option value="">-- โปรโมชั่น (ถ้ามี) --</option>
              {promotions.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.discount_type === 'PERCENT' ? `ลด ${p.discount_value}%` : `ลด ฿${p.discount_value}`})</option>)}
            </select>
            <button onClick={onApplyPromo} disabled={!selectedPromoId || promoLoading} className="px-3 py-2 bg-brand hover:bg-brand-dark text-white text-xs font-semibold rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1">{promoLoading ? '...' : 'ใช้โค้ด'}</button>
          </div>
        ) : (
          <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <p className="text-xs font-semibold text-emerald-700">🏷️ {appliedPromo.name} (-฿{appliedPromo.discount_amount.toFixed(2)})</p>
            <button onClick={onRemovePromo} className="p-1 text-red-400 hover:bg-red-50 rounded-lg transition-colors duration-150"><X size={14} /></button>
          </div>
        )}

        {/* Redeem points */}
        {currentMember && currentMember.points > 0 && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <Gift size={16} className="text-amber-500 shrink-0" />
            <span className="text-xs text-amber-700 shrink-0">แต้ม ({currentMember.points} 🌟):</span>
            <input type="number" min={0} max={maxRedeemable} value={redeemPoints} onChange={e => onRedeemPointsChange(e.target.value ? Math.max(0, Math.min(Number(e.target.value), maxRedeemable)) : '')} placeholder="0" className="flex-1 min-w-0 px-2 py-1 bg-white border border-amber-200 rounded-lg text-xs font-bold text-right focus:outline-none focus:ring-2 focus:ring-amber-400" />
            <button onClick={() => onRedeemPointsChange(maxRedeemable)} className="text-[10px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-2 py-1 rounded-lg transition-colors duration-150 shrink-0">สูงสุด</button>
          </div>
        )}

        {/* Totals */}
        <div className="space-y-1 px-1">
          <div className="flex justify-between text-xs text-gray-500"><span>ยอดรวม</span><span>฿{grandTotal.toFixed(2)}</span></div>
          {appliedPromo && <div className="flex justify-between text-xs text-emerald-600 font-semibold"><span>ส่วนลดโปรโมชั่น</span><span>-฿{appliedPromo.discount_amount.toFixed(2)}</span></div>}
          {pointsDiscount > 0 && <div className="flex justify-between text-xs text-amber-600 font-semibold"><span>แลกแต้ม</span><span>-฿{pointsDiscount.toFixed(2)}</span></div>}
          <div className="flex justify-between text-base font-bold text-gray-900 border-t border-brand-border pt-1.5 mt-1.5">
            <span>ยอดสุทธิ</span><span className="text-brand">฿{finalTotal.toFixed(2)}</span>
          </div>
        </div>

        {/* ⭐️ FIX: ปุ่มเลือกวิธีจ่ายเงิน — ปรับให้ตรงกับสไตล์หน้าจอง (rounded-lg แทน rounded-xl, สีตัวอักษร
            ตอนเลือกเงินสดเป็น #FF467E ให้เหมือนกันทั้ง 2 หน้า) */}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => { onSetPaymentMethod('CASH'); onAmountReceivedChange(''); }} className={`py-2 rounded-lg text-xs font-semibold border-2 transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${paymentMethod === 'CASH' ? 'border-brand bg-brand-bg text-brand-dark' : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}>💵 เงินสด</button>
          <button onClick={() => { onSetPaymentMethod('QR'); onAmountReceivedChange(finalTotal); }} className={`py-2 rounded-lg text-xs font-semibold border-2 transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${paymentMethod === 'QR' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}>📱 สแกนจ่าย</button>
        </div>

        {/* Cash input or QR */}
        {paymentMethod === 'CASH' ? (
          <div>
            {/* ⭐️ FIX: เดิม readOnly + inputMode="none" บังคับใช้คีย์แพดในแอปเท่านั้น (กิน 4 แถวจอ ทำให้
                รายการสินค้าด้านบนเหลือพื้นที่น้อยมาก) — เปลี่ยนเป็นพิมพ์ตรงด้วยคีย์บอร์ดตัวเลขของมือถือแทน
                ปุ่มลัด (10/20/50/100/500/พอดี) — "พอดี" = ใส่ยอดสุทธิเป๊ะ (จ่ายพอดี ไม่ปัดขึ้น) */}
            <input type="number" inputMode="decimal" value={amountReceived} onChange={e => onAmountReceivedChange(e.target.value ? Number(e.target.value) : '')} placeholder="0.00"
              className="w-full text-right text-xl font-bold px-4 py-3 bg-brand-bg border border-brand-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand transition-colors duration-150" />
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {[10, 20, 50, 100, 500].map(v => (
                <button key={v} onClick={() => onAmountReceivedChange(v)} className="flex-1 min-w-[40px] py-1.5 bg-brand-bg border border-brand-border text-brand font-semibold rounded-lg text-xs hover:bg-brand hover:text-white active:scale-95 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1">฿{v}</button>
              ))}
              <button onClick={() => onAmountReceivedChange(finalTotal)} className="flex-1 min-w-[40px] py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold rounded-lg text-xs hover:bg-emerald-500 hover:text-white active:scale-95 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-1">พอดี</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-xs font-semibold text-blue-800 mb-2">สแกนเพื่อชำระเงิน (PromptPay)</p>
            <div className="bg-white p-2 rounded-lg"><QRCode value={generatePayload(promptpayId, { amount: finalTotal })} size={130} /></div>
            <p className="text-[10px] text-blue-500 mt-2">รบกวนลูกค้าโชว์สลิปหลังโอนสำเร็จ</p>
          </div>
        )}

        {/* Checkout button */}
        {/* ⭐️ F5 — เพิ่ม !!checkoutValidationError เข้าเงื่อนไข disabled (เช่น payment_method ผิด/items ว่าง/quantity ผิดรูปแบบ) */}
        <button onClick={onCheckout} disabled={checkoutDisabled}
          className={`w-full py-3.5 rounded-xl text-sm font-bold text-white transition-all duration-150 active:scale-95 flex items-center justify-center gap-2 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${checkoutDisabled ? 'bg-gray-300 cursor-not-allowed shadow-none' : paymentMethod === 'QR' ? 'bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-500' : 'bg-brand hover:bg-brand-dark focus-visible:ring-brand'}`}>
          {loading ? 'กำลังประมวลผล...' : <><CheckCircle size={18} /> {paymentMethod === 'QR' ? 'ยืนยันตรวจสอบสลิปแล้ว' : 'ชำระเงิน'}</>}
        </button>
        </div>
      </div>
    </div>
  );
}
