// 📄 components/common/PhotoLightbox.tsx — เปิดดูรูปใหญ่แบบ modal เต็มจอ (รูปเข้างาน/ปิดกะ/สลิป)
//    ทำอะไร: คลิกรูปแล้วเด้ง modal แสดงรูปใหญ่ (ใช้ AuthImage โหลดรูปที่ต้อง auth) — แทน window.open ที่มือถือบล็อก
// ⭐️ Lightbox แสดงรูปยืนยันสถานที่ (เข้า/ออกงาน, ปิดกะ ฯลฯ) แบบ modal ในหน้าเดียว
//   แทนที่ openAuthImage (window.open blob) ที่มือถือหลายรุ่นบล็อก/เปิดแท็บเปล่า — ใช้ AuthImage
//   เดิมที่มีอยู่แล้ว (จัดการ Cloudinary URL เต็ม vs /uploads path ที่ต้องแนบ JWT ผ่าน /media ให้เอง)
import { useEffect } from 'react';
import { X } from 'lucide-react';
import AuthImage from './AuthImage';

interface PhotoLightboxProps {
  path: string;
  title?: string;
  onClose: () => void;
}

export default function PhotoLightbox({ path, title, onClose }: PhotoLightboxProps) {
  // ⭐️ กด Esc ปิดได้ (มือถือแตะ backdrop/ปุ่ม X)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90dvh] flex flex-col items-center">
        <button
          onClick={onClose}
          aria-label="ปิด"
          className="absolute -top-2 -right-2 sm:top-0 sm:-right-12 z-10 p-2 bg-white/90 hover:bg-white text-gray-800 rounded-full shadow-lg active:scale-90 transition-all duration-150"
        >
          <X size={20} />
        </button>

        {title && (
          <p className="text-white text-sm font-semibold mb-2 text-center px-2">{title}</p>
        )}

        <div className="w-full min-h-[200px] max-h-[75dvh] overflow-hidden rounded-2xl bg-white/5 flex items-center justify-center">
          <AuthImage
            path={path}
            alt={title || 'รูปยืนยันสถานที่'}
            className="w-full min-h-[200px] max-h-[75dvh] object-contain rounded-2xl"
            fallback={<p className="text-white/70 text-sm p-8">โหลดรูปไม่สำเร็จ</p>}
          />
        </div>
      </div>
    </div>
  );
}
