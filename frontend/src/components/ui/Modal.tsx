// 📄 components/ui/Modal.tsx — กล่อง popup กลางจอมาตรฐาน (มีปุ่มปิด/กดพื้นหลังปิด) ใช้ครอบเนื้อหา modal ต่างๆ
//    ทำอะไร: shell modal ตัวเดียวทั้งแอป — หัว gradient แบรนด์ (แบบเดียวกับ RewardModal/โมดัล
//    สั่งจอง) + ปุ่มปิด + เนื้อหาสกรอลล์ได้; กด Escape/พื้นหลังปิดได้
//    ⭐️ v2 — หัว modal เปลี่ยนจากพื้นเรียบ (bg-brand-bg) เป็น gradient แบรนด์ตามมาตรฐานทั้งแอป;
//    เพิ่ม hideClose/backdropClosable รองรับโหมดบังคับเปลี่ยนรหัส (forceChange)
import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface ModalProps {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  widthClassName?: string;
  hideClose?: boolean; // ซ่อนปุ่ม X (เช่น forceChange — ต้องกรอกให้จบเท่านั้น)
  backdropClosable?: boolean; // false = กดพื้นหลังไม่ปิด (เช่น forceChange)
}

export function Modal({ title, onClose, children, widthClassName = 'sm:max-w-md', hideClose = false, backdropClosable = true }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && backdropClosable) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, backdropClosable]);

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={backdropClosable ? onClose : undefined} />
      <div className={`relative bg-white rounded-t-3xl sm:rounded-3xl shadow-xl w-full overflow-hidden ${widthClassName}`}>
        {title && (
          <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-brand to-brand-dark rounded-t-3xl md:rounded-t-none shadow-sm">
            <h3 className="text-base md:text-lg font-semibold text-white flex items-center gap-2">{title}</h3>
            {!hideClose && (
              <button
                onClick={onClose}
                aria-label="ปิด"
                className="text-white/90 hover:text-white p-1 rounded-lg hover:bg-white/20 active:scale-90 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="max-h-[80dvh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
