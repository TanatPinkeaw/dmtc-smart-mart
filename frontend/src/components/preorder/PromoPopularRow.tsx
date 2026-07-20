import { PackagePlus } from 'lucide-react';

interface Product { id: number; name: string; price: string | number; image_url: string; stock: number; category_id: number | null; }

interface PromoPopularRowProps {
  selectedCategory: number | 'ALL';
  productSearch: string;
  storePromos: any[];
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
        <div className="mb-4 bg-gradient-to-r from-brand to-brand-dark text-white rounded-xl p-3 shadow-sm">
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
              <h3 className="text-sm font-bold text-amber-600 mb-2 flex items-center gap-1.5">🏷️ สินค้ามีโปร <span className="text-[10px] font-normal text-gray-400">(ใกล้หมดอายุ ลดราคา)</span></h3>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                {highlights.promo.map(p => (
                  <div key={`promo-${p.id}`} onClick={() => onAddToCart(p)} className="shrink-0 w-28 bg-white border border-amber-200 rounded-xl p-2 cursor-pointer hover:shadow-sm active:scale-95 transition relative">
                    <span className="absolute top-1 left-1 z-10 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">-{(p as any).promo_active ? (p as any).promo_percent : ((p as any).discount_percent || 40)}%</span>
                    <div className="w-full aspect-square bg-brand-bg rounded-lg mb-1 flex items-center justify-center overflow-hidden">
                      {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <PackagePlus size={22} className="text-brand-mid opacity-50" />}
                    </div>
                    <p className="text-[11px] font-medium text-gray-800 line-clamp-1">{p.name}</p>
                    <p className="text-xs font-bold text-brand">฿{Number(p.price).toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {highlights.popular.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-1.5">🔥 สินค้ายอดนิยม</h3>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                {highlights.popular.map((p, i) => (
                  <div key={`pop-${p.id}`} onClick={() => onAddToCart(p)} className="shrink-0 w-28 bg-white border border-brand-border rounded-xl p-2 cursor-pointer hover:shadow-sm active:scale-95 transition relative">
                    <span className="absolute top-1 left-1 z-10 bg-brand text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">{i + 1}</span>
                    <div className="w-full aspect-square bg-brand-bg rounded-lg mb-1 flex items-center justify-center overflow-hidden">
                      {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <PackagePlus size={22} className="text-brand-mid opacity-50" />}
                    </div>
                    <p className="text-[11px] font-medium text-gray-800 line-clamp-1">{p.name}</p>
                    <p className="text-xs font-bold text-brand">฿{Number(p.price).toFixed(2)}</p>
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
