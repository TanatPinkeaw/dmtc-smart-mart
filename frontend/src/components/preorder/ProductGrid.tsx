// 📄 components/preorder/ProductGrid.tsx — ตารางสินค้าหน้าสั่งจอง (สมาชิก) เลือกหมวด/ค้นหา/เพิ่มลงตะกร้า
//    ทำอะไร: การ์ดสินค้า + badge/ราคาหลังลด (โปร/ใกล้หมดอายุ ผ่าน effectiveUnitPrice ตรงกับ POS+backend)
import { PackagePlus, PackageSearch } from 'lucide-react';
import { effectiveUnitPrice, itemLevelDiscountPercent } from '../../utils/money';

interface Category { id: number; name: string; }
interface Product { id: number; name: string; price: string | number; image_url: string; stock: number; category_id: number | null; }

interface ProductGridProps {
  categories: Category[];
  selectedCategory: number | 'ALL';
  onSelectCategory: (id: number | 'ALL') => void;
  products: Product[];
  productSearch: string;
  onAddToCart: (product: Product) => void;
}

export function ProductGrid({ categories, selectedCategory, onSelectCategory, products, productSearch, onAddToCart }: ProductGridProps) {
  const filtered = products
    .filter(p => selectedCategory === 'ALL' || p.category_id === selectedCategory)
    .filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()));

  return (
    <>
      {/* ⭐️ FIX: หมวดหมู่ — ใส่กรอบขาวรอบแท็บให้ดูเป็นกล่องแยกชัดเจน (เหมือนหน้า POS) เดิมลอยอยู่บนพื้น
          ชมพูเฉยๆ กลืนกับพื้นหลัง มองไม่ออกว่าเป็นส่วนควบคุมแยก + ยังคง fade gradient บอกว่าเลื่อนได้ */}
      <div className="relative bg-white border border-brand-border rounded-3xl p-2.5 mb-4 shadow-md">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          <button onClick={() => onSelectCategory('ALL')} className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${selectedCategory === 'ALL' ? 'bg-brand text-white shadow-sm' : 'bg-brand-bg text-brand hover:bg-brand-border'}`}>ทั้งหมด</button>
          {categories.map(c => (
            <button key={c.id} onClick={() => onSelectCategory(c.id)} className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${selectedCategory === c.id ? 'bg-brand text-white shadow-sm' : 'bg-brand-bg text-brand hover:bg-brand-border'}`}>{c.name}</button>
          ))}
        </div>
        <div className="pointer-events-none absolute right-2.5 top-2.5 bottom-2.5 w-8 bg-gradient-to-l from-white to-transparent rounded-r-xl" />
      </div>

      {/* ⭐️ Phase 2 — empty state: ค้นหา/หมวดหมู่ไม่มีสินค้าตรงเงื่อนไข (แทนพื้นที่ว่างเปล่าไม่บอกอะไรเลย) */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-gray-400 py-16 gap-2">
          <PackageSearch size={40} className="opacity-40" />
          <p className="text-sm font-medium">
            {productSearch.trim() ? `ไม่พบสินค้าที่ตรงกับ "${productSearch.trim()}"` : 'ไม่พบสินค้าในหมวดหมู่นี้'}
          </p>
        </div>
      ) : (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {filtered.map((product) => {
          const pAny = product as any;
          // 🐛 FIX — เดิม preorder โชว์เฉพาะส่วนลดโปรช่วงวันที่ (promo_active) ไม่โชว์ "ใกล้หมดอายุ" เลย
          // ต่างจาก POS. ใช้ helper กลางเดียวกับตอน addToCart (best ของ โปร กับ ใกล้หมดอายุ) ให้ราคาบน
          // การ์ด = ราคาที่คิดจริง = ที่ backend หัก ตรงกันทั้งหมด
          const discountPct = itemLevelDiscountPercent(pAny);
          const nearExpiry = pAny.expiry_status === 'near_expiry';
          const finalPrice = effectiveUnitPrice(pAny);
          return (
          // ⭐️ FIX: เปลี่ยนการ์ดให้เหมือนหน้า POS ทั้งหมด — ขนาด/ระยะห่างเท่ากัน + มีปุ่ม "เพิ่มลงตะกร้า"
          // ชัดเจนแทนการต้องแตะทั้งการ์ด (ปุ่มมี stopPropagation กัน addToCart ยิงซ้อน 2 ครั้งตอนกดปุ่ม)
          <div key={product.id} onClick={() => onAddToCart(product)} className={`relative overflow-hidden bg-white border rounded-3xl p-3 shadow-md transition-all duration-150 flex flex-col items-center cursor-pointer hover:shadow-lg hover:-translate-y-0.5 active:scale-95 h-full ${nearExpiry ? 'border-yellow-400 bg-yellow-50 hover:border-yellow-500' : 'border-brand-border hover:border-brand-mid'}`}>
            {!nearExpiry && <div className="absolute top-0 inset-x-0 h-1.5 bg-brand" />}
            <div className="w-full aspect-square bg-brand-bg rounded-lg mb-2 flex items-center justify-center overflow-hidden">
              {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" /> : <PackagePlus size={28} className="text-brand-mid opacity-50" />}
            </div>
            <p className="text-xs font-medium text-gray-800 text-center line-clamp-2 mb-1">{product.name}</p>

            {/* ⭐️ badge ใกล้หมดอายุ (เหมือน POS) */}
            {nearExpiry && (
              <div className="bg-yellow-200 text-yellow-800 px-2 py-1 rounded text-xs font-bold mb-1 w-full text-center">
                🎁 ใกล้หมดอายุ - {pAny.discount_percent}% OFF
              </div>
            )}

            <div className="w-full flex justify-between items-end mb-1 gap-1 mt-auto">
              {discountPct > 0 ? (
                <p className={`text-sm font-bold flex items-baseline gap-1 ${nearExpiry ? 'text-red-600' : 'text-brand'}`}>
                  ฿{finalPrice.toFixed(2)}
                  <span className="text-[9px] text-gray-400 line-through font-normal">฿{Number(product.price).toFixed(2)}</span>
                </p>
              ) : (
                <p className="text-base font-bold text-brand">฿{Number(product.price).toFixed(2)}</p>
              )}
              {discountPct > 0
                ? <span className={`shrink-0 text-[10px] text-white px-1.5 py-0.5 rounded-md font-bold ${nearExpiry ? 'bg-yellow-500' : 'bg-amber-500'}`}>-{discountPct}%</span>
                : <p className="shrink-0 text-[10px] bg-brand-bg text-brand px-1.5 py-0.5 rounded-md font-bold">เหลือ {product.stock}</p>}
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); onAddToCart(product); }}
              className="w-full py-1.5 rounded-lg text-xs font-medium bg-brand text-white hover:bg-brand-dark active:scale-95 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
            >
              เพิ่มลงตะกร้า
            </button>
          </div>
          );
        })}
      </div>
      )}
    </>
  );
}
