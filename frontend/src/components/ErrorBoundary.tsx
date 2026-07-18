// ⭐️ Sprint 0 — B1: React Error Boundary. Class components ยังเป็นวิธีเดียวที่ React รองรับ
// error boundary (ยังไม่มี hook equivalent ที่ทำงานเหมือนกันทุกกรณี) — ก่อนหน้านี้ error ที่ throw
// ระหว่าง render (เช่น undefined.property, localStorage เพี้ยนแล้วโค้ดเก่าไม่ได้กัน) ทำให้ทั้งแอป
// unmount กลายเป็นจอขาว ไม่มีทางกู้คืนนอกจากผู้ใช้เดารีเฟรชเอง
import React, { ReactNode } from 'react';
import Swal from '../swal';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    // หมายเหตุ: ไม่ log ไป backend เพราะยังไม่มี endpoint สำหรับรับ client-side error log
    // (จะเพิ่มทีหลังได้ถ้าต้องการ monitoring แบบเต็ม — ตอนนี้ console.error + Swal.fire ก็พอสำหรับ Sprint 0)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white border border-red-300 rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
            <div className="text-4xl text-red-500 mb-4">⚠️</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">เกิดข้อผิดพลาด</h1>
            <p className="text-sm text-gray-600 mb-1">ระบบเกิดข้อผิดพลาดที่ไม่คาดคิด</p>
            <p className="text-xs text-gray-500 mb-6 font-mono break-all">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-[#F12B6B] hover:bg-[#FF467E] text-white font-semibold rounded-xl transition-all duration-150 active:scale-95"
            >
              รีเซ็ตแอปฯ
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
