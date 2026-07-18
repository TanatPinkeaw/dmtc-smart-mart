# 🧪 Manual Testing Plan — Part 3-5 (23 Test Cases)

> Step-by-step testing guide before go-live

---

## 📋 **Test Environment Setup**

### Prerequisites
1. Backend running: `npm start` (port 3000)
2. Frontend running: `npm run dev` (port 5173)
3. MySQL running: all tables created
4. Test users created:
   ```
   ADMIN: admin / Admin123!
   CASHIER: cashier1 / Cashier123!
   MEMBER: member1 / Member123!
   ```
5. Test products in inventory:
   - กล่องน้ำดื่ม (100 stock)
   - ไก่ทอด (50 stock)
   - เบอร์เกอร์ (30 stock)
6. Internet connection: stable + ability to disconnect for offline testing

---

# **PART 3: POS CHECKOUT & SALES (7 Tests)**

## Test 3.1: Normal Checkout
**Objective**: Verify basic checkout flow works  
**Steps**:
1. Login as CASHIER (cashier1 / Cashier123!)
2. Click POS
3. Add 2x กล่องน้ำดื่ม (100฿) to cart
4. Add 1x ไก่ทอด (150฿) to cart
5. Total should show: ฿350.00
6. Select payment: "เงินสด" (cash)
7. Click "Checkout"

**Expected Result**: ✅
- Sale created successfully
- Receipt shows 3 items, ฿350.00
- Stock updated: กล่องน้ำดื่ม=98, ไก่ทอด=49
- Swal: "ชำระเงินเรียบร้อย (ID: [number])"
- Cart cleared
- Sale appears in Dashboard history

**If Failed**: Document error message

---

## Test 3.2: Checkout → Offline Scenario
**Objective**: Verify offline queue + retry on reconnect  
**Steps**:
1. Login as CASHIER
2. Add 1x เบอร์เกอร์ (200฿) to cart
3. **Disconnect internet** (airplane mode or unplug network)
4. Click "Checkout"
5. **Observe**: Should show yellow banner "ไม่มีการเชื่อมต่ออินเทอร์เน็ต"
6. **Reconnect internet** (wait 2-3 seconds)
7. **Observe**: Should show Swal "✅ Request succeeded"

**Expected Result**: ✅
- Offline banner appears when disconnected
- Request queued (not lost)
- Auto-retry on reconnect
- Sale created after reconnect
- Stock updated
- Swal shows success

**If Failed**: Check browser console for Socket.io errors

---

## Test 3.3: Insufficient Stock Error
**Objective**: Verify checkout rejects if stock < qty  
**Steps**:
1. Login as CASHIER
2. Manually add 51x ไก่ทอด to cart (edit in UI or DB)
   - OR: Try to add 100 units (stock is 50)
3. Click "Checkout"

**Expected Result**: ❌
- Swal error: "สินค้าไม่เพียงพอ"
- Shows table:
  ```
  ไก่ทอด: ขอ 51, มี 50
  ```
- Checkout cancelled
- Cart NOT cleared
- Stock NOT changed

**If Failed**: Bug in stock validation

---

## Test 3.4: Race Condition (Concurrent Checkout)
**Objective**: Verify atomicity when 2 cashiers checkout same product  
**Steps**:
1. **Setup**: กล่องน้ำดื่ม stock = 10
2. **Cashier 1**: Add 6x กล่องน้ำดื่ม, click Checkout (but DON'T confirm)
3. **Cashier 2** (new browser/incognito): Add 6x กล่องน้ำดื่ม, click Checkout
4. **Cashier 1**: NOW confirm Checkout
5. **Cashier 2**: Observe result

**Expected Result**: ✅
- **Cashier 1**: Checkout succeeds (sale created)
- **Cashier 2**: Gets error "409 ข้อขัดแย้ง" OR "ไม่เพียงพอ"
- **Stock**: Only 4 remaining (6 sold to Cashier 1, not 0)
- NO oversell (both transactions can't complete)

**If Failed**: Race condition not handled (critical bug)

---

## Test 3.5: Void Sale
**Objective**: Verify sale reversal returns stock  
**Steps**:
1. Create a sale: 2x กล่องน้ำดื่ม + 1x ไก่ทอด (note sale ID)
2. Check stock after sale: กล่องน้ำดื่ม=98, ไก่ทอด=49
3. Go to Dashboard
4. Find the sale you just created
5. Click "Void" button
6. Confirm

**Expected Result**: ✅
- Sale status changed to "VOIDED"
- Stock reverted: กล่องน้ำดื่ม=100, ไก่ทอด=50
- Audit log: "Void sale [ID]"
- Receipt printed/saved

**If Failed**: Stock not returned

---

## Test 3.6: Checkout Timeout (Slow Network)
**Objective**: Verify timeout error on slow backend  
**Steps**:
1. Open DevTools → Network → Throttle to "Slow 3G"
2. Login as CASHIER
3. Add items to cart
4. Click Checkout
5. Wait 30+ seconds

**Expected Result**: ✅
- After ~30 seconds: Swal error "Timeout"
- Option to "Retry" or "Cancel"
- Stock NOT deducted (timeout = no commit)
- Cart still has items

**If Failed**: No timeout, hangs forever

---

## Test 3.7: Duplicate Checkout (Idempotency)
**Objective**: Verify same checkout can't be charged twice  
**Steps**:
1. Create a sale (note sale ID = 123)
2. Immediately retry the same request (browser: Cmd+R or manually repeat POST with same idempotency-key)
3. Observe

**Expected Result**: ✅
- First attempt: Sale created (ID: 123)
- Second attempt: Returns cached response (same ID: 123)
- ONE sale total (not 2)
- Stock deducted once

**If Failed**: Duplicate sale created (critical)

---

# **PART 4: SHIFT WORKFLOW (8 Tests)**

## Test 4.1: Open Shift
**Objective**: Verify shift opens correctly  
**Steps**:
1. Login as CASHIER
2. Go to Shift page
3. Click "Open Shift"
4. Enter opening_cash = 5000
5. Click "Confirm"

**Expected Result**: ✅
- Swal: "ปิดกะเรียบร้อย" (or success message)
- Shift status: OPEN
- Opening cash: 5000
- Timestamp in Bangkok timezone (e.g., 14:30:45)

**If Failed**: Shift not created

---

## Test 4.2: Close Shift → Pending Approval
**Objective**: Verify close shift creates PENDING_CLOSE  
**Steps**:
1. Open shift (if not already open)
2. Do 2-3 sales (creates variance)
3. Click "Close Shift"
4. Enter actual_cash = 5200 (matches expected ≈ 5200)
5. Select discrepancy_category = "OTHER"
6. Enter notes = "Test close"
7. Click "Submit"

**Expected Result**: ✅
- Swal: "Close request submitted. Awaiting manager approval."
- Shift status: PENDING_CLOSE
- Actual cash: 5200
- Variance: calculated correctly
- Cart/POS cleared or message "Awaiting approval"

**If Failed**: Shift goes to CLOSED immediately (should wait for approval)

---

## Test 4.3: Manager Approve Shift Close
**Objective**: Verify manager can approve shift  
**Steps**:
1. **Cashier** closes shift (Test 4.2)
2. **Login as ADMIN** (new browser/incognito)
3. Go to Dashboard
4. Look for widget "Pending Shift Closes (1)"
5. Click on the pending shift
6. Click "✅ Approve"
7. Modal appears: "Confirm Approve"
8. Enter admin password (Admin123!)
9. Click "Approve"

**Expected Result**: ✅
- Swal: "Approved - Shift close approved"
- Shift status: CLOSED
- Variance displayed in red (if >100฿)
- Cashier notified (Socket.io event)
- Shift appears in history (no longer pending)

**If Failed**: Approval fails, admin can't override

---

## Test 4.4: Manager Reject Shift Close
**Objective**: Verify manager can reject and reopen shift  
**Steps**:
1. **Cashier** closes shift
2. **Login as ADMIN**
3. See pending close widget
4. Click "❌ Reject"
5. Enter reason = "Total doesn't match, please recount"
6. Click "Reject"

**Expected Result**: ✅
- Swal: "Rejected - Shift reopened for cashier correction"
- Shift status: OPEN (reverted)
- Actual_cash cleared
- Cashier notified: "Your shift close was rejected: [reason]"
- Cashier can re-do close attempt

**If Failed**: Shift stays closed, can't reopen

---

## Test 4.5: Variance Highlight (>100฿)
**Objective**: Verify high variance is flagged  
**Steps**:
1. Open shift: opening_cash = 5000
2. Create 1 sale: 200฿
3. Expected cash should be: ~5200
4. Close shift: actual_cash = 5350 (variance = 150฿, >100)
5. Admin approves

**Expected Result**: ✅
- In manager widget: variance "฿150.00" in RED (not green)
- Approval modal shows variance highlighted
- Audit log notes high variance
- Manager alerted

**If Failed**: High variance not highlighted

---

## Test 4.6: Close Shift Photo Upload
**Objective**: Verify photo upload validates dimensions  
**Steps**:
1. Open shift
2. Create 1 sale
3. Close shift
4. In close modal: click "Upload Photo"
5. Try to upload:
   - **First**: Small image (100×100) → should reject "Image too small"
   - **Second**: Valid image (1000×800) → should accept
6. Confirm close

**Expected Result**: ✅
- Invalid image: Error "Image too small (min 800×600)"
- Valid image: Uploaded + preview shown
- Close succeeds with photo attached

**If Failed**: No validation, any image accepted

---

## Test 4.7: Timezone Check (11:59 PM Bangkok)
**Objective**: Verify daily report includes today's shifts  
**Steps**:
1. Manually set system time to 11:59 PM Bangkok (23:59 +07:00)
2. Create shift + close it
3. Wait for cron to run (19:00 UTC = 2 AM Bangkok next day)
   - OR: Manually trigger: POST /api/reports/daily/send
4. Check Dashboard → Daily Report email
5. Verify today's shift is included

**Expected Result**: ✅
- Shift date: today (not yesterday due to timezone)
- Daily report sent at 6 AM Bangkok
- Shift appears in report

**If Failed**: Timezone calculation wrong, report missing shift

---

## Test 4.8: Backup Created & Restore
**Objective**: Verify automatic backup works  
**Steps**:
1. Go to BackupManagement page (ADMIN only)
2. Click "Create Backup Now"
3. Observe: New backup listed (status: SUCCESS)
4. Wait ~1 second
5. Note backup filename
6. Click "Restore" on that backup
7. Confirm: "Restore database from [filename]? This will overwrite current data!"
8. Confirm restore

**Expected Result**: ✅
- Backup created: coop-backup-YYYY-MM-DD.sql.gz
- File size shown (e.g., 2.5 MB)
- Restore succeeds: Swal "Restored from [filename]"
- Database unchanged (restored to itself)

**If Failed**: Backup not created, restore fails

---

# **PART 5: SECURITY & EDGE CASES (8 Tests)**

## Test 5.1: Token Refresh (Sliding Session)
**Objective**: Verify token auto-refreshes before expiry  
**Steps**:
1. Login as CASHIER (sets accessToken 15m, refreshToken 7d)
2. Open DevTools → Application → LocalStorage
3. Copy accessToken value
4. Wait 15 minutes (or mock time)
5. Make an API request (e.g., GET /api/products)

**Expected Result**: ✅
- First request: uses old accessToken
- Auto-refresh happens (interceptor)
- New accessToken stored
- Request succeeds
- NO login required (still logged in)

**If Failed**: Get 401 error, logged out

---

## Test 5.2: Password Policy on Registration
**Objective**: Verify weak passwords rejected  
**Steps**:
1. Go to Login → Register
2. Try password: "abc" → Click Register

**Expected Result**: ❌
- Error shown in PasswordStrengthMeter
- Message: "At least 8 characters"
- "At least 1 uppercase letter"
- "At least 1 number"
- Register button disabled or error on submit

**Then try**:
3. Password: "Password123" → Strength bar shows GOOD
4. Click Register → Should succeed

**Expected Result**: ✅
- Registration succeeds
- Strength meter shows ✅ for all criteria

**If Failed**: Weak password accepted, or valid password rejected

---

## Test 5.3: Change Password
**Objective**: Verify password change enforces policy  
**Steps**:
1. Login as CASHIER
2. Click profile menu → "Change Password"
3. Enter:
   - Current password: Cashier123!
   - New password: weak123 (weak)
   - Confirm: weak123
4. Click "Change Password"

**Expected Result**: ❌
- Error: "New password does not meet strength requirements"
- List missing: "At least 1 uppercase letter"

**Then retry**:
5. New password: NewPass456
6. Confirm: NewPass456
7. Click "Change Password"

**Expected Result**: ✅
- Swal: "Password changed successfully"
- Next login uses new password

**If Failed**: Weak password accepted, or can't change

---

## Test 5.4: File Upload Validation (Payment Slip)
**Objective**: Verify payment slip file validation  
**Steps**:
1. Go to PreOrder page → Create order → "Upload Payment Slip"
2. Try uploading:
   - **File 1**: Text file (test.txt) → Reject "Only JPG, PNG, GIF, WebP"
   - **File 2**: Large image (20 MB) → Reject "File too large (max 5 MB)"
   - **File 3**: Small image (100×100 px) → Reject "Image too small (min 400×300)"
   - **File 4**: Valid image (800×600) → Accept ✅

**Expected Result**: ✅
- Invalid files: Error message, not uploaded
- Valid file: Preview shown + "Upload Slip" button works
- Upload succeeds

**If Failed**: No validation, any file accepted

---

## Test 5.5: Pre-Order Offline + Retry
**Objective**: Verify pre-order queued when offline  
**Steps**:
1. **Disconnect internet**
2. Login as MEMBER (should work from cache)
3. Go to PreOrder
4. Create order: 1x กล่องน้ำดื่ม
5. Try to submit → Yellow banner "ไม่มีการเชื่อมต่อ"
6. **Reconnect internet**
7. Wait 2-3 seconds

**Expected Result**: ✅
- Request queued (not lost)
- Auto-retry on reconnect
- Order created on server
- Confirmation: "Order created successfully"

**If Failed**: Request lost, order not created

---

## Test 5.6: Concurrent Shift Closes (Dual-Control)
**Objective**: Verify only 1 shift can be closed at a time  
**Steps**:
1. **Cashier 1** (browser 1): Open shift A, do sales, click "Close Shift"
2. **Cashier 2** (browser 2): Open shift B, do sales, click "Close Shift"
3. Both submit close request
4. **Admin** (browser 3): See 2 pending closes in widget
5. Approve Shift A, then approve Shift B

**Expected Result**: ✅
- Both shifts pending in manager widget
- Both can be approved independently
- Audit log: 2 close attempts logged
- No race condition (both succeed)

**If Failed**: One closes without approval, or approve fails

---

## Test 5.7: Audit Log Filtering
**Objective**: Verify audit log tracks all actions  
**Steps**:
1. Do 5 different actions:
   - Checkout (create sale)
   - Void sale
   - Open shift
   - Close shift
   - Login
2. Go to Audit Log (ADMIN only)
3. Filter by:
   - Action = "CHECKOUT" → shows only checkouts
   - Date range = today → shows only today's actions
   - Search = "Sale ID" → finds that sale

**Expected Result**: ✅
- All 5 actions logged
- Filter works correctly
- Timestamps in Bangkok timezone (14:30:45)
- Amount formatted (฿350.00)
- User names correct

**If Failed**: Actions not logged, filter broken

---

## Test 5.8: Password Reset / Locked Out
**Objective**: Verify user can reset password if forgot  
**Steps**:
1. Try login with wrong password 5+ times
2. Should see: "Too many attempts, try again in 15 minutes"
3. Wait (or manual reset by ADMIN)
4. ADMIN goes to Settings → Users → Find user
5. Click "Reset Password"
6. Enter temp password
7. User logs in with temp password → Forced to change

**Expected Result**: ✅
- Rate limit prevents brute force
- Password reset works
- User forced to set new password on login
- New password must meet policy

**If Failed**: No rate limiting, reset broken, weak password accepted

---

# **SUMMARY: Test Results Checklist**

Copy this to verify completion:

```
PART 3: POS CHECKOUT (7/7)
☐ 3.1: Normal Checkout _____ (PASS/FAIL)
☐ 3.2: Offline + Retry _____ (PASS/FAIL)
☐ 3.3: Insufficient Stock _____ (PASS/FAIL)
☐ 3.4: Race Condition _____ (PASS/FAIL)
☐ 3.5: Void Sale _____ (PASS/FAIL)
☐ 3.6: Checkout Timeout _____ (PASS/FAIL)
☐ 3.7: Idempotency _____ (PASS/FAIL)

PART 4: SHIFT WORKFLOW (8/8)
☐ 4.1: Open Shift _____ (PASS/FAIL)
☐ 4.2: Close Shift Pending _____ (PASS/FAIL)
☐ 4.3: Manager Approve _____ (PASS/FAIL)
☐ 4.4: Manager Reject _____ (PASS/FAIL)
☐ 4.5: Variance Highlight _____ (PASS/FAIL)
☐ 4.6: Photo Upload _____ (PASS/FAIL)
☐ 4.7: Timezone Check _____ (PASS/FAIL)
☐ 4.8: Backup & Restore _____ (PASS/FAIL)

PART 5: SECURITY (8/8)
☐ 5.1: Token Refresh _____ (PASS/FAIL)
☐ 5.2: Password Policy _____ (PASS/FAIL)
☐ 5.3: Change Password _____ (PASS/FAIL)
☐ 5.4: File Upload Validation _____ (PASS/FAIL)
☐ 5.5: Offline + Retry _____ (PASS/FAIL)
☐ 5.6: Concurrent Shifts _____ (PASS/FAIL)
☐ 5.7: Audit Log Filtering _____ (PASS/FAIL)
☐ 5.8: Rate Limit & Reset _____ (PASS/FAIL)

TOTAL: ___/23 PASSED
CRITICAL ISSUES: _____ (List any bugs)
DEFER TO MONTH 2: _____ (Minor improvements)
```

---

## 🎯 **Bug Reporting Format**

If you find a bug during testing, report it like this:

```
BUG #: [number]
Severity: CRITICAL / HIGH / MEDIUM / LOW
Title: [brief title]

Steps to Reproduce:
1. [step 1]
2. [step 2]
...

Expected: [what should happen]
Actual: [what actually happened]

Screenshot: [attach if possible]

Error Log: [paste from console if applicable]

Assigned: [CLD to fix]
```

---

## ✅ **Ready to Test?**

Print this guide, grab a coffee, and start testing! ☕

Report issues here when found. Each bug fix = stronger system before go-live.

Estimated time: **2-3 days** to complete all 23 tests.

**Start with Test 3.1 (Normal Checkout) to verify setup works.** 🚀
