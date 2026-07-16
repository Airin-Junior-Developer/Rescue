# Security Hardening — Design Spec

**Date:** 2026-07-16
**Status:** Approved (design phase) — pending implementation plan

## ปัญหา (Problem)

Rescue เป็นระบบแจ้งเหตุฉุกเฉินที่จัดการข้อมูลอ่อนไหว (พิกัด GPS, เบอร์โทร, บทสนทนาช่วยเหลือ) ของทั้งประชาชนและกู้ภัย จากการอ่านโค้ด `rescue-backend/server.js` พบช่องโหว่ 5 จุดที่ควรแก้ไขก่อนเรื่องอื่น เพราะกระทบความเป็นส่วนตัวและความน่าเชื่อถือของระบบโดยตรง:

1. CORS เปิดรับทุก origin แบบไม่มีเงื่อนไข
2. Endpoint แชท/สถานะของ citizen ไม่มีการยืนยันตัวตน (IDOR)
3. `JWT_SECRET` มีค่า fallback ฝังในโค้ด
4. Login ยังรองรับรหัสผ่านแบบ plaintext
5. ไม่มี rate limiting บน endpoint สาธารณะ

## ขอบเขต (Scope)

ทั้ง 5 เรื่องข้างต้นอยู่ใน spec เดียวกัน แก้เฉพาะฝั่ง `rescue-backend`, ผลกระทบฝั่ง frontend มีเฉพาะจุดที่ต้องส่ง/เก็บ citizen token เพิ่ม (ดูข้อ 2)

**นอกขอบเขต:** การจัดการ dispatch state ใน memory, การเก็บรูปภาพแชทเป็น base64, auto-migration แบบ `ALTER TABLE ... catch(()=>{})`, React key เป็น index — เรื่องเหล่านี้เป็นคนละหัวข้อ (ดูบันทึกการ brainstorm เดิมกลุ่ม B/C/D)

## การออกแบบ (Design)

### 1. CORS lockdown

**ปัญหาปัจจุบัน:** [server.js:23-34](../../../rescue-backend/server.js#L23-L34) — `cors()` middleware มี `callback(null, true)` เป็นบรรทัดสุดท้ายที่ยอมรับทุก origin ไม่ว่าจะผ่าน allowlist หรือไม่ (มี comment "Allow all for now during testing" กำกับไว้) และ Socket.io server ที่ [server.js:15](../../../rescue-backend/server.js#L15) ตั้ง `origin: '*'`

**การแก้ไข:**
- ลบ fallback `callback(null, true)` ออก เปลี่ยนเป็น `callback(new Error('Not allowed by CORS'))` เมื่อ origin ไม่ผ่านเงื่อนไข
- คงตรรกะเดิมไว้: allow ถ้าไม่มี origin (mobile/curl), อยู่ใน `allowedOrigins` array, หรือ endsWith `.vercel.app`/`.railway.app`
- Socket.io `cors.origin` ใช้ฟังก์ชันตรวจสอบเดียวกันกับ Express CORS แทนการเปิด `'*'`

### 2. Citizen per-incident token (แก้ IDOR)

**ปัญหาปัจจุบัน:** `/api/citizen/incidents/:id/chat` ([server.js:634](../../../rescue-backend/server.js#L634)) และ `/api/incidents/status/:id` ([server.js:687](../../../rescue-backend/server.js#L687)) ไม่ต้องยืนยันตัวตนเลย และ `incident_id` เป็นเลข auto-increment ที่ไล่เดาได้ นอกจากนี้ event `join_incident_room` ทาง Socket.io ([server.js:748](../../../rescue-backend/server.js#L748)) ก็ไม่มีการตรวจสอบเช่นกัน — จุดนี้สำคัญกว่า REST endpoint เพราะทำให้ใครก็ตามสามารถเข้าฟังแชทสดและตำแหน่ง GPS แบบ real-time ของเคสคนอื่นได้ทันทีที่รู้ (หรือเดา) `incident_id`

**การแก้ไข:**
- เพิ่มคอลัมน์ `citizen_token VARCHAR(64)` ในตาราง `incidents` (auto-migrate แบบเดียวกับคอลัมน์อื่นที่มีอยู่แล้ว)
- ตอนสร้าง incident (`POST /api/incidents`) ให้สุ่ม token (เช่น `crypto.randomUUID()`) เก็บลง DB พร้อม incident แล้วส่งกลับไปกับ response คู่กับ `incident_id`
- ฝั่ง frontend (`CitizenSOS.jsx`) เก็บ token นี้ไว้ใน `localStorage` คู่กับ `activeCitizenIncident` ที่มีอยู่แล้ว แล้วแนบไปกับทุก request ที่เกี่ยวกับ incident นั้น
- Backend ตรวจสอบ token ในสามจุด:
  - `GET /api/citizen/incidents/:id/chat` — ต้องมี token ตรงกัน ไม่ตรง = 403
  - `GET /api/incidents/status/:id` — เช่นเดียวกัน
  - `socket.on('join_incident_room', ...)` — event นี้ใช้ร่วมกันทั้งฝั่ง citizen (`CitizenSOS.jsx`) และฝั่ง driver/staff (`CommandCenter.jsx`) จึงตรวจสอบแบบเดียวไม่ได้ ต้องเปลี่ยน payload เป็น `{ incident_id, citizen_token }` (citizen) หรือ `{ incident_id, staff_token }` (driver/staff — ใช้ JWT เดิมที่มีอยู่แล้วใน `localStorage['token']`) แล้ว backend ตรวจสอบตามชนิดของ token ที่ส่งมา: ถ้ามี `citizen_token` ต้องตรงกับที่บันทึกไว้ใน incident, ถ้ามี `staff_token` ต้องผ่าน `jwt.verify()` เหมือน `verifyToken` middleware — ถ้าไม่มีทั้งสอง หรือ verify ไม่ผ่าน ปฏิเสธการ join ทั้งคู่ (payload ปัจจุบันที่ frontend ส่งคือ `socket.emit('join_incident_room', incident.id)` แบบ raw id ต้องเปลี่ยนเป็น object ทั้งสองฝั่ง)
- Endpoint ฝั่ง driver/staff (`/api/incidents/:id/chat` ที่ใช้ `verifyToken` JWT อยู่แล้ว) ไม่ต้องแก้ เพราะมี auth ผ่าน JWT อยู่แล้ว

### 3. ลบ JWT_SECRET fallback

**ปัญหาปัจจุบัน:** [server.js:37](../../../rescue-backend/server.js#L37) — `const JWT_SECRET = process.env.JWT_SECRET || 'rescue_super_secret_key';` ถ้าลืมตั้ง env var จะใช้ค่านี้แทนแบบเงียบๆ โดยไม่มีใครรู้

**การแก้ไข:** เปลี่ยนเป็น throw error ทันทีตอน server เริ่มทำงานถ้าไม่มี `JWT_SECRET`:
```js
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
const JWT_SECRET = process.env.JWT_SECRET;
```

### 4. ลบ plaintext password fallback

**ปัญหาปัจจุบัน:** [server.js:189](../../../rescue-backend/server.js#L189) — `const isMatch = user.password.startsWith('$2b$') ? await bcrypt.compare(...) : password === user.password;` ยอมรับการเทียบรหัสผ่านแบบ string ตรงๆ ถ้ารหัสไม่ใช่ bcrypt hash

**ยืนยันแล้วว่า:** บัญชี plaintext ทั้ง 4 บัญชี (`adminA`, `rescueA1`, `adminB`, `rescueB1` — ใช้รหัส `"password"` เหมือนกันหมด รวม 2 บัญชี Admin) เป็นบัญชี demo/test เท่านั้น ลบทิ้งได้เลย ไม่ใช่บัญชีใช้งานจริง

**การแก้ไข:**
- เปลี่ยน login logic ให้ใช้ `bcrypt.compare()` เพียงอย่างเดียว ตัด branch plaintext ออกทั้งหมด
- เพิ่มขั้นตอน manual cleanup (นอก code, ทำตอน deploy): ลบ 4 บัญชี demo ข้างต้นออกจาก DB ก่อน deploy การแก้ไขนี้ ไม่เช่นนั้นบัญชีเหล่านี้จะ login ไม่ได้อีกต่อไป (ซึ่งเป็นผลลัพธ์ที่ต้องการ)

### 5. Rate limiting

**การแก้ไข:** เพิ่ม dependency `express-rate-limit` และติดตั้ง middleware แยกตามความเสี่ยงของแต่ละ endpoint (per-IP):

| Endpoint | Limit |
|---|---|
| `POST /api/incidents` (แจ้ง SOS) | 5 ครั้ง / 10 นาที |
| `POST /api/login` | 10 ครั้ง / 15 นาที |
| `POST /api/citizen/auth`, `POST /api/citizen/register-phone`, `POST /api/rescuers/register` | 20 ครั้ง / 15 นาที |

เกินขีดจำกัด → ตอบ `429 Too Many Requests`

## การทดสอบ / Verification

- CORS: ยิง request จาก origin ที่ไม่อยู่ใน allowlist (เช่น `curl -H "Origin: https://evil.com"`) แล้วต้องโดนปฏิเสธ
- Citizen token: พยายามอ่าน `/api/citizen/incidents/:id/chat` โดยไม่มี token หรือ token ผิด ต้องได้ 403; ทดสอบ join `join_incident_room` โดยไม่มี token (ทั้ง citizen_token และ staff_token) ต้องถูกปฏิเสธ (ไม่ได้รับ event ในห้องนั้น); ทดสอบว่า driver ที่ login แล้วยัง join ห้องด้วย staff_token ได้ตามปกติ ไม่ถูกล็อกออกจาก flow เดิม
- JWT_SECRET: ลบ env var แล้วรัน server ต้อง crash ทันทีพร้อม error message ชัดเจน
- Plaintext password: ทดสอบ login ด้วยบัญชี demo เดิม (`adminA`/`password`) ต้อง fail หลังลบบัญชีและตัด fallback
- Rate limiting: ยิง request เกินขีดจำกัดในช่วงเวลาที่กำหนด ต้องได้ 429 ตัวที่เกิน

## Error Handling

- CORS rejection และ rate-limit 429 ควรส่ง error message ที่ไม่ leak รายละเอียดภายในระบบ (เช่นไม่บอกว่า origin ไหนอยู่ใน allowlist)
- Citizen token mismatch ตอบ 403 แบบ generic ("Unauthorized") ไม่บอกว่า incident นั้นมีอยู่จริงหรือไม่ เพื่อไม่ให้เดา incident_id ที่ valid ได้จากการสังเกตความต่างของ error response
