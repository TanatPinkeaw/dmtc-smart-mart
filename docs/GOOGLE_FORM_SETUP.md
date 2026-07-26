# คู่มือ: Google Form เก็บรายชื่อสมาชิก → เข้าระบบ DMTC Mart

เก็บชื่อ + รหัสนักศึกษา + เบอร์โทรผ่าน Google Form → ลง Google Sheet → Apps Script ย้ายศิษย์เก่าออกเองตามรุ่น (ปวช. 3 ปี / ปวส. 2 ปี) → นำเข้าเป็นบัญชีสมาชิกใน DMTC Mart

---

## ภาพรวม (ทำงานยังไง)

```
[ Google Form ] --ตอบ--> [ Google Sheet: แท็บคำตอบ ]
                                  |
                     Apps Script (รันเดือนละครั้ง)
                                  |
              +-------------------+-------------------+
              |                                       |
   ย้ายคนที่จบแล้วไปแท็บ "ศิษย์เก่า"        สร้างแท็บ "รายชื่อสำหรับนำเข้าระบบ"
   (ปวช.>3ปี / ปวส.>2ปี)                    (3 คอลัมน์ พร้อมโหลดเป็น CSV)
                                                      |
                                          ดาวน์โหลด CSV แล้วนำเข้าที่
                                    DMTC Mart → ตั้งค่า → พนักงาน → นำเข้า CSV
```

> ระบบนำเข้าเป็นแบบ **full-sync**: ใครไม่อยู่ในไฟล์ CSV จะถูก **ปิดการใช้งานอัตโนมัติ** — พอ Apps Script ย้ายศิษย์เก่าออกจากแท็บ active แล้ว การนำเข้ารอบถัดไปจะปิดบัญชีคนที่จบให้เองโดยอัตโนมัติ

---

## ขั้นที่ 1 — สร้าง Google Form

ไปที่ [forms.google.com](https://forms.google.com) สร้างฟอร์มใหม่ ใส่คำถาม **6 ข้อ ตามลำดับนี้** (สำคัญ: ต้องมีครบ ชื่อคำถามต้องตรงตามนี้เพราะสคริปต์ใช้คำพวกนี้หาคอลัมน์):

| # | คำถาม | ชนิด | ตัวเลือก / คำอธิบายที่ใส่ในฟอร์ม |
|---|-------|------|------------------------------------|
| 1 | แผนก | ดรอปดาวน์ | ใส่รายชื่อแผนกที่วิทยาลัยเปิดสอนจริง (แก้ตามจริงของ DMTC) |
| 2 | ระดับชั้น | ดรอปดาวน์ | **ปวช.1 / ปวช.2 / ปวช.3 / ปวส.1 / ปวส.2** (ต้องมีเลขชั้นปีต่อท้ายเป๊ะแบบนี้) |
| 3 | คำนำหน้า | หลายตัวเลือก | **นาย / นางสาว** |
| 4 | ชื่อ-นามสกุล | คำตอบสั้น | คำอธิบาย: "กรอกชื่อและนามสกุลจริง ไม่ต้องใส่คำนำหน้า เว้นวรรค 1 ครั้งระหว่างชื่อกับนามสกุล เช่น สมชาย ใจดี" |
| 5 | รหัสนักศึกษา | คำตอบสั้น | |
| 6 | เบอร์โทรศัพท์ | คำตอบสั้น | คำอธิบาย: "ตรวจสอบเบอร์ให้ถูกต้องก่อนส่ง — เบอร์นี้เป็นรหัสผ่านเข้าใช้งานระบบครั้งแรก" |

**ทุกข้อเปิด "จำเป็น (Required)"**

> **ทำไมต้องมีรหัสนักศึกษา:** มันคือ username ที่นักเรียนใช้ล็อกอิน DMTC Mart และเป็นตัวระบุตัวตนไม่ให้ซ้ำ — ขาดไม่ได้
> **ทำไมไม่มีช่อง "ปีที่เข้าเรียน" แล้ว:** ไม่จำเป็น — สคริปต์คำนวณเองจาก **ระดับชั้นที่เลือก + วันที่ตอบฟอร์ม** (Google Form บันทึกวันที่ตอบให้อัตโนมัติในคอลัมน์แรกอยู่แล้ว) แม่นกว่าและกรอกน้อยลง
> **เบอร์โทร แนะนำเพิ่ม Response validation:** ที่คำถามเบอร์โทร → จุด 3 จุด → การตรวจสอบคำตอบ → ข้อความสั้น + นิพจน์ทั่วไป + ตรงกับ → `^0[0-9]{9}$` → ข้อความเตือน "กรอกเบอร์ 10 หลัก ขึ้นต้นด้วย 0"

## ขั้นที่ 2 — เชื่อมฟอร์มกับ Sheet

ในฟอร์ม แท็บ **การตอบกลับ (Responses)** → กดไอคอน Google Sheets (สีเขียว) → **สร้างสเปรดชีตใหม่** — คำตอบทั้งหมดจะไหลลงชีตนี้อัตโนมัติ

## ขั้นที่ 3 — ติดตั้ง Apps Script (ตัวย้ายศิษย์เก่า)

1. เปิด Google Sheet ที่เพิ่งสร้าง → เมนู **ส่วนขยาย (Extensions) → Apps Script**
2. ลบโค้ดเดิมทิ้ง วางโค้ดด้านล่างนี้แทน
3. **แก้บรรทัด `SHEET_ACTIVE`** ให้ตรงกับชื่อแท็บคำตอบจริง (ปกติชื่อ `การตอบกลับแบบฟอร์ม 1` หรือ `Form Responses 1` — ดูที่แท็บล่างของ Sheet)
4. กด **บันทึก** (ไอคอนแผ่นดิสก์)

```javascript
// ===== ตั้งค่า =====
const SHEET_ACTIVE = 'Form_Responses'; // ⚠️ แก้ให้ตรงชื่อแท็บคำตอบจริง (ของโปรเจกต์นี้คือ Form_Responses)
const SHEET_ALUMNI = 'ศิษย์เก่า';
const SHEET_IMPORT = 'รายชื่อสำหรับนำเข้าระบบ';
const YEARS_PVCH = 3; // ปวช. เรียนทั้งหมด 3 ปี
const YEARS_PVS  = 2; // ปวส. เรียนทั้งหมด 2 ปี

// หา index คอลัมน์จากคำในหัวตาราง (ยืดหยุ่น ไม่ต้องอิงลำดับเป๊ะ)
function _col(headers, keyword) {
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).indexOf(keyword) >= 0) return i;
  }
  return -1;
}
function _thaiYearNow() { return new Date().getFullYear() + 543; }
function _thaiYearOf(dateVal) {
  const d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
  return d.getFullYear() + 543;
}
// แยก "ปวช.2" -> { base:'ปวช', num:2 }
function _parseLevel(text) {
  const s = String(text || '');
  const base = s.indexOf('ปวส') >= 0 ? 'ปวส' : 'ปวช';
  const m = s.match(/[0-9]+/);
  const num = m ? parseInt(m[0], 10) : 1;
  return { base: base, num: num };
}

// ★ ฟังก์ชันหลัก: ย้ายคนที่จบแล้วไปแท็บศิษย์เก่า
function archiveGraduates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const active = ss.getSheetByName(SHEET_ACTIVE);
  if (!active) throw new Error('ไม่พบแท็บ "' + SHEET_ACTIVE + '" — แก้ค่า SHEET_ACTIVE ให้ตรง');

  const data = active.getDataRange().getValues();
  if (data.length < 2) return; // ไม่มีข้อมูล
  const headers = data[0];
  const cLevel = _col(headers, 'ระดับ');
  if (cLevel < 0) throw new Error('หาคอลัมน์ "ระดับชั้น" ไม่เจอ');

  let alumni = ss.getSheetByName(SHEET_ALUMNI);
  if (!alumni) { alumni = ss.insertSheet(SHEET_ALUMNI); alumni.appendRow(headers); }

  const nowY = _thaiYearNow();
  // เดินจากแถวล่างขึ้นบน กันลบแล้ว index เพี้ยน
  for (let r = data.length - 1; r >= 1; r--) {
    const lv = _parseLevel(data[r][cLevel]);               // เช่น ปวช.2 -> {base:'ปวช', num:2}
    const total = lv.base === 'ปวส' ? YEARS_PVS : YEARS_PVCH;
    const yearsLeft = total - (lv.num - 1);                 // เหลืออีกกี่ปีจะจบ นับจากวันตอบฟอร์ม
    const submitY = _thaiYearOf(data[r][0]);                // คอลัมน์แรก = ประทับเวลา (Google ใส่ให้เอง)
    const gradYear = submitY + yearsLeft;
    if (nowY >= gradYear) {
      alumni.appendRow(data[r]);   // ย้ายไปศิษย์เก่า
      active.deleteRow(r + 1);     // ลบจาก active (+1 เพราะแถว sheet เริ่มที่ 1)
    }
  }
  buildImportSheet(); // อัปเดตแท็บนำเข้าให้ล่าสุดเสมอ
}

// ★ สร้าง/อัปเดตแท็บ 3 คอลัมน์ พร้อมโหลดเป็น CSV เข้า DMTC Mart
function buildImportSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const active = ss.getSheetByName(SHEET_ACTIVE);
  const data = active.getDataRange().getValues();
  const headers = data[0];
  const cId = _col(headers, 'รหัส');
  const cName = _col(headers, 'ชื่อ');       // จับคอลัมน์ "ชื่อ-นามสกุล"
  const cPrefix = _col(headers, 'คำนำหน้า');
  const cPhone = _col(headers, 'เบอร์');

  let imp = ss.getSheetByName(SHEET_IMPORT);
  if (!imp) imp = ss.insertSheet(SHEET_IMPORT); else imp.clear();

  const rows = [];
  for (let r = 1; r < data.length; r++) {
    const id = String(data[r][cId] || '').trim();
    if (!id) continue;
    const prefix = cPrefix >= 0 ? String(data[r][cPrefix] || '').trim() : '';
    const name = String(data[r][cName] || '').trim();
    const fullName = (prefix ? prefix + ' ' : '') + name;   // "นาย สมชาย ใจดี"
    let phone = String(data[r][cPhone] || '').trim();
    if (phone && !phone.startsWith('0')) phone = '0' + phone; // pad 0 ถ้าหายไป
    rows.push([id, fullName, phone]);
  }

  // ★ ต้องตั้ง format คอลัมน์ C เป็น Plain Text "ก่อน" ใส่ค่า ไม่งั้น Sheets จะตัด 0 หน้าทิ้งอีกรอบ
  const totalRows = Math.max(rows.length, 1) + 1; // +1 สำหรับหัวตาราง
  imp.getRange(1, 1, totalRows, 3).setNumberFormat('@');
  imp.getRange(1, 1, 1, 3).setValues([['username', 'full_name', 'phone_number']]);
  if (rows.length > 0) {
    imp.getRange(2, 1, rows.length, 3).setValues(rows);
  }
}

// ★ ตั้งให้รันอัตโนมัติทุกวันที่ 1 ของเดือน ตี 2 (รันครั้งเดียวพอ)
function createMonthlyTrigger() {
  ScriptApp.newTrigger('archiveGraduates').timeBased().onMonthDay(1).atHour(2).create();
}
```

## ขั้นที่ 4 — เปิดใช้งานอัตโนมัติ + ทดสอบ

1. ในหน้า Apps Script เลือกฟังก์ชัน **`createMonthlyTrigger`** จากดรอปดาวน์บนสุด → กด **เรียกใช้ (Run)** ครั้งเดียว (ครั้งแรกจะขออนุญาตเข้าถึง Sheet → กดอนุญาต) — จากนี้สคริปต์จะรันเองทุกวันที่ 1 ของเดือน
2. ทดสอบเดี๋ยวนี้: เลือกฟังก์ชัน **`archiveGraduates`** → กด Run — แล้วดูว่ามีแท็บ `ศิษย์เก่า` กับ `รายชื่อสำหรับนำเข้าระบบ` โผล่ขึ้นมาไหม

## ขั้นที่ 5 — นำเข้า DMTC Mart

ทำเมื่อต้องการอัปเดตรายชื่อสมาชิกเข้าระบบ (เช่น เดือนละครั้ง หลังสคริปต์รัน):

1. เปิด Sheet → คลิกแท็บ **`รายชื่อสำหรับนำเข้าระบบ`** ให้ active
2. เมนู **ไฟล์ (File) → ดาวน์โหลด → CSV** (ได้ไฟล์ 3 คอลัมน์: username, full_name, phone_number)
3. เข้า DMTC Mart → **ตั้งค่า → พนักงาน/สิทธิ์ → ปุ่ม "นำเข้า CSV"** → เลือกไฟล์
4. ระบบจะแสดงตัวอย่างก่อน (เพิ่มใหม่กี่คน / ปิดใช้งานกี่คน) → กดยืนยัน
   - สมาชิกใหม่: สร้างบัญชี role MEMBER, **รหัสผ่านเริ่มต้น = เบอร์โทร**
   - คนที่จบ (ถูกย้ายไปศิษย์เก่าแล้ว ไม่อยู่ในไฟล์): ระบบปิดการใช้งานให้อัตโนมัติ

---

## เกร็ด / ปรับแต่ง

- **อยากลบทิ้งจริงแทนย้ายศิษย์เก่า:** ในฟังก์ชัน `archiveGraduates` ลบบรรทัด `alumni.appendRow(data[r]);` ออก (เหลือแค่ `active.deleteRow`) — แต่แนะนำเก็บไว้ ปลอดภัยกว่า
- **เกณฑ์ปีไม่ตรง:** แก้ค่า `YEARS_PVCH` / `YEARS_PVS` ด้านบนสุดของสคริปต์
- **แผนก (คอลัมน์แรก) ยังไม่ import เข้าระบบ:** เก็บไว้ใน Sheet เพื่ออ้างอิง/แยกรุ่นเท่านั้น เพราะ DMTC Mart ยังไม่มีฟิลด์แผนกในบัญชีผู้ใช้ — ถ้าอยากเพิ่มฟิลด์นี้เข้าระบบจริง บอกได้ แก้ที่ตาราง `users` + endpoint นำเข้า CSV เพิ่มได้
- **นักเรียนกรอกระดับชั้นผิด (เช่น ปวช.4 ที่ไม่มีจริง):** สคริปต์จะ parse เลขจากข้อความ ถ้าเกินขอบเขตจะถูกตีความว่าจบไปแล้วทันทีรอบถัดไป ควรล็อกดรอปดาวน์ในฟอร์มให้เลือกได้แค่ 5 ค่าที่กำหนดเท่านั้น กันกรอกเอง
- **กันเบอร์/รหัสซ้ำ:** ระบบ DMTC Mart กันรหัสนักศึกษาซ้ำอยู่แล้ว (student_id unique) ถ้ามีคนกรอกฟอร์มซ้ำ ตอนนำเข้าจะไม่สร้างบัญชีซ้ำ
- **ความเป็นส่วนตัว:** Sheet นี้มีเบอร์โทรนักเรียน — จำกัดสิทธิ์การเข้าถึงเฉพาะผู้ดูแล อย่าตั้งเป็น "ทุกคนที่มีลิงก์ดูได้"

---

## ต่อยอด (ถ้าอยากได้ทีหลัง)

ตอนนี้เป็นแบบ **โหลด CSV แล้วนำเข้าเอง** (ง่าย ไม่ต้องต่อ API) — ถ้า deploy ระบบขึ้นออนไลน์แล้ว อยากให้ Apps Script **ส่งเข้าระบบอัตโนมัติ** (ไม่ต้องโหลด CSV) บอกได้ ผมทำ endpoint รับข้อมูล + โค้ด `UrlFetchApp` ฝั่ง Apps Script ให้เพิ่ม
