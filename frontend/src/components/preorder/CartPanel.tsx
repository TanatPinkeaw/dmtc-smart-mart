// 📄 components/preorder/CartPanel.tsx — แผงตะกร้า+ชำระเงินของหน้าสั่งจอง (สมาชิกสั่งเอง)
//    ทำอะไร: รายการตะกร้า, กรอกเบอร์สะสมแต้ม, แลกแต้ม, เลือกเงินสด/QR (PromptPay) + แนบสลิป, สรุปยอด, ยืนยันจอง —
//    หน้าตาล้วน logic อยู่ pages/PreOrder.tsx ; ต่างจาก POS ตรงต้องแนบสลิปตอนจ่าย QR
import { ShoppingCart, Plus, Minus, X, CheckCircle, Upload, ChevronUp, ChevronDown } from 'lucide-react';
import { FieldLabel } from '../ui/FieldLabel';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/SegmentedControl';
import generatePayload from 'promptpay-qr';
import QRCode from 'react-qr-code';

interface Product { id: number; name: string; price: string | number; image_url: string; stock: number; category_id: number | null; }
interface CartItem extends Product { quantity: number; }

interface CartPanelProps {
  isCartOpen: boolean;
  onCloseCart: () => void;
  payOpen: boolean;
  onTogglePay: () => void;
  cart: CartItem[];
  onUpdateQuantity: (id: number, delta: number) => void;
  grandTotal: number;
  pointsDiscount: number; // ⭐️ มูลค่าส่วนลด หน่วยบาท (= redeemPointsUsed * redeemRate)
  redeemPointsUsed: number; // ⭐️ จำนวนแต้มที่แลกจริง หน่วยแต้ม — คนละหน่วยกับ pointsDiscount เสมอถ้า redeemRate ≠ 1
  finalTotal: number;
  phoneNumber: string;
  onPhoneNumberChange: (value: string) => void;
  phoneVerified: { member_name?: string } | null;
  verifying: boolean;
  onVerifyPhone: () => void;
  myPoints: number;
  maxRedeemable: number;
  redeemPoints: number | '';
  onRedeemPointsChange: (value: number | '') => void;
  // ⭐️ staff สั่งจองได้แต่ไม่มีสิทธิ์แต้มสมาชิก (สะสม/แลก) — ซ่อนส่วนแต้ม + โชว์หมายเหตุ
  pointsEnabled: boolean;
  // ⭐️ staff ที่มีบัญชีสมาชิกแยก → สลับไปล็อกอินด้วยบัญชีสมาชิกเพื่อใช้สิทธิ์แต้ม (optional)
  onSwitchToMember?: () => void;
  paymentMethod: 'CASH' | 'QR';
  onSetPaymentMethod: (method: 'CASH' | 'QR') => void;
  promptpayId: string;
  slipFile: File | null;
  slipPreview: string | null;
  slipDimensions: { width: number; height: number } | null;
  slipUploadProgress: number;
  slipProcessing: boolean;
  onSlipChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearSlip: () => void;
  onCheckout: () => void;
  loading: boolean;
}

export function CartPanel({
  isCartOpen, onCloseCart, payOpen, onTogglePay, cart, onUpdateQuantity,
  grandTotal, pointsDiscount, redeemPointsUsed, finalTotal,
  phoneNumber, onPhoneNumberChange, phoneVerified, verifying, onVerifyPhone,
  myPoints, maxRedeemable, redeemPoints, onRedeemPointsChange, pointsEnabled, onSwitchToMember,
  paymentMethod, onSetPaymentMethod, promptpayId,
  slipFile, slipPreview, slipDimensions, slipUploadProgress, slipProcessing, onSlipChange, onClearSlip,
  onCheckout, loading,
}: CartPanelProps) {
  const qrNotReady = paymentMethod === 'QR' && (slipProcessing || !slipFile || !slipDimensions);

  return (
    <div className={`${isCartOpen ? 'fixed inset-0 z-[60] flex animate-fade-in' : 'hidden'} md:flex md:relative md:w-1/3 flex-col bg-white border-l border-brand-border shadow-xl`}>
      <div className="p-4 bg-gradient-to-r from-brand to-brand-dark text-white flex justify-between items-center shadow-sm">
        <h2 className="text-lg font-semibold font-display flex items-center gap-2"><ShoppingCart size={20} /> ตะกร้าของฉัน</h2>
        <button onClick={onCloseCart} className="md:hidden p-1.5 bg-white/20 rounded-lg text-white hover:bg-white/30 active:scale-90 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="ปิด"><X size={20} /></button>
      </div>

      {/* รายการในตะกร้า */}
      <div className="flex-1 overflow-y-auto p-4 bg-brand-bg space-y-3">
        {cart.length === 0 ? (
          <EmptyState compact icon={<ShoppingCart size={22} />} title="ยังไม่มีสินค้า" />
        ) : (
          cart.map((item) => (
            <div key={item.id} className="bg-white p-3 rounded-2xl shadow-sm border border-l-4 border-brand-border border-l-brand flex flex-col gap-2">
              <div className="flex justify-between">
                <p className="font-bold text-gray-800 text-sm line-clamp-1">{item.name}</p>
                <p className="font-bold text-brand">฿{(Number(item.price) * item.quantity).toFixed(2)}</p>
              </div>
              <div className="flex justify-between items-center">
                <p className="text-xs text-gray-500">฿{Number(item.price).toFixed(2)} / ชิ้น</p>
                <div className="flex items-center gap-2 bg-brand-bg rounded-lg p-1">
                  <button onClick={() => onUpdateQuantity(item.id, -1)} className="p-1 hover:bg-white rounded text-gray-600"><Minus size={14} /></button>
                  <span className="w-6 text-center font-bold text-sm">{item.quantity}</span>
                  <button onClick={() => onUpdateQuantity(item.id, 1)} className="p-1 hover:bg-white rounded text-gray-600"><Plus size={14} /></button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ส่วนการชำระเงิน */}
      <div className="bg-brand-bg border-t border-brand-border rounded-t-3xl shadow-[0_-4px_16px_rgba(241,43,107,0.10)] shrink-0">
        {/* ⭐️ มือถือ: แถบสรุป + ปุ่มยุบ/ขยายแผงชำระเงิน — จอสั้นจะได้เห็นรายการสินค้าเต็มๆ แล้วค่อยกดขยายตอนจะจ่าย */}
        <div className="md:hidden flex items-center justify-between gap-2 px-4 py-2 border-b border-brand-border">
          <div className="text-sm"><span className="text-gray-500">ยอดสุทธิ </span><span className="font-display font-bold text-brand tabular-nums">฿{finalTotal.toFixed(2)}</span></div>
          <button onClick={onTogglePay} className="flex items-center gap-1 text-xs font-bold text-brand bg-brand-bg border border-brand-border px-3 py-1.5 rounded-full active:scale-95 transition-all duration-150">
            {payOpen ? <><ChevronDown size={14} /> ย่อลง</> : <><ChevronUp size={14} /> ชำระเงิน</>}
          </button>
        </div>
        <div className={`${payOpen ? 'block' : 'hidden'} md:block p-5 pt-3 md:pt-5 overflow-y-auto max-h-[72vh] md:max-h-none md:overflow-visible`}>
        <div className="mb-4 bg-white border border-brand-border rounded-lg shadow-sm p-3 space-y-1">
          <div className="flex justify-between text-sm text-gray-500">
            <span>ยอดรวมสินค้า:</span> <span>฿{grandTotal.toFixed(2)}</span>
          </div>
          {pointsDiscount > 0 && (
            <div className="flex justify-between text-sm text-yellow-600 font-bold">
              {/* 🐛 FIX — เดิมโชว์ pointsDiscount (บาท) คู่กับ 🌟 (สื่อว่าเป็นแต้ม) ผิดหน่วยกันถ้า
                  redeemRate ≠ 1 ต้องแยก: จำนวนแต้ม (redeemPointsUsed) คู่ดาว, มูลค่าลด (pointsDiscount) คู่ ฿ */}
              <span>แลกแต้ม ({redeemPointsUsed} 🌟):</span> <span>-฿{pointsDiscount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-xl font-bold text-gray-800 pt-1 border-t border-brand-border">
            <span>ยอดสุทธิ:</span> <span className="text-brand">฿{finalTotal.toFixed(2)}</span>
          </div>
        </div>

        <div className="space-y-4 mb-4">
          {/* ⭐️ staff: ไม่มีสิทธิ์แต้ม — ซ่อนช่องสะสม/แลกทั้งหมด แล้วโชว์หมายเหตุแทน (backend กันอีกชั้น)
              + ปุ่มสลับไปบัญชีสมาชิก (ถ้ามีบัญชี MEMBER แยก จะได้ใช้สิทธิ์แต้ม) */}
          {!pointsEnabled && (
            <div className="bg-gray-50 border border-brand-border rounded-lg p-3 text-center space-y-2">
              <p className="text-xs font-bold text-gray-500">💼 บัญชีพนักงาน: สั่งจองได้ตามปกติ แต่ไม่มีสิทธิ์สะสม/แลกแต้มสมาชิก</p>
              {onSwitchToMember && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={onSwitchToMember}
                >
                  สลับไปใช้บัญชีสมาชิก (ใช้สิทธิ์แต้ม)
                </Button>
              )}
            </div>
          )}

          {/* ช่องกรอกเบอร์สะสมแต้ม + ปุ่มตรวจสอบ (เฉพาะ MEMBER) */}
          {pointsEnabled && (
            <div>
              <FieldLabel size="xs">เบอร์โทรศัพท์ (เพื่อสะสมแต้ม)</FieldLabel>
              <div className="flex gap-2">
                <input type="tel" placeholder="ถ้าไม่ใส่จะไม่ได้รับแต้ม" value={phoneNumber} onChange={e => onPhoneNumberChange(e.target.value)} className="flex-1 p-2.5 bg-white border border-brand-border rounded-lg text-sm shadow-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand" />
                <button type="button" onClick={onVerifyPhone} disabled={verifying} className="shrink-0 bg-white text-brand-dark border border-brand-border px-3 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-brand-bg active:scale-95 transition-all duration-150 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  {verifying ? '...' : 'ตรวจสอบ'}
                </button>
              </div>
              {/* 🐛 FIX (Sprint 0 — A2): /users/verify-phone ไม่คืนแต้มแล้ว (กันข้อมูลรั่ว) แสดงแค่ชื่อยืนยัน */}
              {phoneVerified && (
                <p className="text-xs text-green-600 font-bold mt-1">✓ ยืนยันตัวตน: {phoneVerified.member_name}</p>
              )}
            </div>
          )}

          {/* ⭐️ แลกแต้มเป็นส่วนลด (แสดงเฉพาะตอนมีแต้มอยู่จริง + เป็น MEMBER) */}
          {pointsEnabled && myPoints > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <span className="block text-xs font-bold text-yellow-700 mb-2">แลกแต้มเป็นส่วนลด (มี {myPoints} 🌟)</span>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0} max={maxRedeemable} value={redeemPoints}
                  onChange={e => onRedeemPointsChange(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="0"
                  className="w-24 p-2 border border-yellow-300 rounded-lg text-sm text-center outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500"
                />
                <button type="button" onClick={() => onRedeemPointsChange(maxRedeemable)} className="text-xs font-bold text-yellow-700 bg-yellow-100 px-3 py-2 rounded-lg hover:bg-yellow-200 transition">
                  ใช้สูงสุด ({maxRedeemable})
                </button>
              </div>
            </div>
          )}

          {/* เลือกวิธีจ่ายเงิน — box variant ของ SegmentedControl (CASH = แบรนด์ / QR = น้ำเงิน) */}
          <SegmentedControl
            variant="box"
            ariaLabel="วิธีจ่ายเงิน"
            value={paymentMethod}
            onChange={(v) => onSetPaymentMethod(v)}
            options={[
              { value: 'CASH', label: '💵 จ่ายเงินสดหน้าร้าน', className: 'font-bold text-xs sm:text-sm leading-tight' },
              { value: 'QR', label: '📱 สแกนจ่าย', className: 'font-bold text-xs sm:text-sm leading-tight', selectedClassName: 'border-blue-600 bg-blue-50 text-blue-700', focusRingClassName: 'focus-visible:ring-blue-500 focus-visible:ring-offset-1' },
            ]}
          />

          {/* โซนอัปโหลดสลิป (แสดงเฉพาะตอนสแกนจ่าย) — ⭐️ Sprint 2 — B9: Enhanced with validation */}
          {paymentMethod === 'QR' && (
            // ⭐️ FIX: ขยาย QR ให้สแกนง่ายขึ้น (96→140) และลดขนาดช่องอัปโหลดสลิปลงอีก (ตัดคำอธิบายรอง,
            // ไอคอน/padding เล็กลง, เหลือแค่ปุ่มเดียวไม่กินพื้นที่) ให้สมดุลกัน
            <div className="bg-blue-50 p-3 rounded-xl border border-blue-200 text-center animate-fade-in">
              <div className="bg-white p-2 rounded-lg shadow-sm inline-block mb-1.5">
                <QRCode value={generatePayload(promptpayId, { amount: finalTotal })} size={140} />
              </div>
              <p className="text-xs text-blue-800 font-bold mb-2">สแกนจ่าย {finalTotal.toFixed(2)} บาท</p>

              {/* Upload zone */}
              <div className="border-2 border-dashed border-blue-300 rounded-lg p-1.5">
                <label className="cursor-pointer flex items-center justify-center gap-1.5 hover:bg-blue-100 transition py-1">
                  <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={onSlipChange} />
                  {slipPreview ? (
                    <img src={slipPreview} alt="Slip" className="max-h-16 object-contain rounded" />
                  ) : (
                    <>
                      <Upload className="text-blue-600" size={14} />
                      <span className="text-xs font-bold text-blue-600">แตะเพื่ออัปโหลดสลิป</span>
                    </>
                  )}
                </label>
              </div>

              {/* File info and progress — ⭐️ Sprint 2 — B9 */}
              {slipFile && (
                <div className="bg-white p-3 rounded-lg border border-blue-200 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-gray-700">{slipFile.name}</span>
                    <button onClick={onClearSlip} className="text-red-500 hover:bg-red-50 p-1 rounded">
                      <X size={16} />
                    </button>
                  </div>
                  {slipDimensions && (
                    <p className="text-xs text-green-600 font-bold">✓ ขนาดรูปถูกต้อง: {slipDimensions.width}×{slipDimensions.height}</p>
                  )}
                  {slipUploadProgress > 0 && slipUploadProgress < 100 && (
                    <div className="w-full bg-gray-200 rounded h-2">
                      <div className="bg-blue-600 h-full rounded transition-all" style={{ width: `${slipUploadProgress}%` }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ⭐️ FIX: ปุ่มยืนยัน — ปรับให้ตรงกับปุ่ม "ชำระเงิน" หน้า POS: ขนาด/ฟอนต์เล็กลง (py-3.5, text-sm,
            ไอคอน 18px), เปลี่ยนเป็นสีฟ้าตอนเลือกสแกนจ่าย (เหมือน POS ที่สลับสีตาม paymentMethod) */}
        {/* ⭐️ QR: ล็อกปุ่มจนกว่าสลิปจะแนบ+ตรวจเสร็จ กันกดยืนยันก่อนสลิปพร้อม (รูปสลิปจะไม่ขึ้น) */}
        {/* ⭐️ ปุ่มยืนยันสีตามวิธีจ่าย: เงินสด = payment-cash (ชมพูแบรนด์) / QR = payment-qr (น้ำเงิน) */}
        <Button
          variant={paymentMethod === 'QR' ? 'payment-qr' : 'payment-cash'}
          size="lg"
          className="w-full disabled:cursor-not-allowed"
          onClick={onCheckout}
          disabled={cart.length === 0 || loading || qrNotReady}
          loading={loading}
        >
          {loading ? 'กำลังส่งข้อมูล...' : slipProcessing ? 'กำลังเตรียมสลิป...'
            : (paymentMethod === 'QR' && !slipFile) ? <><Upload size={18} /> แนบสลิปก่อนยืนยัน</>
            : <><CheckCircle size={18} /> ยืนยันคำสั่งซื้อ</>}
        </Button>
        </div>
      </div>
    </div>
  );
}
