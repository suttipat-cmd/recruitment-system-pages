# ติดตั้ง Recruitment System V4.0.0

ใช้โค้ดในชุดนี้แทน Boilerplate ทั้งชุด ไม่คัดเฉพาะไฟล์หน้าแรก โฟลเดอร์ api, web, supabase, sql, scripts, examples, src และ tests ต้องอยู่ครบ

## 1. เจ้าของ Supabase ติดตั้งฐานข้อมูล

1. เปิดโปรเจกต์ Supabase ที่ URL ตรงกับค่า SUPABASE_URL ใน GitHub Actions Variables
2. เปิด SQL Editor → New query
3. คัดลอกไฟล์ `supabase/migrations/20261019120728_recruitment_system_v4.sql` ทั้งไฟล์ แล้ว Run หนึ่งครั้ง
4. ไฟล์สร้าง schema rm_private ใหม่ ตารางและฟังก์ชันทั้งหมดทำใน transaction หาก error จะ rollback ไม่ล้างตาราง items หรือข้อมูล Google เดิม หากแจ้ง relation already exists ให้หยุดและตรวจว่าเคยติดตั้งแล้ว ห้ามลบ schema เพื่อแก้โดยไม่มี backup
5. ใช้ exposed schema ของ Data API เป็น public ตามเดิม **ไม่เพิ่ม rm_private**
6. Storage จะมี bucket `recruitment-documents` แบบ private อัตโนมัติ

ถ้าใช้ Supabase CLI ที่ผูกโครงการนี้อยู่แล้ว ให้จัด migration history ให้ตรงแทนการรัน SQL Editor ซ้ำ ไฟล์ migration สร้างด้วย Supabase CLI และทดสอบบน PostgreSQL/PGlite แล้ว แต่ยังต้องตรวจ Auth/Storage จริงหลังติดตั้ง

## 2. สร้าง Admin คนแรก

1. Supabase → Authentication → Users → Add user → Create new user
2. ใส่อีเมล Admin และรหัสผ่านที่ตั้งเอง (แนะนำอย่างน้อย 12 ตัว) ให้บัญชียืนยันอีเมลแล้วตามวิธีที่เลือก
3. เปิด `sql/bootstrap-admin.sql` เปลี่ยน `REPLACE_WITH_ADMIN_EMAIL` เป็นอีเมลนั้น
4. รันไฟล์ใน SQL Editor คำสั่งจะหยุดถ้ามี Admin แล้วหรือยังไม่พบ Auth user
5. รัน `sql/verify-install.sql` ตรวจ private tables with RLS = 11, active_admins อย่างน้อย 1 และ bucket public = false

ไม่มี username/password ตั้งต้นร่วมกัน และไม่มี endpoint เปิดสิทธิ์ Admin ด้วยตนเอง

## 3. Supabase Authentication

- Authentication → URL Configuration: ตั้ง Site URL เป็น `https://suttipat-cmd.github.io/recruitment-system-pages/`
- เพิ่ม Redirect URLs สำหรับโดเมนหลัก และ http://localhost:3000/ หากทดสอบในเครื่อง
- สำหรับ email/password ภายในองค์กร ให้ปิดการสมัครบัญชีทั่วไปผ่าน Email provider หากไม่ต้องการ public signup (แบบสมัครงาน #apply ไม่ได้สร้าง Auth user)
- ตั้ง SMTP ก่อนใช้งานลืมรหัสผ่านจริง ค่า SMTP เริ่มต้นของ Supabase มีข้อจำกัด
- อย่าใส่ role หรือสิทธิ์ใน user_metadata ระบบนี้ไม่ใช้ข้อมูลนั้นตัดสินสิทธิ์

## 4. GitHub Pages

1. Settings → Secrets and variables → Actions → Variables เพิ่ม SUPABASE_URL และ SUPABASE_ANON_KEY
2. Settings → Pages → Source เลือก GitHub Actions
3. Actions → Publish Recruitment to GitHub Pages → Run workflow
4. เปิด https://suttipat-cmd.github.io/recruitment-system-pages/
5. Supabase Authentication → Redirect URLs เพิ่ม URL ข้างต้นรวม / ท้าย

ไม่มี API server บน Pages จึงสร้าง config.json ระหว่าง build ซึ่งมีเพียง URL และ anon/publishable key ห้ามใส่ service_role ข้อมูลใบสมัครไม่อยู่ใน Repo

## 5. ตั้งค่าผู้ใช้และเริ่มงาน

1. Login ด้วย Admin
2. ตั้งค่าระบบ → สร้างหน่วยงานเพิ่มหากต้องการ
3. เจ้าของสร้างผู้ใช้ใน Supabase Authentication ก่อน แล้ว Admin เพิ่มสิทธิ์ในหน้าเว็บด้วยอีเมลเดียวกัน
4. กำหนดหน่วยงานให้หัวหน้างาน (บังคับ) ส่วน Coach มอบหมายตามรายพนักงานหลังรับงาน
5. เพิ่มหัวข้ออบรม / ลิงก์ Sheet, Drive, Form เดิม
6. เปิดรับสมัครออนไลน์เมื่อพร้อม แชร์ `https://โดเมน/#apply`
7. ทดสอบตาม USER-MANUAL.md ตั้งแต่ใบสมัครจนเริ่มงานและอบรมด้วยบัญชีแต่ละ Role

## ตรวจปัญหา

- หน้าเดิมยังอยู่: Output Directory ต้องเป็น dist และ Repo/commit ต้องเป็นชุดใหม่
- หา recruitment_command ไม่พบ: ยังไม่ได้รัน migration หรือกำลังใช้ Supabase คนละโปรเจกต์
- Login ผ่านแต่ไม่มีสิทธิ์: ยังไม่มี profile/ถูกปิด/ใช้อีเมลไม่ตรง ใช้ bootstrap เฉพาะ Admin คนแรก
- ไฟล์อัปโหลดไม่ได้: ตรวจ bucket private, policy, user profile active และขนาด/MIME
- ลิงก์ลืมรหัสผ่านไม่มา: ตรวจ SMTP, อีเมล, redirect allow list และ Auth logs
- api/items ขึ้น 410: เป็นพฤติกรรมใหม่ที่ตั้งใจ ปิด public demo แล้ว ใช้หน้า Login และ workflow จริง

## ก่อนสลับจาก GAS

ตกลงวันตัดระบบและสำรอง Google Sheet/Drive เก่า บัญชีและข้อมูลย้อนหลังไม่ถูกนำเข้ามาเอง ใช้แบบสมัครใหม่สำหรับข้อมูลใหม่ ห้ามคาดหวังว่า Google Form เดิมจะซิงก์เข้า Supabase โดยอัตโนมัติ เก็บ GAS เดิมสำหรับตรวจประวัติจนกว่าจะจัดโครงการย้ายข้อมูลย้อนหลังครบ

## เฟสเอกสาร
รุ่น Pages พักการแนบ/เปิดเอกสาร ไม่ต้องเปิดแชร์ไฟล์เดิมเป็นสาธารณะ
