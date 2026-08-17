// 📄 components/pos/ProductGrid.tsx — ตารางสินค้าฝั่งซ้ายหน้า POS (แคชเชียร์) — เลือกหมวด/ค้นหา/กดเพิ่มลงตะกร้า
//    ทำอะไร: โชว์การ์ดสินค้า + badge ใกล้หมดอายุ/โปร + ราคาหลังลด (ราคาที่คิดจริง) + ช่องแก้ราคา (override) —
//    สินค้าหมดอายุกดไม่ได้ ; เป็นหน้าตาล้วน logic อยู่ pages/POS.tsx
import { Search, PackagePlus } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { ProductCard } from '../ui/ProductCard';
import { effectiveUnitPrice } from '../../utils/money'; // 🐛 FIX — ใช้ helper กลางเดียวกับหน้าจอง กันราคา 2 หน้าไม่ตรงกัน

interface Category { id: number; name: string; }
interface Product { id: number; barcode: string; name: string; price: string | number; image_url: string; category_id: number | null; stock?: number; }

interface StorePromo { id: number; label: string; }

// ⭐️ field ส่วนลด/ใกล้หมดอายุที่ backend เติมมา (ไม่จำเป็นทุกการ์ด) — แทน `as any` เดิม
interface ProductWithExpiry extends Product {
  expiry_status?: string;
  promo_active?: boolean;
  promo_percent?: number | string;
  discount_percent?: number | string;
}

interface ProductGridProps {
  categories: Category[];
  selectedCategory: number | 'ALL';
  onSelectCategory: (id: number | 'ALL') => void;
  storePromos: StorePromo[];
  productSearchQuery: string;
  onSearchChange: (value: string) => void;
  filteredProducts: Product[];
  priceOverride: { [key: number]: number };
  onPriceOverrideChange: (productId: number, value: number) => void;
  onAddToCart: (product: Product, customPrice?: number) => void;
}

export function ProductGrid({
  categories, selectedCategory, onSelectCategory, storePromos,
  productSearchQuery, onSearchChange, filteredProducts,
  priceOverride, onPriceOverrideChange, onAddToCart,
}: ProductGridProps) {
  return (
    <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
      {/* ⭐️ FIX: มือถือ — ใส่กรอบขาวโค้งมนรอบแท็บหมวดหมู่ให้เหมือนหน้าจอง (Pre-order) เดิมเป็นแค่แถบบาง
          ไม่มีกรอบ ดูกลืนกับพื้นหลัง ส่วนเดสก์ท็อปยังคงเป็น sidebar ตามเดิม (border-r ธรรมดา ไม่ใส่กรอบ) */}
      <div className="md:w-1/5 bg-white border border-brand-border rounded-3xl shadow-md m-3 mb-0 md:m-0 md:rounded-none md:shadow-none md:border-0 md:border-r p-3 overflow-x-auto md:overflow-y-auto shrink-0 flex flex-row md:flex-col gap-2 scrollbar-hide">
        <button onClick={() => onSelectCategory('ALL')} className={`shrink-0 px-4 py-2 rounded-full md:rounded-xl text-sm font-medium transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${selectedCategory === 'ALL' ? 'bg-brand text-white shadow-sm' : 'bg-brand-bg text-gray-600 hover:bg-brand-border'}`}>ทั้งหมด</button>
        {categories.map(cat => (
          <button key={cat.id} onClick={() => onSelectCategory(cat.id)} className={`shrink-0 px-4 py-2 rounded-full md:rounded-xl text-sm font-medium transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${selectedCategory === cat.id ? 'bg-brand text-white shadow-sm' : 'bg-brand-bg text-gray-600 hover:bg-brand-border'}`}>
            {cat.name}
          </button>
        ))}
      </div>

      {/* Product grid */}
      <div className="flex-1 p-3 overflow-y-auto pb-28 md:pb-4">
        {/* ⭐️ Phase 2 — แบนเนอร์โปรร้าน (ลดทั้งบิล/BOGO) เตือนแคชเชียร์ว่ามีโปรอะไรใช้ได้ */}
        {storePromos.length > 0 && (
          <div className="mb-3 bg-gradient-to-r from-brand to-brand-dark text-white rounded-xl p-2.5 shadow-sm animate-fade-in">
            <p className="text-xs font-bold mb-1 flex items-center gap-1">🎉 โปรวันนี้</p>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              {storePromos.map(pr => (
                <span key={pr.id} className="shrink-0 bg-white/20 rounded-full px-3 py-1 text-xs font-semibold">{pr.label}</span>
              ))}
            </div>
          </div>
        )}
        <div className="relative mb-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="ค้นหาสินค้า / บาร์โค้ด..." value={productSearchQuery} onChange={e => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-4 py-2 bg-brand-bg border border-brand-border rounded-full text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand focus:bg-white transition-colors duration-150" />
        </div>

        {filteredProducts.length === 0 ? (
          <EmptyState icon={<PackagePlus size={36} />} title="ไม่พบสินค้าในหมวดนี้" />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredProducts.map(p => {
              const pWithExpiry = p as ProductWithExpiry;
              // 🐛 FIX — เดิมคำนวณราคา inline (ใกล้หมดอายุใช้ price_after_discount จาก backend, โปรคิดแบบ
              // float ไม่ปัด) ทำให้ราคาไม่ตรงกับหน้าจอง/backend — เปลี่ยนเป็น helper กลาง (money.ts) ตัวเดียว
              const showDiscount = pWithExpiry.expiry_status === 'near_expiry';
              const overridePrice = priceOverride[p.id];
              // ⭐️ Phase 1 — โปรช่วงวันที่ (ใช้เมื่อไม่มีลดใกล้หมดอายุ; ถ้ามีทั้งคู่ server จะเลือกอันดีสุดตอนคิดเงินเอง)
              const promoActive = !showDiscount && !!pWithExpiry.promo_active;
              const finalPrice = overridePrice ?? effectiveUnitPrice(pWithExpiry);
              const isExpired = pWithExpiry.expiry_status === 'expired';
              const discountPct = showDiscount ? Number(pWithExpiry.discount_percent) || 0 : promoActive ? Number(pWithExpiry.promo_percent) || 0 : 0;

              // ⭐️ การ์ดเป็น ui/ProductCard กลาง (เดียวกับหน้าจอง) — ช่องแก้ราคาเบิกเพิ่มเติมส่งเป็น prop
              return (
                <ProductCard
                  key={p.id}
                  product={pWithExpiry}
                  finalPrice={finalPrice}
                  discountPct={discountPct}
                  tone={showDiscount ? 'danger' : promoActive ? 'promo' : 'brand'}
                  showStock
                  disabled={isExpired}
                  onAddToCart={() => onAddToCart(p, finalPrice)}
                  priceOverrideInput={
                    showDiscount ? (
                      <div className="w-full mt-1 mb-2" onClick={(e) => e.stopPropagation()}>
                        <label className="text-xs text-gray-600">ราคาเบิกเพิ่มเติม:</label>
                        <input
                          type="number"
                          value={overridePrice ?? ''}
                          onChange={(e) => onPriceOverrideChange(p.id, parseFloat(e.target.value) || 0)}
                          className="w-full px-2 py-1 border rounded text-sm"
                          placeholder={effectiveUnitPrice(pWithExpiry).toFixed(2)}
                          step="0.01"
                        />
                      </div>
                    ) : null
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
