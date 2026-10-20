# Recruitment System Pages — V4.1.1

เว็บ Recruitment ภาษาไทยแบบ static สำหรับ GitHub Pages เชื่อม Supabase Auth และ PostgreSQL ของเจ้าของข้อมูลผ่าน RPC ใช้ TypeScript + Vite ไม่ต้องใช้ Vercel/server ของเรา

เฟสนี้ **พักการแนบไฟล์ รูปภาพ เอกสาร และการเปิดดูเอกสาร** ทั้งหมด ฟังก์ชัน Login, 7 Role, ใบสมัคร, HR คัดกรอง, สัมภาษณ์, คำขอคน, สำรอง/เรียกกลับ, เริ่มงาน, อบรม และ KPI ใช้ต่อจาก V4 ไม่มีการล้างข้อมูลหรือสร้างฐานใหม่อัตโนมัติ

## ตั้งค่า GitHub Pages

1. Repository → Settings → Secrets and variables → Actions → **Variables**
2. เพิ่ม Repository variables: `SUPABASE_URL` และ `SUPABASE_ANON_KEY`
3. ใช้ URL และ anon/publishable key ของ Supabase โปรเจกต์เดียวกัน **ห้ามใช้ service_role หรือ secret key**
4. Repository → Settings → Pages → Source: **GitHub Actions**
5. ไป Actions → Publish Recruitment to GitHub Pages → Run workflow หรือ push เข้า main
6. เปิด `https://suttipat-cmd.github.io/recruitment-system-pages/`

Workflow กำหนด base path จากชื่อ Repo ให้อัตโนมัติ เพื่อไม่ให้ CSS, JavaScript และลิงก์สมัครงานหลุดไปที่ root domain

ตัวแปรสองตัวนี้จะอยู่ใน `config.json` ที่ browser อ่านได้ ถือเป็นค่า public ของ Supabase ไม่ใช่สิทธิ์ Admin การป้องกันข้อมูลอยู่ที่ Auth, live profiles, RPC authorization และ RLS ในฐานข้อมูล `.env.local` ไม่ขึ้น Git

## Supabase

หากใช้ Supabase ที่ติดตั้ง V4 แล้ว **ไม่ต้องรัน migration เดิมซ้ำ** และไม่ลบตารางเดิม

ตั้ง Authentication → URL Configuration → Redirect URLs ให้มี:

```
https://suttipat-cmd.github.io/recruitment-system-pages/
```

หากเว็บเก่า Vercel ยังใช้อยู่ ให้เพิ่ม URL ใหม่โดยเก็บ URL เดิมไว้ บัญชีและสิทธิ์เดิมใช้ร่วมกันได้เมื่อเชื่อมโปรเจกต์เดียวกัน ส่วนการเปลี่ยน Site URL ให้เจ้าของตัดสินใจตามเว็บหลักที่ใช้งานจริง

สำหรับ Supabase ใหม่ ดู INSTALL.md ซึ่งมีขั้นตอน migration + bootstrap Admin เอกสารและตาราง Storage เดิมคงไว้เพื่อ compatibility แต่หน้าเว็บไม่เปิดการแนบ/ดูไฟล์ในเฟสนี้

## พัฒนาและทดสอบ

```sh
npm ci
cp .env.example .env.local
# ใส่ค่า Supabase
npm run dev
```

```sh
PAGES_BASE_PATH=/recruitment-system-pages/ npm run build
npm test
npm run preview
```

เปิด preview ที่ `http://127.0.0.1:4173/recruitment-system-pages/` สามารถใช้ชุดทดสอบ UI แยกในเครื่องด้วย `node --import tsx scripts/test-server.ts` ซึ่งไม่มีข้อมูลจริง

## โครงสร้าง

- `web/`: UI + role workflow + base-aware URLs
- `vite.config.ts`: static build + public config + reject privileged keys
- `.github/workflows/pages.yml`: test/build/deploy Pages
- `supabase/migrations/`: SQL ฐานเดิม ไม่รันอัตโนมัติ
- `sql/bootstrap-admin.sql`: เจ้าของสร้าง Admin คนแรก
- `tests/`: PostgreSQL workflow/authorization และ static paths
- `USER-MANUAL.md`: คู่มือโฟลวเดิม (พักส่วนเอกสารในรุ่นนี้)

ไม่มี Vercel Functions หรือ `/api/items` ใน Hosting ชุดนี้ GitHub Pages เป็น frontend เท่านั้น ข้อมูลใบสมัครและพนักงานไม่ถูกเก็บใน Repo หรือ build artifact
