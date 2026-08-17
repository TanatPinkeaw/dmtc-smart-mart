// 📄 components/ui/ProductCard.tsx — การ์ดสินค้า (แบบกริด) ตัวกลางเดียวทั้งแอป
//    เดิม POS กับหน้าจองเขียนการ์ดซ้ำกัน (~150 บรรทัด) ต่างกันนิดหน่อย (badge โปร/ช่องแก้ราคา)
//    — รวมเป็นตัวเดียว: แถบ brand บน + รูป + ชื่อ + badge สถานะ (ใกล้หมดอายุ/หมดอายุ/โปร) +
//    ราคา (ProductPrice) + chip ส่วนลด/สต๊อก + ปุ่มเพิ่มลงตะกร้า + ช่องแก้ราคา (POS เท่านั้น)
//    ใช้กับทั้ง preorder/ProductGrid และ pos/ProductGrid — ถ้าจะแก้การ์ด แก้ที่นี่ที่เดียว
import type { ReactNode } from 'react';
import { ProductImage } from './ProductImage';
import { ProductPrice } from './ProductPrice';

// field ส่วนลด/ใกล้หมดอายุที่ backend เติมมา — ไม่จำเป็นทุกการ์ด
export interface ProductCardData {
  id: number;
  name: string;
  price: string | number;
  image_url?: string | null;
  stock?: number;
  expiry_status?: string;
  promo_active?: boolean;
  promo_percent?: number | string;
  discount_percent?: number | string;
}

interface ProductCardProps {
  product: ProductCardData;
  finalPrice?: number; // ราคาหลังลด/override (default = ราคาเต็ม)
  discountPct?: number; // % ส่วนลดสำหรับ chip (caller คำนวณด้วย helper กลางของตัวเอง)
  tone?: 'brand' | 'danger' | 'promo'; // สีราคา: ใกล้หมดอายุ=แดง / โปร=เหลืองอำพัน
  showStock?: boolean;
  disabled?: boolean; // หมดอายุ — กดไม่ได้ + ปุ่มจาง
  disabledLabel?: string;
  onAddToCart: () => void;
  priceOverrideInput?: ReactNode; // POS: ช่องแก้ราคาเบิกเพิ่มเติม (optional)
}

export function ProductCard({
  product, finalPrice, discountPct = 0, tone = 'brand', showStock,
  disabled = false, disabledLabel = 'ไม่สามารถขายได้', onAddToCart, priceOverrideInput,
}: ProductCardProps) {
  const nearExpiry = product.expiry_status === 'near_expiry';
  const isExpired = product.expiry_status === 'expired';
  const expiresToday = product.expiry_status === 'expires_today';
  const promoActive = !!product.promo_active && !nearExpiry;
  const price = finalPrice ?? Number(product.price);

  return (
    <div
      onClick={() => !disabled && onAddToCart()}
      className={`relative overflow-hidden bg-white border rounded-3xl p-3 shadow-md transition-all duration-150 flex flex-col items-center h-full ${
        isExpired ? 'opacity-50 cursor-not-allowed border-red-300'
          : nearExpiry ? 'border-yellow-400 bg-yellow-50 hover:border-yellow-500 cursor-pointer hover:shadow-lg hover:-translate-y-0.5 active:scale-95'
          : 'border-brand-border hover:border-brand-mid cursor-pointer hover:shadow-lg hover:-translate-y-0.5 active:scale-95'
      }`}
    >
      {!nearExpiry && !isExpired && <div className="absolute top-0 inset-x-0 h-1.5 bg-brand" />}
      <ProductImage imageUrl={product.image_url} name={product.name} className="mb-2" iconSize={28} />
      <p className="text-xs font-medium text-gray-800 text-center line-clamp-2 mb-1">{product.name}</p>

      {/* badge สถานะ — ใกล้หมดอายุ / หมดอายุ / หมดอายุวันนี้ / โปร */}
      {nearExpiry && (
        <div className="bg-yellow-200 text-yellow-800 px-2 py-1 rounded text-xs font-bold mb-1 w-full text-center">
          🎁 ใกล้หมดอายุ - {product.discount_percent}% OFF
        </div>
      )}
      {isExpired && (
        <div className="bg-red-200 text-red-800 px-2 py-1 rounded text-xs font-bold mb-1 w-full text-center">❌ หมดอายุ</div>
      )}
      {expiresToday && (
        <div className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs mb-1 w-full text-center">⚠️ หมดอายุวันนี้</div>
      )}
      {promoActive && (
        <div className="bg-amber-200 text-amber-800 px-2 py-1 rounded text-xs font-bold mb-1 w-full text-center">
          🏷️ โปรลดราคา -{product.promo_percent}%
        </div>
      )}

      {/* ราคา + chip ส่วนลด/สต๊อก */}
      <div className="w-full flex justify-between items-end mb-1 gap-1 mt-auto">
        <ProductPrice price={price} original={Number(product.price)} tone={tone} size="sm" />
        {discountPct > 0 ? (
          <span className={`shrink-0 text-[10px] text-white px-1.5 py-0.5 rounded-md font-bold ${nearExpiry ? 'bg-yellow-500' : 'bg-amber-500'}`}>
            -{discountPct}%
          </span>
        ) : showStock && typeof product.stock === 'number' ? (
          <p className="shrink-0 text-[10px] bg-brand-bg text-brand px-1.5 py-0.5 rounded-md font-bold">เหลือ {product.stock}</p>
        ) : null}
      </div>

      {priceOverrideInput}

      <button
        onClick={(e) => { e.stopPropagation(); if (!disabled) onAddToCart(); }}
        disabled={disabled}
        className={`w-full py-1.5 rounded-lg text-xs font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${
          disabled ? 'bg-gray-300 text-gray-600 cursor-not-allowed' : 'bg-brand text-white hover:bg-brand-dark active:scale-95'
        }`}
      >
        {disabled ? disabledLabel : 'เพิ่มลงตะกร้า'}
      </button>
    </div>
  );
}
