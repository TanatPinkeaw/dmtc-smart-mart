// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 main.tsx — จุดเริ่มรันของ frontend (React entry point)
// ทำอะไร: หา <div id="root"> ใน index.html แล้ว render <App/> ลงไป ห่อด้วย ErrorBoundary (กันจอขาว
//   ถ้า component พัง) + StrictMode (React ช่วยเตือน bug ตอน dev) — ไฟล์นี้แทบไม่ต้องแก้
// ═══════════════════════════════════════════════════════════════════════════════════
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/common/ErrorBoundary' // ⭐️ Sprint 0 — B1

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
