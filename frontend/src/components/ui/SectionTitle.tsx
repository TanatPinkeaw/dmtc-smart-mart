// 📄 components/ui/SectionTitle.tsx — หัวข้อส่วน (section) ของหน้า Home/PreOrder
//    เดิมแต่ละส่วนเขียนหัวข้อเองคนละแบบ (text-xs uppercase gray-400 / text-sm extrabold gray-900 /
//    text-sm amber-600 ...) — รวมเป็นเสียงเดียว: แท่ง brand สั้น + ฟอนต์หัวข้อ Prompt + ข้อความ ink
//    มี slot ด้านขวาให้ใส่ลิงก์ "ดูทั้งหมด" ได้ (หัวข้อ+ลิงก์อยู่บรรทัดเดียวกันเสมอ)
interface SectionTitleProps {
  children: React.ReactNode;
  right?: React.ReactNode;
  accent?: string; // คลาสแท่งสีหน้าหัวข้อ (default = gradient แบรนด์)
  className?: string;
}

export function SectionTitle({ children, right, accent = 'bg-gradient-to-b from-brand to-brand-dark', className = '' }: SectionTitleProps) {
  return (
    <div className={`flex items-center justify-between gap-2 mb-2 ${className}`}>
      <h2 className="flex items-center gap-2 min-w-0">
        <span aria-hidden className={`shrink-0 w-1.5 h-4 rounded-full ${accent}`} />
        <span className="font-display text-sm font-bold text-ink truncate">{children}</span>
      </h2>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
