// 📄 components/ui/ProductImage.tsx — กล่องรูปสินค้า ตัวกลางเดียวทั้งแอป
//    เดิม 4 จุดเขียนเอง (ProductGrid ×2 / PromoPopularRow / Home) — รวมเป็นกล่องเดียว:
//    พื้น brand-bg + รูปจริง object-cover หรือ placeholder (PackagePlus) ตอนไม่มีรูป
//    ส่ง className เพื่อปรับทรง (เช่น h-24 สำหรับการ์ดแถวสั้น) — default เป็นสี่เหลี่ยม aspect-square
import { PackagePlus } from 'lucide-react';

interface ProductImageProps {
  imageUrl?: string | null;
  name: string;
  className?: string; // ทรง/ระยะห่างเพิ่ม (h-24, mb-2, ฯลฯ)
  iconSize?: number;
}

export function ProductImage({ imageUrl, name, className = '', iconSize = 28 }: ProductImageProps) {
  return (
    <div className={`w-full aspect-square bg-brand-bg rounded-lg flex items-center justify-center overflow-hidden ${className}`}>
      {imageUrl ? (
        <img src={imageUrl} alt={name} className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <PackagePlus size={iconSize} className="text-brand-mid opacity-50" />
      )}
    </div>
  );
}
