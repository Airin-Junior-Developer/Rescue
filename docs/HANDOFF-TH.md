# ติดตั้ง Rescue Connect สำหรับห้องเรียน

คู่มือนี้เริ่มจากเครื่องว่างและใช้บริการของสถาบันเอง เมื่อทำถึงขั้นที่ 3 จะเปิดเว็บเจ้าหน้าที่และเว็บ Admin ด้วยบัญชีทดลองได้ การสาธิตฝั่งประชาชนต้องตั้ง LINE ของสถาบันในขั้นที่ 4 ก่อน

## 1. เตรียมเครื่องและไฟล์ตั้งค่า

ใช้ Node.js 22.12 ขึ้นไปในสาย 22 พร้อม npm, Docker Engine หรือ Docker Desktop ที่มี Docker Compose และอินเทอร์เน็ตสำหรับดึงแพ็กเกจและ image คำสั่งด้านล่างใช้ Bash บน macOS, Linux หรือ WSL หากใช้ ZIP ให้แตกไฟล์แล้วเปิดเทอร์มินัลที่โฟลเดอร์ที่มี README หากดูแลผ่าน Git ให้ checkout สาขา `main` ของสำเนาที่สถาบันได้รับ หากใช้ Git clone ของ repo เดิมและเลือกโฮสต์ด้วย Render Blueprint ให้แก้ค่า LINE Login channel เดิมใน `render.yaml` ของสำเนาสถาบันก่อนนำไปใช้

คัดลอกตัวอย่างหนึ่งครั้งในการติดตั้งใหม่ หากมีไฟล์ตั้งค่าอยู่แล้ว ให้เปิดแก้ไฟล์เดิมเพื่อรักษาค่าไว้

```bash
cp -n rescue-backend/.env.example rescue-backend/.env
cp -n rescue-frontend/.env.example rescue-frontend/.env.local
cp -n rescue-web-admin/.env.example rescue-web-admin/.env.local
(cd rescue-backend && npm ci)
(cd rescue-frontend && npm ci)
(cd rescue-web-admin && npm ci)
```

| ไฟล์ที่แก้ | ค่าที่ต้องใส่ |
| --- | --- |
| `rescue-backend/.env` | สำหรับ Compose บนเครื่องเดียว ใช้ `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_NAME=rescue_demo`, `DB_USER=rescue_user` ใส่ `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD` และ `JWT_SECRET` ที่สุ่มแยกกันทั้งสามค่า ใช้คำสั่งด้านล่างสร้างค่าใหม่แต่ละครั้ง |
| `rescue-backend/.env` | ใช้ `PORT=3000`, `DB_SSL=false`, `REDIS_URL=redis://127.0.0.1:6379` สำหรับเครื่องห้องเรียน หากพอร์ต Redis ในเครื่องชน ให้ตั้ง `REDIS_PORT` เป็นพอร์ตว่างและแก้พอร์ตใน `REDIS_URL` ให้ตรงกัน |
| `rescue-frontend/.env.local` | `VITE_RESCUE_API_URL=http://127.0.0.1:3000` สำหรับทดสอบบนคอมพิวเตอร์เครื่องนี้ ตั้ง `VITE_LIFF_ID` เป็น LIFF ID ของสถาบันก่อนเปิดให้ประชาชนใช้ |
| `rescue-web-admin/.env.local` | `VITE_RESCUE_API_URL` ใช้ backend เดียวกับเว็บประชาชน |
| `rescue-backend/.env` สำหรับ LINE | `LINE_LOGIN_CHANNEL_ID` ใช้ยืนยันประชาชน ส่วน `LINE_CHANNEL_ACCESS_TOKEN` ใช้ส่งข้อความจาก OA เว้น token ว่างได้หากสาธิตเฉพาะสถานะในแอป |

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

เก็บไฟล์ตั้งค่าจริงและข้อมูลสำรองไว้กับผู้ดูแล ค่าที่ขึ้นต้นด้วย `VITE_` จะอยู่ใน JavaScript ที่ผู้เข้าชมดาวน์โหลดได้ ห้ามใส่รหัสฐานข้อมูล, channel access token หรือ JWT secret ไว้ในตัวแปรกลุ่มนี้

## 2. เริ่ม MySQL และ Redis แล้วสร้างบัญชีเดโม

จากโฟลเดอร์ราก เข้า `rescue-backend` แล้วใช้ชื่อ Compose project เดียวกันทุกคำสั่ง ชื่อ `rescue-classroom` ต้องเป็น project ใหม่สำหรับห้องเรียนนี้ MySQL จะอ่าน `schema.sql` และสร้างตารางว่าง 6 ตารางเฉพาะตอนเริ่มด้วย volume ใหม่

```bash
cd rescue-backend
docker compose -p rescue-classroom up -d
docker compose -p rescue-classroom ps
docker compose -p rescue-classroom exec redis redis-cli ping
docker compose -p rescue-classroom exec mysql mysql -u rescue_user -p rescue_demo -e 'SHOW TABLES;'
```

Redis ควรตอบ `PONG` ส่วน MySQL ให้กรอก `DB_PASSWORD` เมื่อโปรแกรมถาม รอจนเห็น `foundations`, `users`, `incidents`, `vehicles`, `citizens` และ `chat_messages` จึงรันคำสั่งต่อไปนี้ **ก่อนเปิด backend**

```bash
DEMO_SEED_CONFIRM=rescue_demo node scripts/seedDemoAccounts.js
```

คำสั่งนี้ทำงานเฉพาะฐานชื่อ `rescue_demo` ที่ทั้งหกตารางยังว่าง สร้างมูลนิธิสาธิตหนึ่งแห่งและบัญชีที่อนุมัติแล้วสี่บัญชี รหัสผ่านในฐานเก็บเป็น bcrypt hash หาก seed แจ้งว่ามีข้อมูล ให้ตรวจว่ากำลังชี้ฐานใด แล้วใช้ฐานใหม่สำหรับรอบติดตั้งใหม่ การเปิด backend ตามปกติจะไม่เรียก seed

| ชื่อผู้ใช้ | รหัสผ่านสำหรับห้องเรียน | หน้าที่ |
| --- | --- | --- |
| `demo.admin` | `RescueDemo!2026` | เข้าเว็บ Admin ดูสถานการณ์และอนุมัติเจ้าหน้าที่ |
| `demo.rescue1` | `RescueDemo!2026` | เจ้าหน้าที่หลักสำหรับรับงาน |
| `demo.rescue2` | `RescueDemo!2026` | เจ้าหน้าที่คนที่สองสำหรับสาธิตกำลังเสริม |
| `demo.rescue3` | `RescueDemo!2026` | เจ้าหน้าที่อีกเครื่องสำหรับทดลองแยก session |

รหัสชุดนี้เผยแพร่อยู่ใน Git ให้จำกัดการเข้าถึงระบบทดลองอยู่ในกลุ่มผู้สาธิต หากต้องเปิดเว็บไซต์ให้คนนอกใช้ ให้ตั้งฐานแยกพร้อมบัญชีและรหัสของสถาบันเอง **ประชาชนใช้ LINE จริง** จึงไม่มี username สำหรับผู้แจ้งในชุด seed

**ถ้ามี MySQL/Redis ของสถาบันอยู่แล้ว** ให้สร้างฐาน MySQL 8 แยกและผู้ใช้ที่มีสิทธิ์เฉพาะฐานนั้น นำเข้า `rescue-backend/schema.sql` ด้วย MySQL client เช่น `mysql -h HOST -P PORT -u USER -p rescue_demo < schema.sql` จากโฟลเดอร์ backend ตั้ง `DB_*` และ `REDIS_URL` ตามบริการจริง ใช้ Redis instance หรือ logical DB แยกเพราะระบบใช้ชื่อ key ร่วมกัน เมื่อใช้ MySQL ผ่าน TLS ให้ตั้ง `DB_SSL=true` และใส่ PEM ของ CA เต็มชุดใน `DB_SSL_CA` ค่า `MYSQL_ROOT_PASSWORD` ใช้เฉพาะ Compose อย่านำเข้า dump จากระบบเดิม

## 3. เปิดแอปและตรวจการเชื่อมต่อ

เปิดสามเทอร์มินัลแยกกัน เริ่มแต่ละคำสั่งจากโฟลเดอร์ราก

| เทอร์มินัล | คำสั่ง | วิธีตรวจ |
| --- | --- | --- |
| Backend | `cd rescue-backend && npm start` | เปิด `http://127.0.0.1:3000/api/foundations/public` ต้องเห็นชื่อมูลนิธิสาธิต และ log แสดงว่า Redis เชื่อมต่อแล้ว |
| เว็บประชาชนและเจ้าหน้าที่ | `cd rescue-frontend && npm run dev` | เปิด `https://127.0.0.1:5173/login` เข้าด้วย `demo.rescue1` ใบรับรองของ Vite เป็นใบรับรองทดสอบบนเครื่อง |
| เว็บ Admin | `cd rescue-web-admin && npm run dev` | เปิด `http://127.0.0.1:3002/login` เข้าด้วย `demo.admin` แล้วตรวจหน้าสถานการณ์ |

หยุด Node/Vite ด้วย Ctrl+C ในแต่ละเทอร์มินัล หยุด MySQL/Redis ด้วย `docker compose -p rescue-classroom stop` จากโฟลเดอร์ backend และเริ่มรอบต่อไปด้วย `docker compose -p rescue-classroom start` ข้อมูล MySQL อยู่ใน volume ของ project เดิม

## 4. ใช้ LINE และโทรศัพท์จริง

1. เตรียมเว็บประชาชนและ backend ที่โทรศัพท์เข้าถึงผ่าน HTTPS พร้อมใบรับรองที่อุปกรณ์เชื่อถือ ให้ proxy ของ API รองรับ Socket.IO ทั้ง HTTP polling และ WebSocket ที่ `/socket.io/` บนมือถือ `127.0.0.1` หมายถึงตัวโทรศัพท์เอง กำหนด `VITE_RESCUE_API_URL` ของเว็บทั้งสองเป็น HTTPS origin ของ API เช่น `https://api.example.edu` โดยไม่ต่อ `/api`
2. สำหรับโดเมนสถาบัน เพิ่ม **origin ของหน้าเว็บ** ทั้งสอง (scheme + host + port หากมี โดยไม่มี path หรือ slash ท้าย) ใน `allowedOrigins` ที่ `rescue-backend/corsConfig.js` แล้ว restart backend ค่านี้เป็นรายการ origin ในโค้ด คุมทั้ง Express และ Socket.IO ในโค้ดปัจจุบัน localhost ที่กำหนดและโดเมนย่อยของ `vercel.app` กับ `railway.app` มีรายการอนุญาตอยู่แล้ว
3. ที่ LINE Developers Console เลือก Provider ของสถาบัน สร้างหรือเลือก **LINE Login channel** ประเภท Web app จด Channel ID ใส่ `LINE_LOGIN_CHANNEL_ID` ใน backend ที่แท็บ LIFF เพิ่มแอป ตั้ง Endpoint URL เป็น HTTPS หน้าหลักของเว็บประชาชน เช่น `https://rescue.example.edu/` เลือก scopes `openid` และ `profile` แล้วนำ **LIFF ID** ใส่ `VITE_LIFF_ID` ในเว็บประชาชน โค้ดมีค่า LIFF เดิมเมื่อเว้นตัวแปรนี้ว่าง จึงต้องตั้งค่าของสถาบันอย่างชัดเจน [การลงทะเบียน LIFF](https://developers.line.biz/en/docs/liff/registering-liff-apps/)
4. เปิด **LIFF URL** ที่ Console ออกให้จากแอป LINE เช่น `https://liff.line.me/<LIFF_ID>` หากมี rich menu ให้ปุ่มแจ้งเหตุใช้ URL นี้ เมื่อเริ่มจาก LIFF ตัว SDK จะจัดการ redirect กลับ Endpoint URL แอปนี้ไม่มีเส้นทาง OAuth callback บน backend ให้กรอก ที่ LINE Login channel สถานะ Developing ให้เพิ่มผู้ทดสอบตามสิทธิ์ของ channel ก่อนทดลอง [ลำดับการเปิด LIFF](https://developers.line.biz/en/docs/liff/opening-liff-app/)
5. สำหรับแจ้งเตือนและ broadcast ให้สร้าง LINE Official Account ของสถาบัน เปิด Messaging API ใน OA Manager และเลือก **Provider เดียวกับ LINE Login** เพื่อให้ user ID ตรงกัน ออก channel access token ของ Messaging API แล้วใส่ใน `LINE_CHANNEL_ACCESS_TOKEN` ฝั่ง backend ให้ผู้สาธิตเพิ่ม OA เป็นเพื่อน โค้ดนี้ส่งข้อความออกโดยตรง ไม่มี webhook รับข้อความเข้า ปุ่ม broadcast ส่งถึงผู้ติดตามจริงของ OA ควรใช้ OA เฉพาะห้องเรียน [ตั้งค่า Messaging API](https://developers.line.biz/en/docs/messaging-api/getting-started/) · [การจับคู่ user ID](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/)
6. เมื่อแก้ไฟล์ env ให้ restart โปรแกรมที่เกี่ยวข้อง สำหรับโฮสต์เว็บ static ให้รัน `npm ci && npm run build` ในแต่ละโฟลเดอร์เว็บ นำ `dist/` ของแต่ละเว็บไปไว้คนละ origin และตั้ง SPA fallback ไป `index.html` เพื่อให้เปิด `/login` และ `/dashboard` โดยตรงได้ Backend รัน `npm ci` แล้ว `npm start` ใน `rescue-backend` พร้อม env ของบริการจริง

LINE ต้องเชื่อมอินเทอร์เน็ตเพื่อยืนยัน ID token และส่งข้อความ แผนที่ใช้ OpenStreetMap, ไอคอนภายนอก และบริการเส้นทาง OSRM ส่วนการจับคู่งานต้องให้ backend และ Redis ติดต่อกันได้ การติดตั้งนี้ไม่มีโหมด LINE ออฟไลน์

## 5. เพิ่มผู้ดูแลภายหลัง

Admin เพิ่มมูลนิธิและบัญชี Rescue ผ่านเว็บได้ เจ้าหน้าที่ที่สมัครเองที่ `/register` ต้องรออนุมัติ การสร้าง Admin ใช้ helper ใน backend เพื่อตรวจชื่อซ้ำและ ID มูลนิธิ แล้วสร้าง bcrypt hash และบันทึกผู้ใช้ใหม่ ใน Bash เปิดเทอร์มินัลที่ `rescue-backend` และหา ID จริงก่อน

```bash
docker compose -p rescue-classroom exec mysql mysql -u rescue_user -p rescue_demo -e 'SELECT id, name FROM foundations;'
read -rsp 'รหัสผ่าน Admin ใหม่ (อย่างน้อย 12 ตัว): ' admin_password
printf '\n'
printf '%s' "$admin_password" | node scripts/createAdmin.js --username teacher.admin --foundation-id 1 --password-stdin
unset admin_password
```

แทน `1` ด้วย ID ที่ตรวจแล้ว ทดสอบเข้าเว็บ Admin ในหน้าต่างส่วนตัวด้วยชื่อใหม่ ใช้ [คู่มือลำดับสาธิตและดูแลระบบ](DEMO-TH.md) สำหรับการเพิ่ม Rescue แบบฟอร์ม/CSV การแจ้งเหตุ การปิดเคส การสำรองและกู้คืน
