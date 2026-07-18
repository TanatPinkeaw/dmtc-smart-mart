import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_ORIGIN } from './config'; // ⭐️ DEPLOY FIX — URL จาก env แทนฮาร์ดโค้ด

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);

  // ⭐️ F4 — Listen for storage events (cross-tab token changes) and establish/update Socket connection
  useEffect(() => {
    const reconnectSocket = () => {
      const token = localStorage.getItem('accessToken');

      if (!token) {
        console.warn('No accessToken found, skipping Socket.io connection');
        if (socket) {
          socket.disconnect();
          setSocket(null);
        }
        return;
      }

      // Disconnect old socket if exists
      if (socket) {
        socket.disconnect();
      }

      const s = io(API_ORIGIN, {
        auth: { token },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      });

      s.on('connect', () => {
        console.log('✓ Socket.io connected successfully');
      });

      s.on('connect_error', (err) => {
        if (err.message === 'Missing JWT token' || err.message.includes('Invalid')) {
          console.error('Socket auth failed:', err.message);
        }
      });

      s.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
      });

      setSocket(s);
    };

    // Establish initial connection if token exists
    reconnectSocket();

    // Listen for storage events (handles login/logout from other tabs)
    window.addEventListener('storage', reconnectSocket);

    // Dispatch custom event for same-tab token changes
    const handleTokenChange = () => {
      console.debug('[Socket] Token changed, reconnecting...');
      reconnectSocket();
    };

    window.addEventListener('tokenChanged', handleTokenChange as EventListener);

    return () => {
      window.removeEventListener('storage', reconnectSocket);
      window.removeEventListener('tokenChanged', handleTokenChange as EventListener);
    };
  }, []);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
