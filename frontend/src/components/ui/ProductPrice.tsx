// 📄 components/ui/ProductPrice.tsx — ราคาสินค้า ตัวกลางเดียวทั้งแอป
//    เดิม 4 จุดเขียนเอง (ProductGrid ×2 / PromoPopularRow / Home) สี/ขนาด/ขีดฆ่าไม่เหมือนกัน —
//    รวมเป็น: font-display + tabular-nums + ราคาเต็มขีดฆ่า (ถ้ามีส่วนลด) + สีตามสถานะ
//      brand = ราคาปกติ (ชมพู) / danger = ใกล้หมดอายุ (แดง) / promo = โปร (เหลืองอำพัน)
interface ProductPriceProps {
  price: number;
  original?: number | null; // ราคาเต็ม (โชว์ขีดฆ่าเมื่อต่างจาก price)
  tone?: 'brand' | 'danger' | 'promo';
  size?: 'xs' | 'sm' | 'base';
  className?: string;
}

export function ProductPrice({ price, original, tone = 'brand', size = 'sm', className = '' }: ProductPriceProps) {
  const color = tone === 'danger' ? 'text-red-600' : tone === 'promo' ? 'text-amber-600' : 'text-brand';
  const sizeCls = size === 'base' ? 'text-base' : size === 'xs' ? 'text-xs' : 'text-sm';
  const showStrike = original !== null && original !== undefined && Number(original) !== price;
  return (
    <span className={`inline-flex items-baseline gap-1 font-display font-bold tabular-nums ${sizeCls} ${color} ${className}`}>
      ฿{price.toFixed(2)}
      {showStrike && <s className="text-[9px] text-gray-400 font-normal">฿{Number(original).toFixed(2)}</s>}
    </span>
  );
}
