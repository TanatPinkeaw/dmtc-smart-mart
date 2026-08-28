# แผนงานต่อ — Freebuff Desktop

อัปเดตล่าสุด: 2026-08-28 (bug fixes + POS Admin UI migration)

## สถานะปัจจุบัน

### ระบบที่เสร็จแล้ว (อย่าทำซ้ำ)
- Quick Wins & Cleanup (Phase 1)
- Production Verification (Phase 2)
- Foundational Safety Net (Phase 3): CI, smoke test, schema.sql
- Feature Completion (Phase 4): backup email, Cloudinary
- Security Hardening (Phase 5): npm audit 0, Dockerfile guard, DB_SSL_CA validation
- Backend refactor: error responses (162 จุด), SQL helpers (14 จุด), audit logs (24 จุด), HTTP helpers (6 ตัว)
- UI consistency: Button/Modal/InlineAlert/SegmentedControl/EmptyState/Skeleton/ProductCard — contract ล็อก 44+ เช็ค
- Multi-tenant POS Admin panel (CRUD + Route Guard + Dashboard Charts)
- POS Admin Hardening: audit logging (10 endpoints), Joi validation (7 schemas), contract tests (120 เช็ค)
- Connection pool tuning: tenant pool 20, master pool 10, pool eviction on soft delete
- POS Admin UI migration: ทุกหน้าใช้ UI primitives กลางแล้ว
- Bug fixes: lineWebhookController req.db scope, PosAdminLogin Button component

### ระบบที่ทดสอบผ่าน (ล่าสุด 2026-08-28)
| ฝั่ง | ผลลัพธ์ |
|------|---------|
| Backend | 14/14 ชุดผ่าน (53 เช็ค multi-tenant + 67 เช็ค pos-admin) |
| Frontend | 158 tests pass, typecheck clean, build pass |

## สิ่งที่ยังค้างอยู่

### 1. Production Deployment (สำคัญสุด)

**Env vars ที่ต้องตั้งบน Render:**

| Env Var | ค่าจาก | สถานะ |
|---------|--------|-------|
| MASTER_DB | Aiven | ตั้งแล้ว |
| DB_SSL_CA | Aiven console > Download CA Certificate | ยังไม่ตั้ง |
| JWT_SECRET | สุ่มเอง | ตั้งแล้ว |
| SETUP_KEY | สุ่มเอง | ตั้งแล้ว |
| CLOUDINARY_CLOUD_NAME | Cloudinary | ตั้งแล้ว |
| CLOUDINARY_API_KEY | Cloudinary | ตั้งแล้ว |
| CLOUDINARY_API_SECRET | Cloudinary | ตั้งแล้ว |
| SMTP_HOST/PORT/USER/PASS/FROM | Gmail | ตั้งแล้ว |
| ADMIN_EMAIL | Gmail | ตั้งแล้ว |
| LINE_CHANNEL_ACCESS_TOKEN | LINE Developers Console | ลบ quote ออก |
| LINE_CHANNEL_SECRET | LINE Developers Console | ตั้งแล้ว |
| ALLOW_DATA_RESET | ตั้ง false ใน production | ปัจจุบัน true |

**Env vars ที่ต้องตั้งบน Vercel:**

| Env Var | ค่า | สถานะ |
|---------|-----|-------|
| VITE_API_URL | https://dmtc-mart-api.onrender.com | ยังไม่ตั้ง |
| VITE_LIFF_ID | 2010928001-sEGaB0XN | ตั้งแล้ว |

### 2. LINE Bot Setup
- Webhook URL: https://dmtc-mart-api.onrender.com/api/line/webhook
- เปิด Use webhook (ON)
- LINE_MANAGER_GROUP_ID — ยังไม่ได้ตั้ง (แจ้งเตือนสต๊อกใกล้หมดจะ log ลง console แทน)

### 3. Future improvements
- Tenant provisioning smoke test
- POS Admin rate limiting (ปัจจุบันไม่มี login rate limit)
- Performance testing (100+ concurrent users)

## Bug ที่แก้แล้ว (2026-08-28)

1. CRITICAL: lineWebhookController.js — findUserByLine/handlePreorderStatus/handlePromotions ใช้ req.db แต่ req ไม่ได้ส่งเข้ามา → ReferenceError ทุกครั้งที่ LINE ส่ง webhook → แก้โดย thread db ผ่าน function chain
2. PosAdminLogin.tsx — Login button ยังใช้ raw bg-gradient-to-r → เปลี่ยนเป็น Button variant=primary
3. posAdminRoutes.js — Duplicate if (!name) check ที่ Joi validator ตรวจอยู่แล้ว → ลบออก
