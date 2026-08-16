// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 hooks/useSocket.ts — hook อ่าน socket instance ปัจจุบันจาก context (แยกจาก SocketContext.tsx
//    ให้ไฟล์ component export เฉพาะ component — react-refresh/only-export-components)
// ═══════════════════════════════════════════════════════════════════════════════════
import { useContext } from 'react';
import { SocketContext } from './socketContext';

export function useSocket() {
  return useContext(SocketContext);
}
