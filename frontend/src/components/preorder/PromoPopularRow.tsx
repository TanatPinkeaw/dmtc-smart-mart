// 📄 components/preorder/PromoPopularRow.tsx — แถวไฮไลต์ด้านบนหน้าสั่งจอง (สินค้ามีโปร + ยอดนิยม)
//    ทำอะไร: เลื่อนแนวนอนโชว์สินค้าใกล้หมดอายุ/โปร (ราคาหลังลดผ่าน effectiveUnitPrice) + สินค้าขายดี +
//    แบนเนอร์โปรร้าน — โชว์เฉพาะตอน browse ปกติ (ไม่ค้นหา/ไม่กรองหมวด)
import { effectiveUnitPrice, itemLevelDiscountPercent } from '../../utils/money';
import { SectionTitle } from '../ui/SectionTitle';
import { ProductImage } from '../ui/ProductImage';
import { ProductPrice } from '../ui/ProductPrice';

interface Product { id: number; name: string; price: string | number; image_url: string; stock: number; category_id: number | null; }

interface StorePromo { id: number; label: string; }

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
                    <ProductImage imageUrl={p.image_url} name={p.name} className="mb-1" iconSize={22} />
                    <p className="text-[11px] font-medium text-gray-800 line-clamp-1">{p.name}</p>
                    <ProductPrice size="xs" price={effectiveUnitPrice(p)} original={Number(p.price)} />
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
                    <ProductImage imageUrl={p.image_url} name={p.name} className="mb-1" iconSize={22} />
                    <p className="text-[11px] font-medium text-gray-800 line-clamp-1">{p.name}</p>
                    <ProductPrice size="xs" price={effectiveUnitPrice(p)} original={Number(p.price)} />
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
