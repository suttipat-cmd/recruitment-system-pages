-- Only new public applications: existing records can still be edited without a backfill.
create or replace function rm_private.public_apply(d jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare h text:=md5(coalesce(d->>'access_token',''));i uuid;k text;v text;begin
 perform 1 from rm_private.application_tickets where token_hash=h and expires_at>clock_timestamp() for update;
 if not found then raise exception 'กรุณาเปิดฟอร์มด้วย PIN จาก HR ใหม่' using errcode='42501';end if;
 foreach k in array array['id_issued_at','id_expires_at','current_job_status','available_start_date','cargo_types','other_cargo_note'] loop
   if jsonb_typeof(d->'data'->k) is distinct from 'string' or trim(coalesce(d->'data'->>k,''))='' then
     raise exception 'กรอกช่องบังคับให้ครบ: %',case k when 'id_issued_at' then 'วันออกบัตรประชาชน' when 'id_expires_at' then 'วันหมดอายุบัตรประชาชน' when 'current_job_status' then 'สถานะการทำงาน' when 'available_start_date' then 'วันที่พร้อมเริ่มงาน' when 'cargo_types' then 'สินค้าที่เคยขน' else 'งานขนส่งอื่น' end;
   end if;
 end loop;
 if d->'data'->>'current_job_status' not in ('ว่างงาน','ทำงานอยู่','อื่นๆ') then raise exception 'สถานะการทำงานไม่ถูกต้อง';end if;
 foreach k in array array['id_issued_at','id_expires_at','available_start_date'] loop
   v:=d->'data'->>k;
   if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'รูปแบบวันที่ไม่ถูกต้อง';end if;
   perform v::date;
 end loop;
 i:=rm_private.apply(d-'access_token',true);
 delete from rm_private.application_tickets where token_hash=h;
 return i;
end $$;
