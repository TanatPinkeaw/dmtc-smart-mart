// 📄 components/ui/fieldStyles.ts — คลาสฟอร์มมาตรฐาน (input/select) ใช้ซ้ำทั้งแอป
//    ทำอะไร: inputCls = ช่องกรอกมาตรฐาน (พื้น brand-bg + ขอบ brand-border + focus ring แบรนด์)
//    จุดสำคัญ: แต่ละหน้าที่ใช้ต้อง import จากนี้ ไม่นิยาม inputCls เอง (เคยมี 3 ไฟล์นิยามซ้ำ
//    กันเองโดย padding ต่างกัน: px-4 py-2.5 vs px-3 py-2) — ถ้าต้องการความกว้างต่อช่อง
//    ต่อท้าย className เอง เช่น `${inputCls} w-full`
export const inputCls =
  'px-3 py-2 bg-brand-bg border border-brand-border rounded-full text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand focus:bg-white transition-colors duration-150';

// ⭐️ ช่องกรองวันที่/ค้นหา (พื้นขาว + เงา) — ต่างจาก inputCls (พื้น brand-bg สำหรับฟอร์ม)
//    ใช้กับตัวกรองช่วงวันที่ (Summary month / AccountingSummary date range) — เดิม copy string ซ้ำ 2 ไฟล์
export const filterCls =
  'bg-white border border-brand-border rounded-full px-3 py-2 text-sm font-medium shadow-sm outline-none focus:ring-2 focus:ring-brand';
