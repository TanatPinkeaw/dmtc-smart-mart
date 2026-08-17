// 📄 components/preorder/ProductGrid.tsx — ตารางสินค้าหน้าสั่งจอง (สมาชิก) เลือกหมวด/ค้นหา/เพิ่มลงตะกร้า
//    ทำอะไร: การ์ดสินค้า + badge/ราคาหลังลด (โปร/ใกล้หมดอายุ ผ่าน effectiveUnitPrice ตรงกับ POS+backend)
import { PackageSearch } from 'lucide-react';
import { effectiveUnitPrice, itemLevelDiscountPercent } from '../../utils/money';
import { EmptyState } from '../ui/EmptyState';
import { ProductCard } from '../ui/ProductCard';

interface Category { id: number; name: string; }
interface Product { id: number; name: string; price: string | number; image_url: string; stock: number; category_id: number | null; }

// ⭐️ field ส่วนลด/ใกล้หมดอายุที่ backend เติมมา (ไม่จำเป็นทุกการ์ด) — แทน `as any` เดิม
interface ProductWithPromo extends Product {
  expiry_status?: string;
  promo_active?: boolean;
  promo_percent?: number | string;
  discount_percent?: number | string;
}

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
        <EmptyState
          icon={<PackageSearch size={26} />}
          title={productSearch.trim() ? `ไม่พบสินค้าที่ตรงกับ "${productSearch.trim()}"` : 'ไม่พบสินค้าในหมวดหมู่นี้'}
        />
      ) : (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {filtered.map((product) => {
          const pAny = product as ProductWithPromo;
          // 🐛 FIX — เดิม preorder โชว์เฉพาะส่วนลดโปรช่วงวันที่ (promo_active) ไม่โชว์ "ใกล้หมดอายุ" เลย
          // ต่างจาก POS. ใช้ helper กลางเดียวกับตอน addToCart (best ของ โปร กับ ใกล้หมดอายุ) ให้ราคาบน
          // การ์ด = ราคาที่คิดจริง = ที่ backend หัก ตรงกันทั้งหมด — การ์ดเองเป็น ui/ProductCard (กลาง)
          const discountPct = itemLevelDiscountPercent(pAny);
          const nearExpiry = pAny.expiry_status === 'near_expiry';
          const isExpired = pAny.expiry_status === 'expired';
          const finalPrice = effectiveUnitPrice(pAny);
          return (
            <ProductCard
              key={product.id}
              product={pAny}
              finalPrice={finalPrice}
              discountPct={discountPct}
              tone={nearExpiry ? 'danger' : discountPct > 0 ? 'promo' : 'brand'}
              showStock
              disabled={isExpired}
              onAddToCart={() => onAddToCart(product)}
            />
          );
        })}
      </div>
      )}
    </>
  );
}
