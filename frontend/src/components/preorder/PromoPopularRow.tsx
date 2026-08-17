// 📄 components/preorder/PromoPopularRow.tsx — แถวไฮไลต์ด้านบนหน้าสั่งจอง (สินค้ามีโปร + ยอดนิยม)
//    ทำอะไร: เลื่อนแนวนอนโชว์สินค้าใกล้หมดอายุ/โปร (ราคาหลังลดผ่าน effectiveUnitPrice) + สินค้าขายดี +
//    แบนเนอร์โปรร้าน — โชว์เฉพาะตอน browse ปกติ (ไม่ค้นหา/ไม่กรองหมวด)
import { PackagePlus } from 'lucide-react';
import { effectiveUnitPrice, itemLevelDiscountPercent } from '../../utils/money';
import { SectionTitle } from '../ui/SectionTitle';

interface Product { id: number; name: string; price: string | number; image_url: string; stock: number; category_id: number | null; }

interface StorePromo { id: number; label: string; }

// ⭐️ field ส่วนลด/ใกล้หมดอายุที่ backend เติมมา — แทน `any` ใน PriceLine เดิม
interface ProductWithPromo extends Product {
  expiry_status?: string;
  promo_active?: boolean;
  promo_percent?: number | string;
  discount_percent?: number | string;
}

// ⭐️ ราคา + ราคาขีดฆ่า ใช้ helper กลางเดียวกับ ProductGrid/addToCart (best ของ โปร กับ ใกล้หมดอายุ)
// กันโชว์ราคาเต็มทั้งที่ badge บอกลด (ราคาลดจริงตอนคิดเงินอยู่แล้ว — นี่แค่ให้ display ตรงกัน)
function PriceLine({ p }: { p: ProductWithPromo }) {
  const pct = itemLevelDiscountPercent(p);
  if (pct > 0) {
    return (
      <p className="text-xs font-bold text-brand flex items-baseline gap-1">
        ฿{effectiveUnitPrice(p).toFixed(2)}
        <span className="text-[8px] text-gray-400 line-through font-normal">฿{Number(p.price).toFixed(2)}</span>
      </p>
    );
  }
  return <p className="text-xs font-bold text-brand">฿{Number(p.price).toFixed(2)}</p>;
}

interface PromoPopularRowProps {
  selectedCategory: number | 'ALL';
  productSearch: string;
  storePromos: StorePromo[];
  highlights: { popular: Product[]; promo: Product[] };
  onAddToCart: (product: Product) => void;
}

export function PromoPopularRow({ selectedCategory, productSearch, storePromos, highlights, onAddToCart }: PromoPopularRowProps) {
  const showSection = selectedCategory === 'ALL' && !productSearch;
  if (!showSection) return null;

  return (
    <>
      {/* ⭐️ Phase 2 — แบนเนอร์โปรร้าน (ลดทั้งบิล/BOGO) — โชว์ตอน browse ปกติ */}
      {storePromos.length > 0 && (
        <div className="mb-4 bg-gradient-to-r from-brand to-brand-dark text-white rounded-3xl p-3 shadow-md">
          <p className="text-xs font-bold mb-1.5 flex items-center gap-1">🎉 โปรโมชั่นร้านวันนี้ <span className="font-normal text-white/70">(รับสิทธิ์ที่เคาน์เตอร์)</span></p>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {storePromos.map(pr => (
              <span key={pr.id} className="shrink-0 bg-white/20 rounded-full px-3 py-1 text-xs font-semibold">{pr.label}</span>
            ))}
          </div>
        </div>
      )}

      {/* ⭐️ ไฮไลต์: สินค้ามีโปร + ยอดนิยม (โชว์เฉพาะตอน browse ปกติ ไม่ค้นหา/ไม่กรองหมวด) */}
      {(highlights.promo.length > 0 || highlights.popular.length > 0) && (
        <div className="space-y-4 mb-4">
          {highlights.promo.length > 0 && (
            <div>
              <SectionTitle accent="bg-gradient-to-b from-amber-500 to-amber-600">🏷️ สินค้ามีโปร <span className="text-[10px] font-normal text-gray-400">(ใกล้หมดอายุ ลดราคา)</span></SectionTitle>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                {highlights.promo.map(p => (
                  <div key={`promo-${p.id}`} onClick={() => onAddToCart(p)} className="shrink-0 w-28 bg-white border border-amber-200 rounded-3xl p-2 shadow-md cursor-pointer hover:shadow-lg hover:-translate-y-0.5 active:scale-95 transition-all duration-150 relative">
                    <span className="absolute top-1 left-1 z-10 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">-{itemLevelDiscountPercent(p)}%</span>
                    <div className="w-full aspect-square bg-brand-bg rounded-lg mb-1 flex items-center justify-center overflow-hidden">
                      {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <PackagePlus size={22} className="text-brand-mid opacity-50" />}
                    </div>
                    <p className="text-[11px] font-medium text-gray-800 line-clamp-1">{p.name}</p>
                    <PriceLine p={p} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {highlights.popular.length > 0 && (
            <div>
              <SectionTitle>🔥 สินค้ายอดนิยม</SectionTitle>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                {highlights.popular.map((p, i) => (
                  <div key={`pop-${p.id}`} onClick={() => onAddToCart(p)} className="shrink-0 w-28 bg-white border border-brand-border rounded-3xl p-2 shadow-md cursor-pointer hover:shadow-lg hover:-translate-y-0.5 active:scale-95 transition-all duration-150 relative">
                    <span className="absolute top-1 left-1 z-10 bg-brand text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">{i + 1}</span>
                    <div className="w-full aspect-square bg-brand-bg rounded-lg mb-1 flex items-center justify-center overflow-hidden">
                      {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <PackagePlus size={22} className="text-brand-mid opacity-50" />}
                    </div>
                    <p className="text-[11px] font-medium text-gray-800 line-clamp-1">{p.name}</p>
                    <PriceLine p={p} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
