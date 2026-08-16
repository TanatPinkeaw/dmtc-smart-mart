// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 hooks/socketContext.ts — Context กลางสำหรับ socket.io instance (แยกไฟล์จาก provider
//    เพื่อให้ react-refresh ทำงาน: ไฟล์ component ต้อง export เฉพาะ component เท่านั้น)
// ═══════════════════════════════════════════════════════════════════════════════════
import { createContext } from 'react';
import type { Socket } from 'socket.io-client';

export const SocketContext = createContext<Socket | null>(null);
