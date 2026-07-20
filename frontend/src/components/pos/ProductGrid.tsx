import { Search, PackagePlus } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';

interface Category { id: number; name: string; }
interface Product { id: number; barcode: string; name: string; price: string | number; image_url: string; category_id: number | null; stock?: number; }

interface ProductGridProps {
  categories: Category[];
  selectedCategory: number | 'ALL';
  onSelectCategory: (id: number | 'ALL') => void;
  storePromos: any[];
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
      <div className="md:w-1/5 bg-white border border-brand-border rounded-2xl shadow-md m-3 mb-0 md:m-0 md:rounded-none md:shadow-none md:border-0 md:border-r p-3 overflow-x-auto md:overflow-y-auto shrink-0 flex flex-row md:flex-col gap-2 scrollbar-hide">
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
            className="w-full pl-8 pr-4 py-2 bg-brand-bg border border-brand-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand transition-colors duration-150" />
        </div>

        {filteredProducts.length === 0 ? (
          <EmptyState icon={<PackagePlus size={36} />} title="ไม่พบสินค้าในหมวดนี้" />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredProducts.map(p => {
              const pWithExpiry = p as any;
              const showDiscount = pWithExpiry.expiry_status === 'near_expiry';
              const overridePrice = priceOverride[p.id];
              // ⭐️ Phase 1 — โปรช่วงวันที่ (ใช้เมื่อไม่มีลดใกล้หมดอายุ; ถ้ามีทั้งคู่ server จะเลือกอันดีสุดตอนคิดเงินเอง)
              const promoActive = !showDiscount && !!pWithExpiry.promo_active;
              const promoPct = Number(pWithExpiry.promo_percent) || 0;
              const finalPrice = overridePrice ?? (showDiscount ? pWithExpiry.price_after_discount : (promoActive ? Number(p.price) * (1 - promoPct / 100) : p.price));
              const isExpired = pWithExpiry.expiry_status === 'expired';

              return (
                <div
                  key={p.id}
                  onClick={() => !isExpired && onAddToCart(p, finalPrice)}
                  className={`relative overflow-hidden bg-white border rounded-2xl p-3 shadow-md transition-all duration-150 flex flex-col items-center h-full
                    ${showDiscount ? 'border-yellow-400 bg-yellow-50' : 'border-brand-border'}
                    ${isExpired ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-brand-mid hover:shadow-lg hover:-translate-y-0.5 active:scale-95'}
                  `}
                >
                  {!showDiscount && !isExpired && <div className="absolute top-0 inset-x-0 h-1.5 bg-brand" />}
                  <div className="w-full aspect-square bg-brand-bg rounded-lg mb-2 flex items-center justify-center overflow-hidden">
                    {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <PackagePlus size={28} className="text-brand-mid opacity-50" />}
                  </div>
                  <p className="text-xs font-medium text-gray-800 text-center line-clamp-2 mb-1">{p.name}</p>

                  {/* ⭐️ Sprint 2: Expiry Badges */}
                  {showDiscount && (
                    <div className="bg-yellow-200 text-yellow-800 px-2 py-1 rounded text-xs font-bold mb-1 w-full text-center">
                      🎁 ใกล้หมดอายุ - {pWithExpiry.discount_percent}% OFF
                    </div>
                  )}
                  {isExpired && (
                    <div className="bg-red-200 text-red-800 px-2 py-1 rounded text-xs font-bold mb-1 w-full text-center">
                      ❌ หมดอายุ
                    </div>
                  )}
                  {pWithExpiry.expiry_status === 'expires_today' && (
                    <div className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs mb-1 w-full text-center">
                      ⚠️ หมดอายุวันนี้
                    </div>
                  )}
                  {promoActive && (
                    <div className="bg-amber-200 text-amber-800 px-2 py-1 rounded text-xs font-bold mb-1 w-full text-center">
                      🏷️ โปรลดราคา -{promoPct}%
                    </div>
                  )}

                  {/* ⭐️ FIX: ราคาอยู่มุมซ้ายล่าง จำนวนคงเหลืออยู่มุมขวาล่าง เหมือนการ์ดสินค้าหน้าจอง (Pre-order)
                      mt-auto ดันราคา+ปุ่มด้านล่างทั้งกลุ่มให้ชิดขอบล่างเสมอ แม้การ์ดถูก grid stretch สูงไม่เท่ากัน */}
                  <div className="w-full flex justify-between items-end mb-1 gap-1 mt-auto">
                    <div className="min-w-0">
                      {showDiscount ? (
                        <>
                          <s className="text-gray-400 text-xs block">฿{Number(p.price).toFixed(2)}</s>
                          <span className="text-red-600 font-bold text-sm">฿{Number(finalPrice).toFixed(2)}</span>
                        </>
                      ) : promoActive ? (
                        <>
                          <s className="text-gray-400 text-xs block">฿{Number(p.price).toFixed(2)}</s>
                          <span className="text-amber-600 font-bold text-sm">฿{Number(finalPrice).toFixed(2)}</span>
                        </>
                      ) : (
                        <p className="text-base font-bold text-brand">฿{Number(finalPrice).toFixed(2)}</p>
                      )}
                    </div>
                    {typeof p.stock === 'number' && (
                      <p className="shrink-0 text-[10px] bg-brand-bg text-brand px-1.5 py-0.5 rounded-md font-bold">เหลือ {p.stock}</p>
                    )}
                  </div>

                  {/* ⭐️ Sprint 2: Staff Override Price Input */}
                  {showDiscount && (
                    <div className="w-full mt-1 mb-2" onClick={(e) => e.stopPropagation()}>
                      <label className="text-xs text-gray-600">ราคาเบิกเพิ่มเติม:</label>
                      <input
                        type="number"
                        value={overridePrice ?? ''}
                        onChange={(e) => onPriceOverrideChange(p.id, parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 border rounded text-sm"
                        placeholder={Number(pWithExpiry.price_after_discount).toFixed(2)}
                        step="0.01"
                      />
                    </div>
                  )}

                  {/* ⭐️ FIX: เพิ่ม stopPropagation กัน addToCart ยิงซ้อน 2 ครั้ง (การ์ดทั้งใบก็ onClick
                      addToCart อยู่แล้ว กดปุ่มจะ bubble ขึ้นไปยิงซ้ำ) + เปลี่ยน hover เป็น #FF467E ให้ตรงธีม */}
                  <button
                    onClick={(e) => { e.stopPropagation(); if (!isExpired) onAddToCart(p, finalPrice); }}
                    disabled={isExpired}
                    className={`w-full py-1.5 rounded-lg text-xs font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1
                      ${isExpired
                        ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                        : 'bg-brand text-white hover:bg-brand-dark active:scale-95'
                      }
                    `}
                  >
                    {isExpired ? 'ไม่สามารถขายได้' : 'เพิ่มลงตะกร้า'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
