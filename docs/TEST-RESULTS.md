# Pages V4.1.1 verification — 20/10/2026

Production static build with base /recruitment-system-pages/: PASS.
Automated tests: 21 passed, 0 failed (PostgreSQL/RPC authorization regression, Pages base paths, attachment feature flag).
Live GitHub Pages deployment and hosted Auth login remain pending setup/verification.

# ผลตรวจ Recruitment System V4.0.0

ตรวจเมื่อ 19/10/2026 ใช้ Node.js 24, TypeScript 7, Vite 8 และ Supabase JS 2.118.0 ตาม package-lock.json

## Automated checks

`npm run build` ผ่าน TypeScript strict และ production bundle

`npm test` ผ่าน 19 รายการ (รวม subtests) โดย migration รันบน PostgreSQL ผ่าน PGlite จริง ไม่ใช่การตรวจข้อความ SQL อย่างเดียว:

- ทุกตาราง private เปิด RLS และปฏิเสธ direct table access
- anon ใช้ command ไม่ได้ และเรียก apply(false) เพื่อข้ามประตูรับสมัครไม่ได้
- สร้างผู้สมัครโดยไม่มีคำขอคน / หัวหน้างานยังอ่านใบสมัครที่ไม่ได้คัดกรองไม่ได้
- คำขอหลายทะเบียน แยกคนขับ/เด็กติดรถ รับเรื่องได้ครั้งเดียวและตรวจ version
- เปลี่ยนหน่วยงาน คืน slot เดิมอัตโนมัติ คง original_unit และปฏิเสธ stale write
- รับคิวเฉพาะหน่วยงาน ยืนยันผ่านโดยไม่ทดลองขับได้ และ fill อัตราใน transaction
- ส่งมอบผู้ดูแล เริ่มงานจริง Coach/หัวหน้างานแก้ได้ตามขอบเขต
- ผลอบรมไม่ผ่านไม่ลด KPI retention
- สำรอง/เรียกกลับสร้างรอบใหม่ และบังคับบันทึกเหตุผลใบสมัครซ้ำ
- ปิด profile มีผลกับคำสั่งถัดไป และ Admin ลดสิทธิ์ตนเองไม่ได้
- gate สมัครสาธารณะและกันส่งซ้ำเบอร์เดิมใน 10 นาที
- Storage policy ปฏิเสธผู้สอนและเส้นทาง upload ของผู้ใช้อื่น
- รีเซ็ตเฉพาะ Admin ต้องยืนยันชัดเจน ตรวจ fingerprint และบล็อกหากมีไฟล์/เอกสาร
- แปลงวันที่ ตรวจวันไม่มีจริง สูตร retention ขอบเขต 90 วัน และ HTML escaping
- regression SDK Select/Insert, validation และการปฏิเสธ secret/service-role keys

## Browser walkthrough

ทดสอบ UI ที่ http://127.0.0.1:3100 โดย fake Supabase Auth + PostgreSQL แยกในเครื่อง:

1. HR Login → เพิ่มผู้สมัคร → ค้นหา → เปิดรายละเอียด → ส่งสัมภาษณ์โดยไม่มีคำขอ
2. Logout → หัวหน้างาน Login → รับงาน → คะแนน/ผลผ่าน/เชื้อเพลิง โดยเว้นทดลองขับ → สถานะ HIRED
3. เลือก Coach/หัวหน้าผู้ดูแล → บันทึกเริ่มงานจริง → สถานะ STARTED และเปิดงานอบรม
4. Dashboard แสดง cohort 90 วัน 100% จากผู้เริ่มงานทดลอง 1 คน
5. ตรวจภาพ desktop และ mobile 390px: document width เท่ากับ viewport ไม่มี horizontal overflow

## ข้อจำกัดการยืนยัน

ยังไม่ได้ติดตั้ง SQL, สร้าง Auth users หรือ Deploy V4 ใน Supabase/Vercel ของเจ้าของจริง เครื่องมือ Supabase ที่เชื่อมอยู่ไม่มีสิทธิ์ในโปรเจกต์นั้น จึงยังไม่ได้รัน hosted advisors หรือทดสอบ actual email recovery, Storage upload/signed URL, production CSP และ provider integration ของ Vercel จริง การทดสอบ browser ใช้ Auth จำลอง ไม่ใช่หลักฐานว่าตั้งค่า hosted Auth ถูกต้องแล้ว

ก่อนเปิด production ให้เจ้าของทำ INSTALL.md, ตรวจ SQL verify-install และทดสอบ UAT แต่ละ Role ตาม USER-MANUAL.md ไม่อ้างว่าระบบปราศจาก bug ทุกกรณี
