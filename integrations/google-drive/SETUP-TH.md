# Google Drive Bridge สำหรับ Recruitment V4.10

ไฟล์และภาพเก็บใน Google Drive ของคุณทั้งหมด Supabase เก็บเฉพาะข้อมูลอ้างอิงและตรวจสิทธิ์ เว็บไม่ใช้ service_role และไม่ต้องเปิด Drive เป็นสาธารณะ

## 1. สร้าง Apps Script โปรเจกต์ใหม่

1. เปิด https://script.google.com/ แล้วสร้าง **New project** แยกจาก Apps Script เดิม
2. นำเนื้อหา `Code.gs` วางในไฟล์ Code.gs
3. ไป **Project Settings** แล้วเปิด **Show appsscript.json manifest file in editor**
4. วางเนื้อหา `appsscript.json` ที่ให้มาแทน manifest ของโปรเจกต์ใหม่นี้
5. ที่ Services ตรวจว่ามี **Drive API v3** หากยังไม่มี กด **+ → Drive API → v3 → Add**

กำหนดโฟลเดอร์หลักผ่าน ROOT_FOLDER_ID ใน Script Properties ของเจ้าของ ไม่เก็บ ID โฟลเดอร์ส่วนตัวในโค้ดสาธารณะ

ใช้บัญชีที่มีสิทธิ์สร้างไฟล์/โฟลเดอร์ในโฟลเดอร์หลักนี้ โฟลเดอร์ต้องเป็น **Restricted / จำกัดสิทธิ์** โค้ดจะหยุดหากพบการแชร์แบบ Anyone หรือทั้งโดเมน และจะไม่แก้สิทธิ์แชร์ให้เอง รองรับ Shared Drive ผ่าน Drive API v3 หากบัญชี Deploy มีสิทธิ์ที่เหมาะสม

## 2. ตั้ง Script Properties

ไป **Project Settings → Script Properties → Add script property** แล้วใส่:

| Property | ค่า |
|---|---|
| `ROOT_FOLDER_ID` | ID โฟลเดอร์หลักที่เจ้าของกำหนด (ส่วนท้าย URL หลัง /folders/) |
| `SUPABASE_URL` | `https://gyqwpmpyqbdgedzybxqf.supabase.co` |
| `SUPABASE_ANON_KEY` | anon หรือ publishable key ของโปรเจกต์นี้ จาก Supabase → Project Settings → API Keys |

ไม่ใช้ service_role หรือ sb_secret key

บันทึก แล้วเลือกฟังก์ชัน **setupBridge** กด Run และอนุญาตสิทธิ์ด้วยบัญชีเจ้าของที่ใช้ Deploy

ฟังก์ชันจะตรวจโฟลเดอร์และสร้าง `BRIDGE_KEY` เก็บใน Script Properties ให้อัตโนมัติ ไม่ต้องนำค่านี้ไปใส่หน้าเว็บหรือส่งให้ใคร

Execution log จะแสดง SQL ที่มี **bridge_key_hash** 64 ตัว เก็บ SQL นี้ไว้ ค่า hash ใช้ตั้งฝั่ง Supabase ได้ โดยไม่ได้เปิดเผย BRIDGE_KEY ตัวจริง

## 3. Deploy Web app

1. กด **Deploy → New deployment**
2. เลือกชนิด **Web app**
3. **Execute as: Me / บัญชีที่กำลัง Deploy**
4. **Who has access: Anyone** เพื่อให้ผู้สมัครที่ไม่มีบัญชี Google ส่งไฟล์ได้
5. กด Deploy แล้วคัดลอก URL ที่ลงท้ายด้วย **/exec** ไม่ใช้ /dev

URL นี้เปิดให้รับคำขอได้ แต่ทุกการส่ง/ดูไฟล์ยังต้องผ่านสิทธิ์ Supabase หรือสิทธิ์แนบไฟล์เฉพาะใบสมัคร ไม่มี endpoint ที่เปิดไฟล์จาก Drive ID ได้โดยข้ามสิทธิ์

หากนโยบาย Workspace ไม่อนุญาตตัวเลือก Anyone ให้เจ้าของ Workspace ตรวจนโยบายก่อน ไม่ต้องเปลี่ยนโฟลเดอร์ Drive ให้เป็นสาธารณะ

## 4. เชื่อมกับ Supabase

สำหรับฐานปัจจุบัน ผู้พัฒนาเตรียม migration V4.10 ให้ก่อนส่งชุดนี้แล้ว ตรวจด้วย SQL นี้ได้:

```sql
select to_regclass('rm_private.drive_config');
```

ต้องได้ `rm_private.drive_config` หากยังไม่ได้ ให้รัน `20261025152924_google_drive_attachments_v410.sql` หนึ่งครั้งใน transaction ต่อจาก migration V4.9 ก่อน และไม่ต้องล้างข้อมูล

นำ SQL จาก log ของ `setupBridge()` มาแทน `PASTE_YOUR_EXEC_URL_HERE` ด้วย URL /exec แล้วรันใน **Supabase → SQL Editor** ของโปรเจกต์ Recruitment System ตัวอย่าง:

```sql
update rm_private.drive_config
set bridge_url = 'https://script.google.com/macros/s/URL_จากการ_DEPLOY/exec',
    bridge_key_hash = 'HASH_64_ตัวจาก_setupBridge',
    enabled = true
where id;
```

คัดลอกจาก log จริง อย่าใช้ข้อความตัวอย่างตรง ๆ จากนั้นตรวจ:

```sql
select public.recruitment_drive_status();
```

ต้องได้ `enabled: true` พร้อม URL ถูกต้อง แล้วรีเฟรชเว็บ Recruitment

หากต้องการให้ผู้พัฒนาช่วยเชื่อมต่อ ส่งเฉพาะ URL /exec กับ bridge_key_hash มาได้ ไม่ส่ง BRIDGE_KEY, service_role หรือรหัสผ่าน

## 5. ลองใช้งานหลัง Deploy

1. HR เปิดรายละเอียดผู้สมัครทดสอบ → **เอกสารแนบ → แนบเอกสาร**
2. เลือก JPG/PNG และ PDF แล้วส่ง ตรวจผลสำเร็จแต่ละรายการ
3. เปิด Drive ต้องมีโฟลเดอร์ย่อยชื่อรหัส เช่น `DRV-20261020-83ED5718` และมีไฟล์ที่ส่ง
4. รูปต้องแสดงในแท็บเอกสารแนบอัตโนมัติ ไม่ต้องกดเปิดทีละรูป PDF มีปุ่มเปิดดูในเว็บและดาวน์โหลด
5. HR แนบเพิ่มอีกครั้ง ต้องไปอยู่โฟลเดอร์เดิม
6. ลองผู้สมัครกรอกฟอร์มพร้อมไฟล์ และลองส่งแบบไม่แนบไฟล์ ทั้งสองแบบต้องบันทึกใบสมัครได้
7. ตรวจบัญชี Supervisor หน่วยงานอื่นว่าเปิดเอกสารคนที่อยู่นอกขอบเขตไม่ได้ และ Driver Coach ดูได้ตามขอบเขตพนักงานที่รับเข้า/เริ่มงานแล้วเดิม
8. ลองไฟล์ใกล้ 10 MB และหลายรายการก่อนเริ่มใช้งานจริง เพื่อยืนยันเครือข่าย โควตา และนโยบาย Workspace ของบัญชี Deploy

## วิธีใช้งานและกรณีส่งค้าง

- แนบไม่บังคับ สูงสุด 10 ไฟล์ต่อครั้ง ไฟล์ละไม่เกิน 10 MB รองรับ JPG/JPEG, PNG และ PDF
- ผู้สมัครส่งได้เฉพาะไฟล์ชุดที่เลือกให้ใบสมัครตนเอง ภายใน 2 ชั่วโมงหลังบันทึก และไม่มีสิทธิ์ใช้ token นี้ดูไฟล์ที่ HR แนบเพิ่ม
- หลังส่งใบสมัคร หากไฟล์บางรายการล้มเหลว ให้กดลองส่งเฉพาะรายการที่เหลือ ไม่ต้องส่งใบสมัครใหม่ หากปิดหน้าไปแล้ว ให้ติดต่อ HR
- เจ้าหน้าที่แนบเพิ่มได้เฉพาะ Admin/HR ส่วน Supervisor และ Driver Coach เป็นผู้ดูตามสิทธิ์เดิม
- รูปถูกส่งผ่าน Bridge แล้วแสดงเป็น Blob URL ในหน้าเว็บ ไม่ใช้ลิงก์ Drive แบบเปิดสาธารณะ
- ชื่อไฟล์จริงใน Drive มีรหัสเอกสารนำหน้าชื่อเดิมเพื่อไม่ให้ไฟล์ชื่อซ้ำทับกัน หน้าเว็บแสดงชื่อไฟล์เดิม
- รหัสโฟลเดอร์จะคงเดิมเมื่อมีไฟล์แล้ว แม้แก้ตำแหน่งผู้สมัครภายหลัง รหัสเด็กติดรถใช้ AST ตามระบบเดิม
- หากพบรายการอัปโหลดค้าง Admin/HR กด **ตรวจไฟล์ที่ส่งค้าง** ได้ ระบบตรวจไฟล์เดิมก่อนบันทึกซ้ำ กรณีไม่พบไฟล์ใน Drive ให้เลือกแนบไฟล์ใหม่ผ่าน HR และให้ผู้ดูแลตรวจรายการค้างตามรหัสเอกสาร
- ระบบจะไม่ลบไฟล์หรือโฟลเดอร์อัตโนมัติหลังเกิด timeout เพราะไฟล์อาจส่งสำเร็จแล้ว การรีเซ็ตข้อมูลถูกบล็อกเมื่อยังมีเอกสารหรือรายการอัปโหลดค้าง เพื่อไม่ทิ้งไฟล์กำพร้า
- ข้อมูลสำรองของ Admin รวม metadata ไฟล์ Drive แต่ไม่รวมตัวไฟล์ ผู้ดูแล Drive สำรองไฟล์ต้นฉบับแยกได้ตามนโยบายองค์กร
- ใช้ Apps Script โปรเจกต์เดิมต่อในการอัปเดต เลือก **Manage deployments → Edit → New version → Deploy** ไม่เปลี่ยนโฟลเดอร์หลักหรือสร้าง Bridge โปรเจกต์ใหม่แทนของเดิมหลังเริ่มเก็บไฟล์ โดยไม่วางแผนย้ายข้อมูล

ปิดรับ–ส่งไฟล์ชั่วคราวโดยไม่ลบไฟล์:

```sql
update rm_private.drive_config set enabled=false where id;
```

## สถานะการทดสอบ

ชุดทดสอบตรวจการจำกัดชนิด/ขนาดไฟล์ สิทธิ์แต่ละบทบาท ขอบเขตหน่วยงาน สิทธิ์ผู้สมัครเฉพาะใบสมัคร การส่งซ้ำหลัง timeout การตรวจไฟล์ค้าง และการป้องกันรีเซ็ตเมื่อมีไฟล์แล้ว หน้าแสดงรูปทดสอบผ่านช่องทาง iframe จำลองแล้ว

ยังต้องทดสอบกับ Apps Script deployment และ Drive จริงของเจ้าของหลังทำข้อ 1–4 เพราะผู้พัฒนาไม่สามารถยืนยันผล Deploy และนโยบายบัญชี Google แทนเจ้าของได้

อ้างอิง: [Web apps](https://developers.google.com/apps-script/guides/web), [HTML iframe restrictions](https://developers.google.com/apps-script/guides/html/restrictions), [Advanced Drive service](https://developers.google.com/apps-script/advanced/drive)
