// 📄 components/layout/PageHeader.tsx — แถบหัวหน้าหน้า (มาตรฐานเดียวทั้งแอป)
//    ทำอะไร: แถบ gradient ชมพูลอยชิดขอบ (flush) เหมือน POS/PreOrder/Notifications —
//    icon box w-8 + title text-lg + actions ด้านขวา (optional) + ปุ่มย้อนกลับ (optional)
//    จุดสำคัญ: ทุกหน้าต้องใช้คอมโพเนนต์นี้ (หรือ anatomy เดียวกันเป๊ะ) กันแถบหัวหน้าเพี้ยน
//    ต่างกันไปทีละหน้า (เคยมี 2 แบบ: แถบลอย กับ การ์ดมนกลม ที่ icon/title ต่างกัน)
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft } from 'lucide-react';

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string; // ข้อความรองใต้ title (เช่น Settings/VendorSales)
  afterTitle?: ReactNode; // เนื้อหาต่อท้าย title ในแถวเดียวกัน (เช่น health dot ของ Dashboard)
  actions?: ReactNode; // เนื้อหาด้านขวาของแถบ (ปุ่ม/chips ฯลฯ)
  onBack?: () => void; // โชว์ปุ่มย้อนกลับหน้าซ้ายสุด
  className?: string; // คลาสพิเศษเพิ่ม เช่น sticky/print override
  titleClassName?: string; // คลาสพิเศษเพิ่มบน title (เช่น font-display หน้า member)
}

export function PageHeader({ icon: Icon, title, subtitle, afterTitle, actions, onBack, className, titleClassName }: PageHeaderProps) {
  return (
    <div className={`bg-gradient-to-r from-brand to-brand-dark px-4 py-3.5 flex justify-between items-center shrink-0 shadow-md print:bg-none print:shadow-none print:p-0 ${className ?? ''}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="กลับ"
            className="p-1.5 -ml-1.5 rounded-xl hover:bg-white/20 text-white active:scale-90 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white print:hidden"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center shrink-0 print:bg-transparent">
          <Icon size={16} className="text-white print:text-gray-800" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className={`text-lg font-semibold text-white truncate print:text-gray-800 ${titleClassName ?? ''}`}>{title}</h1>
            {afterTitle}
          </div>
          {subtitle && <p className="text-xs text-white/80 truncate print:text-gray-600">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
