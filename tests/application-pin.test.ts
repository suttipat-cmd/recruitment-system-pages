import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('application PIN authorization, rotation, throttling and one-use form access', async()=>{
 const db = new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;`);
 for(const file of ['20261019120728_recruitment_system_v4.sql','20261020105230_application_pin.sql','20261020111221_required_application_fields.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 const hr='10000000-0000-4000-8000-000000000001',mgr='10000000-0000-4000-8000-000000000002';
 for(const [id,role] of [[hr,'HR'],[mgr,'MANAGER']])await db.query<any>(`insert into auth.users values($1,$2);`,[id,role+'@test.invalid']);
 for(const [id,role] of [[hr,'HR'],[mgr,'MANAGER']])await db.query<any>(`insert into rm_private.profiles(id,email,display_name,role,units)values($1,$2,$3,$3,array['TL-ขอนแก่น'])`,[id,role+'@test.invalid',role]);
 await db.exec(`update rm_private.settings set data=jsonb_build_object('public_apply',true)`);
 async function as(id:string|null,sql:string,params:any[]=[]):Promise<any>{await db.query<any>("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+(id?'authenticated':'anon'));try{return (await db.query<any>(sql,params)).rows[0]?.data;}finally{await db.exec('reset role');}}
 await assert.rejects(as(null,'select public.recruitment_application_pin() data'),/permission denied/);
 await assert.rejects(as(mgr,'select public.recruitment_application_pin() data'),/เฉพาะ HR/);
 await assert.rejects(as(null,'select secret from rm_private.application_gate'),/permission denied/);
 const pin=await as(hr,'select public.recruitment_application_pin() data');assert.match(pin.pin,/^\d{6}$/);assert.ok(Date.parse(pin.expires_at)-Date.parse(pin.server_time)<=60000);
 const reference=(await db.query<any>(`select rm_private.pin_at('2026-01-01 00:00:00Z') a,rm_private.pin_at('2026-01-01 00:00:59Z') b,rm_private.pin_at('2026-01-01 00:01:00Z') c`)).rows[0] as any;assert.equal(reference.a,reference.b);
 const wrong=await as(null,'select public.recruitment_unlock_application($1) data',['abcdef']);assert.equal(wrong.ok,false);
 assert.equal((await db.query<any>('select attempts from rm_private.application_gate')).rows[0]?.attempts,1);
 const access=await as(null,'select public.recruitment_unlock_application($1) data',[pin.pin]);assert.equal(access.ok,true);assert.ok(Date.parse(access.expires_at)>Date.parse(pin.expires_at));
 const payload={full_name:'ทดสอบ ระบบ',phone:'0812345678',unit:'TL-ขอนแก่น',position:'DRIVER',data:{birth_date:'1990-01-01',national_id:'1234567890123',vehicle_type:'10W',license_type:'ท.3',driver_license_no:'12345',fuel_type:'รถไฟฟ้า',id_issued_at:'2020-01-01',id_expires_at:'2030-01-01',current_job_status:'ว่างงาน',available_start_date:'2026-11-01',cargo_types:'วัสดุก่อสร้าง',other_cargo_note:'ไม่มี'}};
 await assert.rejects(as(null,'select public.recruitment_apply($1) data',[payload]),/PIN/);
 await assert.rejects(as(null,'select public.recruitment_apply($1) data',[{...payload,access_token:access.token,data:{}}]),/ช่องบังคับ/);
 for(const field of ['id_issued_at','id_expires_at','current_job_status','available_start_date','cargo_types','other_cargo_note']) {
   await assert.rejects(as(null,'select public.recruitment_apply($1) data',[{...payload,access_token:access.token,data:{...payload.data,[field]:'  '}}]),/ช่องบังคับ/);
 }
 await assert.rejects(as(null,'select public.recruitment_apply($1) data',[{...payload,access_token:access.token,data:{...payload.data,id_issued_at:'2026-02-31'}}]),/out of range/);
 const done=await as(null,'select public.recruitment_apply($1) data',[{...payload,access_token:access.token}]);assert.ok(done.id);
 assert.equal((await db.query<any>('select data from rm_private.applicants where id=$1',[done.id])).rows[0]?.data.fuel_type,'รถไฟฟ้า');
 await assert.rejects(as(null,'select public.recruitment_apply($1) data',[{...payload,access_token:access.token}]),/PIN/);
 const expired=await as(null,'select public.recruitment_unlock_application($1) data',[pin.pin]);await db.exec(`update rm_private.application_tickets set expires_at=now()-interval '1 second'`);
 await assert.rejects(as(null,'select public.recruitment_apply($1) data',[{...payload,access_token:expired.token}]),/PIN/);
 await db.exec(`update rm_private.application_gate set attempts=100,attempt_minute=floor(extract(epoch from clock_timestamp())/60)::bigint`);
 assert.equal((await as(null,'select public.recruitment_unlock_application($1) data',[pin.pin])).ok,false);
 await db.exec(`update rm_private.settings set data=jsonb_build_object('public_apply',false)`);
 assert.equal((await as(null,'select public.recruitment_unlock_application($1) data',[pin.pin])).ok,false);
 await db.close();
});
