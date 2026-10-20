## V4.7.0: ตารางผู้สมัครพร้อมตัวกรอง

ฐานที่ติดตั้ง V4.4–V4.6 แล้ว ให้ติดตั้ง `supabase/migrations/20261020130620_applicant_list_workspace_v47.sql` ก่อนใช้หน้าเว็บ V4.7 คำสั่งตรวจรูปแบบฟังก์ชันเดิมก่อนแทนเฉพาะส่วนรายการ ไม่เปลี่ยนข้อมูลหรือสิทธิ์ผู้ใช้ และไม่ต้องล้างข้อมูลเพื่อติดตั้ง

# อัปเดต V4.4.0

รัน `supabase/migrations/20261020120123_four_roles_and_request_types.sql` ต่อจาก V4.3 หนึ่งครั้งใน transaction ก่อนเผยแพร่ UI ระบบจะหยุดถ้ายังมีโปรไฟล์สามบทบาทที่จะเลิกใช้ ต้องตกลงการย้ายกับเจ้าของก่อน ไม่ลบหรือแปลงบัญชีอัตโนมัติ

เพิ่ม all_units ค่าเริ่มต้น false ให้ทุกคน ช่องนี้ใช้ได้เฉพาะ Supervisor และแก้ได้โดย Admin ผ่าน save_profile เท่านั้น ผู้ใช้เดิมจะไม่ถูกเปิดสิทธิ์ทุกหน่วยงานอัตโนมัติ

# อัปเดต V4.3.0

ติดตั้ง `supabase/migrations/20261020113344_hiring_workflow_v43.sql` ต่อจาก migration V4.2.1 หนึ่งครั้ง โดยรันใน transaction ตามขั้นตอน SQL Editor เป็นการปรับ validation/สิทธิ์และเพิ่มค่าประเภทอบรม ไม่ล้างข้อมูลเดิม มี guard ป้องกันทับ command ที่แก้จากฐานเดิม หาก guard แจ้งให้ตรวจ ให้หยุดและเปรียบเทียบก่อน ห้ามลบ guard เพื่อข้าม

ตรวจบัญชี HR, หัวหน้างานที่มีหน่วยงาน และ Driver Coach ให้พร้อมก่อนทดสอบส่งมอบ การเริ่มงานและอบรมรุ่นนี้ Admin ไม่มีสิทธิ์แทน HR โดยอัตโนมัติ

# อัปเดต V4.2.1

รัน `supabase/migrations/20261020111221_required_application_fields.sql` ต่อจาก migration PIN หนึ่งครั้ง เพิ่มการบังคับข้อมูล 6 ช่องในใบสมัครออนไลน์ใหม่ ไม่ล้างหรือแก้ข้อมูลเดิม

# อัปเดต V4.2.0

ระบบเดิมที่ติดตั้ง V4 แล้ว: รัน `supabase/migrations/20261020105230_application_pin.sql` หนึ่งครั้งใน SQL Editor ก่อนเผยแพร่ UI รุ่นนี้ เป็นการเพิ่มตาราง/ฟังก์ชัน ไม่ล้างข้อมูลเดิม ห้ามรัน migration ฐานเดิมซ้ำ

ระบบใหม่: รัน migration ทั้งสองไฟล์ตามลำดับ การตรวจ RLS ปัจจุบันมี 13 ตาราง (เดิม 11 + application_gate, application_tickets)

PIN เป็นประตูรับแบบสมัคร ไม่ใช่บัญชีผู้ใช้ เก็บ secret และ token hash ใน schema ส่วนตัว ไม่เปิด rm_private ต่อ Data API และไม่ส่ง secret/PIN ผ่าน public_info

# ติดตั้ง Recruitment System Pages V4.1.1

## ถ้าใช้ Supabase เดิมที่ติดตั้ง V4 แล้ว

ไม่รัน migration เดิมซ้ำ ไม่ต้องล้างข้อมูล และไม่ต้องสร้าง Admin ใหม่ บัญชี/Role เดิมใช้ได้เมื่อเชื่อมโปรเจกต์เดียวกัน

1. GitHub Repo → Settings → Secrets and variables → Actions → Variables
2. เพิ่ม `SUPABASE_URL` และ `SUPABASE_ANON_KEY` (URL และ anon/publishable key ของโปรเจกต์เดียวกัน)
3. Settings → Pages → Source เลือก GitHub Actions
4. Actions → Publish Recruitment to GitHub Pages → Run workflow บน main
5. เปิด https://suttipat-cmd.github.io/recruitment-system-pages/
6. แบบสมัคร: https://suttipat-cmd.github.io/recruitment-system-pages/#apply

GitHub Free ใช้ Pages จาก Public Repo; code อ่านได้ทั่วไป แต่ข้อมูลใน Supabase ยังบังคับสิทธิ์ด้วย Auth/RPC/RLS

## Auth redirects

ให้เจ้าของ Supabase เพิ่ม URL ต่อไปนี้ใน Authentication → URL Configuration → Redirect URLs:

```
https://suttipat-cmd.github.io/recruitment-system-pages/
```

เก็บ URL ของเว็บเดิมไว้ด้วย หากยังใช้อยู่ ไม่ต้องเปลี่ยน Site URL จนกว่าจะตกลงว่า Pages เป็นเว็บหลัก สำหรับลืมรหัสผ่านต้องตั้ง SMTP/Email provider และทดสอบลิงก์จริง

## ถ้าใช้ Supabase ใหม่ที่ยังไม่มีฐานข้อมูล V4

1. SQL Editor → รัน `supabase/migrations/20261019120728_recruitment_system_v4.sql` หนึ่งครั้ง
2. หาก relation already exists ให้หยุดและตรวจ ไม่ลบ schema เดิมเพื่อแก้
3. ไม่เพิ่ม rm_private ใน Data API exposed schemas
4. Authentication → Users → สร้างบัญชี Admin ด้วยอีเมลและรหัสผ่านของตนเอง
5. แก้อีเมลใน `sql/bootstrap-admin.sql` และรันใน SQL Editor
6. รัน `sql/verify-install.sql`: private RLS tables 11, active Admin อย่างน้อย 1
7. Login → ตั้งค่าระบบ → เพิ่มสิทธิ์ผู้ใช้อื่นด้วยอีเมลที่เจ้าของสร้างใน Auth แล้ว

## เฟสนี้ไม่มีไฟล์แนบ

UI ปิดการแนบและเปิดเอกสารสำหรับทุก Role รวมแบบสมัคร ตาราง/Storage เดิมคงไว้เพื่อ compatibility ไม่ลบไฟล์เก่าและไม่เปิดแชร์สาธารณะ

## ตรวจปัญหา

- Workflow skipped: ยังไม่มี Variables ทั้งสองตัว ให้เพิ่มและ Run workflow ใหม่
- 404 / CSS ไม่โหลด: ชื่อ Repo กับ PAGES_BASE_PATH ต้องตรงกัน Workflow ทำให้โดยอัตโนมัติ
- หน้าเว็บแจ้งตั้งค่า: ตรวจ build config.json และชนิด key ห้ามใช้ service_role/secret key
- Login ผ่านแต่ไม่มีสิทธิ์: ต้องมี profile ที่ active ใน rm_private.profiles
- ไม่พบ recruitment_command: ยังไม่ติดตั้ง migration หรือเชื่อมผิด Supabase
- เข้าแบบสมัครแล้วปิดรับ: Admin เปิดรับสมัครออนไลน์ในหน้าตั้งค่า

## รันในเครื่อง

```sh
npm ci
cp .env.example .env.local
# ใส่ URL + anon key
npm run dev
```

```sh
PAGES_BASE_PATH=/recruitment-system-pages/ npm run build
npm run preview
```

เปิด http://127.0.0.1:4173/recruitment-system-pages/ จาก production preview

ไม่ commit .env.local หรือข้อมูลผู้สมัครเข้า Repo ค่า config.json ที่ build ออกไปมี URL และ anon key ซึ่งเป็น public configuration เท่านั้น
