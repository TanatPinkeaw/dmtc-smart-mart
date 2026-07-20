import { PackagePlus } from 'lucide-react';

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
      <div className="relative bg-white border border-brand-border rounded-2xl p-2.5 mb-4 shadow-md">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          <button onClick={() => onSelectCategory('ALL')} className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${selectedCategory === 'ALL' ? 'bg-brand text-white shadow-sm' : 'bg-brand-bg text-brand hover:bg-brand-border'}`}>ทั้งหมด</button>
          {categories.map(c => (
            <button key={c.id} onClick={() => onSelectCategory(c.id)} className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold transition-all duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${selectedCategory === c.id ? 'bg-brand text-white shadow-sm' : 'bg-brand-bg text-brand hover:bg-brand-border'}`}>{c.name}</button>
          ))}
        </div>
        <div className="pointer-events-none absolute right-2.5 top-2.5 bottom-2.5 w-8 bg-gradient-to-l from-white to-transparent rounded-r-xl" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {filtered.map((product) => (
          // ⭐️ FIX: เปลี่ยนการ์ดให้เหมือนหน้า POS ทั้งหมด — ขนาด/ระยะห่างเท่ากัน + มีปุ่ม "เพิ่มลงตะกร้า"
          // ชัดเจนแทนการต้องแตะทั้งการ์ด (ปุ่มมี stopPropagation กัน addToCart ยิงซ้อน 2 ครั้งตอนกดปุ่ม)
          <div key={product.id} onClick={() => onAddToCart(product)} className="relative overflow-hidden bg-white border border-brand-border rounded-2xl p-3 shadow-md transition-all duration-150 flex flex-col items-center cursor-pointer hover:border-brand-mid hover:shadow-lg hover:-translate-y-0.5 active:scale-95 h-full">
            <div className="absolute top-0 inset-x-0 h-1.5 bg-brand" />
            <div className="w-full aspect-square bg-brand-bg rounded-lg mb-2 flex items-center justify-center overflow-hidden">
              {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" /> : <PackagePlus size={28} className="text-brand-mid opacity-50" />}
            </div>
            <p className="text-xs font-medium text-gray-800 text-center line-clamp-2 mb-1">{product.name}</p>

            <div className="w-full flex justify-between items-end mb-1 gap-1 mt-auto">
              {(product as any).promo_active ? (
                <p className="text-sm font-bold text-brand flex items-baseline gap-1">
                  ฿{(Number(product.price) * (1 - (Number((product as any).promo_percent) || 0) / 100)).toFixed(2)}
                  <span className="text-[9px] text-gray-400 line-through font-normal">฿{Number(product.price).toFixed(2)}</span>
                </p>
              ) : (
                <p className="text-base font-bold text-brand">฿{Number(product.price).toFixed(2)}</p>
              )}
              {(product as any).promo_active
                ? <span className="shrink-0 text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded-md font-bold">-{(product as any).promo_percent}%</span>
                : <p className="shrink-0 text-[10px] bg-brand-bg text-brand px-1.5 py-0.5 rounded-md font-bold">เหลือ {product.stock}</p>}
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); onAddToCart(product); }}
              className="w-full py-1.5 rounded-lg text-xs font-medium bg-brand text-white hover:bg-brand-dark active:scale-95 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
            >
              เพิ่มลงตะกร้า
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
