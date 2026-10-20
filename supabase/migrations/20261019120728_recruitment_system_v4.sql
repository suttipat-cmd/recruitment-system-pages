-- Recruitment System 4.0.0. Additive install: existing items/GAS data are not deleted.
begin;
create schema if not exists rm_private;
revoke all on schema rm_private from public;
grant usage on schema rm_private to authenticated, anon;
create table rm_private.units(name text primary key check(length(name) between 1 and 120),active boolean not null default true);
insert into rm_private.units(name) values('TL-ขอนแก่น'),('TL-สระบุรี'),('TL-ส่วนกลาง'),('LLC-กิ่งแก้วเงินสด');
create table rm_private.profiles(id uuid primary key references auth.users(id),email text not null,display_name text not null check(length(display_name) between 1 and 120),role text not null check(role in ('ADMIN','HR','MANAGER','COACH','SAFETY','DISPATCH_MANAGER','DRIVER_TRAINER')),units text[] not null default '{}',active boolean not null default true,version int not null default 1);
create table rm_private.settings(id boolean primary key default true check(id),data jsonb not null default '{"public_apply":false}'::jsonb);
insert into rm_private.settings default values;
create table rm_private.applicants(id uuid primary key default gen_random_uuid(),full_name text not null check(length(full_name) between 2 and 120),phone text not null check(phone ~ '^[0-9+ -]{8,20}$'),position text not null check(position in ('DRIVER','HELPER')),original_unit text not null references rm_private.units(name),hiring_unit text not null references rm_private.units(name),status text not null default 'HR_REVIEW' check(status in ('HR_REVIEW','WAITING_INFO','INTERVIEW','HIRED','STARTED','RESERVE','REJECTED','WITHDRAWN','NO_SHOW','CANCELLED')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version int not null default 1,owner_id uuid references rm_private.profiles(id),coach_id uuid references rm_private.profiles(id),supervisor_id uuid references rm_private.profiles(id),slot_id uuid,scheduled_start_date date,actual_start_date date,resignation_date date,employment_status text not null default 'PENDING' check(employment_status in ('PENDING','ACTIVE','RESIGNED')),round int not null default 0,data jsonb not null default '{}',check(resignation_date is null or (actual_start_date is not null and resignation_date>=actual_start_date)));
create index on rm_private.applicants(status,created_at desc);
create index on rm_private.applicants(hiring_unit,status);
create index on rm_private.applicants(phone);
create table rm_private.requests(id uuid primary key default gen_random_uuid(),title text not null check(length(title) between 1 and 200),unit text not null references rm_private.units(name),created_by uuid not null references rm_private.profiles(id),created_at timestamptz not null default now(),received_at timestamptz,received_by uuid references rm_private.profiles(id),notes text not null default '',version int not null default 1);
create table rm_private.slots(id uuid primary key default gen_random_uuid(),request_id uuid not null references rm_private.requests(id),plate text not null check(length(plate) between 1 and 50),fleet_type text not null check(fleet_type in ('COMPANY','PARTNER')),position text not null check(position in ('DRIVER','HELPER')),status text not null default 'OPEN' check(status in ('OPEN','MATCHED','FILLED','CANCELLED')),applicant_id uuid unique references rm_private.applicants(id),filled_at timestamptz,first_filled_at timestamptz,cancel_note text,version int not null default 1);
alter table rm_private.applicants add constraint applicant_slot_fk foreign key(slot_id) references rm_private.slots(id);
create unique index applicant_slot_unique on rm_private.applicants(slot_id) where slot_id is not null;
create table rm_private.evaluations(id uuid primary key default gen_random_uuid(),applicant_id uuid not null references rm_private.applicants(id),round int not null,evaluator_id uuid not null references rm_private.profiles(id),stage text not null check(stage in ('DRAFT','SUBMITTED')),score int check(score between 1 and 5),result text check(result in ('PASS','FAIL')),road_result text check(road_result in ('PASS','FAIL') or road_result is null),fuel text not null default '',note text not null default '',updated_at timestamptz not null default now(),unique(applicant_id,round));
create table rm_private.topics(id uuid primary key default gen_random_uuid(),title text not null check(length(title) between 1 and 200),category text not null check(category in ('GENERAL','COACH','SAFETY','DRIVER_TRAINER')),position text check(position in ('DRIVER','HELPER')),unit text references rm_private.units(name),active boolean not null default true);
create table rm_private.training(id uuid primary key default gen_random_uuid(),applicant_id uuid not null references rm_private.applicants(id),topic_id uuid not null references rm_private.topics(id),category text not null check(category in ('GENERAL','COACH','SAFETY','DRIVER_TRAINER')),training_date date not null,result text not null check(result in ('PASS','FAIL')),note text not null default '',created_by uuid not null references rm_private.profiles(id),updated_by uuid not null references rm_private.profiles(id),updated_at timestamptz not null default now(),version int not null default 1);
create table rm_private.activities(id bigint generated always as identity primary key,applicant_id uuid references rm_private.applicants(id),actor_id uuid references rm_private.profiles(id),action text not null,note text not null default '',created_at timestamptz not null default now());
create index on rm_private.activities(applicant_id,created_at desc);
create table rm_private.documents(id uuid primary key default gen_random_uuid(),applicant_id uuid not null references rm_private.applicants(id),path text unique not null,title text not null,created_by uuid not null references rm_private.profiles(id),created_at timestamptz not null default now());
-- No direct Data API table access. All mutations below are checked against a live profile.
do $$ declare t text; begin foreach t in array array['units','profiles','settings','applicants','requests','slots','evaluations','topics','training','activities','documents'] loop execute format('alter table rm_private.%I enable row level security',t);execute format('revoke all on rm_private.%I from public,anon,authenticated',t);end loop;end $$;
create function rm_private.actor() returns rm_private.profiles language plpgsql security definer set search_path='' as $$ declare p rm_private.profiles;begin select * into p from rm_private.profiles where id=auth.uid() and active; if p.id is null then raise exception 'บัญชีไม่มีสิทธิ์ใช้งานหรือถูกปิด กรุณาติดต่อ Admin' using errcode='42501';end if;return p;end $$;
create function rm_private.allowed_unit(p rm_private.profiles,u text) returns boolean language sql stable set search_path='' as $$ select p.role in ('ADMIN','HR','SAFETY','DISPATCH_MANAGER','DRIVER_TRAINER') or (p.role='MANAGER' and u=any(p.units)) $$;
create function rm_private.can_read(p rm_private.profiles,a rm_private.applicants) returns boolean language sql stable set search_path='' as $$ select p.role in ('ADMIN','HR') or (p.role='MANAGER' and (coalesce(a.data->>'forwarded_at','')<>'' or a.status in ('HIRED','STARTED'))) or a.status in ('HIRED','STARTED') $$;
create function rm_private.can_train(p rm_private.profiles,a rm_private.applicants,c text) returns boolean language sql stable set search_path='' as $$ select coalesce(p.role in ('ADMIN','HR','DISPATCH_MANAGER') or (p.role='MANAGER' and a.hiring_unit=any(p.units)) or (p.role='COACH' and a.coach_id=p.id and c='COACH') or (p.role in ('SAFETY','DRIVER_TRAINER') and c=p.role),false) $$;
create function rm_private.release_slot(a rm_private.applicants) returns void language plpgsql set search_path='' as $$ begin if a.slot_id is not null then update rm_private.slots set applicant_id=null,status='OPEN',filled_at=null,version=version+1 where id=a.slot_id and applicant_id=a.id;update rm_private.applicants set slot_id=null where id=a.id;end if;end $$;
create function rm_private.clean_data(d jsonb) returns jsonb language sql immutable set search_path='' as $$ select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(d) where key=any(array['prefix','gender','birth_date','line_id','national_id','id_issued_at','id_expires_at','vehicle_type','license_type','driver_license_no','license_issued_at','license_expires_at','cargo_types','construction_brands','beverage_brands','other_cargo_note','current_job_status','available_start_date','availability_note']) and jsonb_typeof(value)='string' $$;
create function rm_private.validate_data(d jsonb,pos text) returns void language plpgsql set search_path='' as $$ declare k text;v date;begin
 foreach k in array array['birth_date','id_issued_at','id_expires_at','license_issued_at','license_expires_at','available_start_date'] loop if coalesce(d->>k,'')<>'' then v:=(d->>k)::date;end if;end loop;
 if coalesce(d->>'birth_date','')='' or (d->>'birth_date')::date>current_date then raise exception 'กรุณาระบุวันเกิดที่ถูกต้อง';end if;
 if coalesce(d->>'national_id','') !~ '^[0-9]{13}$' then raise exception 'เลขบัตรประชาชนต้องมี 13 หลัก';end if;
 if pos='DRIVER' and (coalesce(d->>'vehicle_type','')='' or coalesce(d->>'license_type','')='' or coalesce(d->>'driver_license_no','')='') then raise exception 'กรอกประเภทรถและใบขับขี่';end if;
 if octet_length(d::text)>20000 then raise exception 'ข้อมูลยาวเกินไป';end if;
 end $$;
create function rm_private.apply(d jsonb,public_submit boolean default false) returns uuid language plpgsql security definer set search_path='' as $$ declare i uuid;clean jsonb;begin
 if jsonb_typeof(d)<>'object' or octet_length(d::text)>25000 then raise exception 'ข้อมูลไม่ถูกต้อง';end if;
 if public_submit and not coalesce((select (data->>'public_apply')::boolean from rm_private.settings where id),false) then raise exception 'ยังไม่เปิดรับสมัครออนไลน์';end if;
 if not exists(select 1 from rm_private.units where name=d->>'unit' and active) then raise exception 'หน่วยงานไม่ถูกต้อง';end if;
 clean:=rm_private.clean_data(coalesce(d->'data','{}'));perform rm_private.validate_data(clean,d->>'position');
 -- Serialize same phone submissions: suppress accidental double-clicks and basic repeat spam.
 perform pg_advisory_xact_lock(hashtext(coalesce(d->>'phone','')));
 if public_submit and exists(select 1 from rm_private.applicants where phone=d->>'phone' and created_at>now()-interval '10 minutes') then raise exception 'ได้รับใบสมัครเบอร์นี้แล้ว กรุณารอ 10 นาทีก่อนส่งอีกครั้ง';end if;
 insert into rm_private.applicants(full_name,phone,position,original_unit,hiring_unit,data) values(trim(d->>'full_name'),trim(d->>'phone'),d->>'position',d->>'unit',d->>'unit',clean) returning id into i;
 insert into rm_private.activities(applicant_id,action,note) values(i,'APPLIED',case when public_submit then 'สมัครออนไลน์' else 'HR บันทึกใบสมัคร' end);return i;end $$;
create function public.recruitment_apply(p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select jsonb_build_object('id',rm_private.apply(p_payload,true)) $$;
create function rm_private.public_info() returns jsonb language sql security definer set search_path='' as $$ select jsonb_build_object('units',(select coalesce(jsonb_agg(name order by name),'[]') from rm_private.units where active),'open',(select coalesce((data->>'public_apply')::boolean,false) from rm_private.settings where id)) $$;
create function public.recruitment_public_info() returns jsonb language sql security invoker set search_path='' as $$ select rm_private.public_info() $$;
-- One transactional command endpoint; every branch enforces role, row scope and version.
create function rm_private.command(act text,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare p rm_private.profiles; a rm_private.applicants;r rm_private.requests;s rm_private.slots;t rm_private.topics;tr rm_private.training;u rm_private.profiles; v int; i uuid; note text:=left(trim(coalesce(d->>'note','')),5000);result jsonb;clean jsonb;day date:= (now() at time zone 'Asia/Bangkok')::date;idx int;start_date date;end_date date;
begin
 p:=rm_private.actor();
 if jsonb_typeof(d)<>'object' or octet_length(d::text)>100000 then raise exception 'ข้อมูลไม่ถูกต้อง';end if;
 if act='snapshot' then
 return jsonb_build_object('profile',to_jsonb(p),'units',(select coalesce(jsonb_agg(name order by name),'[]') from rm_private.units where active),'people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'display_name',display_name,'role',role,'units',units)),'[]') from rm_private.profiles where active),'settings',case when p.role='ADMIN' then (select data from rm_private.settings where id) else '{}'::jsonb end,'topics',(select coalesce(jsonb_agg(to_jsonb(x) order by title),'[]') from rm_private.topics x where active));
 elsif act='applicants' then
 idx:=greatest(0,least(100000,coalesce((d->>'offset')::int,0)));
 select jsonb_build_object('total',count(*)) into result from rm_private.applicants x where rm_private.can_read(p,x) and (coalesce(d->>'status','')='' or x.status=d->>'status') and (coalesce(d->>'unit','')='' or x.hiring_unit=d->>'unit') and (coalesce(d->>'search','')='' or x.full_name ilike '%'||left(d->>'search',100)||'%' or x.phone ilike '%'||left(d->>'search',100)||'%');
 return result||jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select x.id,x.full_name,x.phone,x.position,x.hiring_unit,x.original_unit,x.status,x.version,x.created_at,x.owner_id,x.coach_id,x.supervisor_id,x.slot_id,x.actual_start_date,x.scheduled_start_date,x.resignation_date,x.employment_status from rm_private.applicants x where rm_private.can_read(p,x) and (coalesce(d->>'status','')='' or x.status=d->>'status') and (coalesce(d->>'unit','')='' or x.hiring_unit=d->>'unit') and (coalesce(d->>'search','')='' or x.full_name ilike '%'||left(d->>'search',100)||'%' or x.phone ilike '%'||left(d->>'search',100)||'%') order by x.created_at desc,x.id limit 30 offset idx)q));
 elsif act='dashboard' then
 return jsonb_build_object('counts',(select coalesce(jsonb_object_agg(status,n),'{}') from (select status,count(*) n from rm_private.applicants x where rm_private.can_read(p,x) group by status) q),'retention',(select jsonb_build_object('total',count(*),'active',count(*) filter(where employment_status='ACTIVE'),'rate',round(100.0*count(*) filter(where employment_status='ACTIVE')/nullif(count(*),0),2)) from rm_private.applicants x where rm_private.can_read(p,x) and actual_start_date between day-89 and day and (coalesce(d->>'unit','')='' or x.hiring_unit=d->>'unit')),'kpi14',(select jsonb_build_object('total',count(*),'filled',count(*) filter(where s.first_filled_at is not null),'on_time',count(*) filter(where s.first_filled_at<=r.received_at+interval '14 days'),'overdue',count(*) filter(where s.first_filled_at is null and now()>r.received_at+interval '14 days')) from rm_private.slots s join rm_private.requests r on r.id=s.request_id where r.received_at is not null and s.position='DRIVER' and s.status<>'CANCELLED' and (p.role in ('ADMIN','HR') or r.unit=any(p.units)) and (coalesce(d->>'unit','')='' or r.unit=d->>'unit')));
 elsif act='requests' then
 if p.role not in ('ADMIN','HR','MANAGER') then raise exception 'ไม่มีสิทธิ์ดูคำขอ' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(q)) from(select r.*,(select coalesce(jsonb_agg(to_jsonb(s) order by s.plate,s.position),'[]') from rm_private.slots s where s.request_id=r.id) slots from rm_private.requests r where p.role in ('ADMIN','HR') or r.unit=any(p.units) order by r.created_at desc limit 200)q),'[]');
 elsif act='profiles' then
 if p.role<>'ADMIN' then raise exception 'เฉพาะ Admin' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by display_name) from rm_private.profiles x),'[]');
 elsif act='activities' then
 if p.role<>'ADMIN' then raise exception 'เฉพาะ Admin' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select a.*,p.display_name from rm_private.activities a left join rm_private.profiles p on a.actor_id=p.id order by a.id desc limit 200)x),'[]');
 elsif act='backup' then
 if p.role<>'ADMIN' then raise exception 'เฉพาะ Admin' using errcode='42501';end if;
 return jsonb_build_object('version','4.0.0','exported_at',now(),'units',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from rm_private.units x),'profiles',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from rm_private.profiles x),'applicants',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from rm_private.applicants x),'requests',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from rm_private.requests x),'slots',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from rm_private.slots x),'evaluations',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from rm_private.evaluations x),'topics',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from rm_private.topics x),'training',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from rm_private.training x),'documents',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from rm_private.documents x),'activities',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from rm_private.activities x),'settings',(select data from rm_private.settings where id));
 elsif act in ('reset_preview','reset_transactions') then
 if p.role<>'ADMIN' then raise exception 'เฉพาะ Admin' using errcode='42501';end if;
 -- Stable snapshot under exclusive table locks; every FK-referencing transaction table included.
 lock table rm_private.applicants,rm_private.requests,rm_private.slots,rm_private.evaluations,rm_private.training,rm_private.documents,rm_private.activities in access exclusive mode;
 result:=jsonb_build_object('applicants',(select count(*) from rm_private.applicants),'requests',(select count(*) from rm_private.requests),'slots',(select count(*) from rm_private.slots),'evaluations',(select count(*) from rm_private.evaluations),'training',(select count(*) from rm_private.training),'documents',(select count(*) from rm_private.documents),'storage_files',(select count(*) from storage.objects where bucket_id='recruitment-documents'),'activities',(select count(*) from rm_private.activities),'fingerprint',md5(coalesce((select string_agg(id::text||':'||version,',' order by id) from rm_private.applicants),'')||coalesce((select string_agg(id::text||':'||version,',' order by id)from rm_private.requests),'')||coalesce((select max(id)::text from rm_private.activities),'')));
 if act='reset_preview' then return result;end if;
 if d->>'confirmation' is distinct from 'RESET RECRUITMENT' or d->>'fingerprint' is distinct from result->>'fingerprint' then raise exception 'ต้องยืนยัน RESET RECRUITMENT และตรวจจำนวนใหม่หากข้อมูลเปลี่ยน';end if;
 if (result->>'documents')::int>0 or (result->>'storage_files')::int>0 then raise exception 'ยังมีเอกสารแนบ ต้องสำรองและให้เจ้าของจัดการไฟล์ใน Storage ก่อนรีเซ็ต เพื่อไม่ทิ้งไฟล์ส่วนตัวกำพร้า';end if;
 delete from rm_private.training;delete from rm_private.evaluations;delete from rm_private.activities;
 update rm_private.applicants set slot_id=null;update rm_private.slots set applicant_id=null;
 delete from rm_private.slots;delete from rm_private.requests;delete from rm_private.applicants;
 insert into rm_private.activities(actor_id,action,note) values(p.id,'TRANSACTIONS_RESET',result::text);
 return jsonb_build_object('ok',true,'deleted',result);
 elsif act='create_applicant' then
 if p.role not in ('ADMIN','HR') then raise exception 'เฉพาะ HR' using errcode='42501';end if;
 i:=rm_private.apply(d,false);return jsonb_build_object('id',i);
 elsif act='save_profile' then
 if p.role<>'ADMIN' then raise exception 'เฉพาะ Admin' using errcode='42501';end if;
 perform pg_advisory_xact_lock(40001);
 select id,email into i,note from auth.users where lower(email)=lower(trim(d->>'email'));if i is null then raise exception 'สร้างผู้ใช้ใน Supabase Authentication ก่อน แล้วใส่อีเมลเดียวกัน';end if;
 select * into u from rm_private.profiles where id=i for update;
 if u.id is not null and u.version<>coalesce((d->>'version')::int,0) then raise exception 'ข้อมูลเปลี่ยนแล้ว กรุณารีเฟรช';end if;
 if i=p.id and (d->>'role'<>'ADMIN' or not (d->>'active')::boolean) then raise exception 'ไม่สามารถปิดหรือลดสิทธิ์ตัวเอง';end if;
 if exists(select 1 from jsonb_array_elements_text(d->'units') x where not exists(select 1 from rm_private.units where name=x and active)) then raise exception 'หน่วยงานไม่ถูกต้อง';end if;
 if d->>'role'='MANAGER' and jsonb_array_length(d->'units')=0 then raise exception 'หัวหน้างานต้องมีหน่วยงาน';end if;
 insert into rm_private.profiles(id,email,display_name,role,units,active) values(i,note,trim(d->>'display_name'),d->>'role',array(select jsonb_array_elements_text(d->'units')),(d->>'active')::boolean) on conflict(id) do update set display_name=excluded.display_name,role=excluded.role,units=excluded.units,active=excluded.active,email=excluded.email,version=rm_private.profiles.version+1;
 insert into rm_private.activities(actor_id,action,note)values(p.id,'PROFILE_UPDATED',i::text);return jsonb_build_object('ok',true);
 elsif act='settings' then
 if p.role<>'ADMIN' then raise exception 'เฉพาะ Admin' using errcode='42501';end if;
 if exists(select 1 from jsonb_each_text(d) x where key<>'public_apply' and value<>'' and value !~ '^https://') or exists(select 1 from jsonb_object_keys(d) k where k not in ('public_apply','form_url','sheet_url','drive_url')) then raise exception 'ใช้ URL แบบ https เท่านั้น';end if;
 update rm_private.settings set data=d where id;insert into rm_private.activities(actor_id,action)values(p.id,'SETTINGS_UPDATED');return jsonb_build_object('ok',true);
 elsif act='unit' then
 if p.role<>'ADMIN' then raise exception 'เฉพาะ Admin' using errcode='42501';end if;
 insert into rm_private.units(name)values(trim(d->>'name'));return jsonb_build_object('ok',true);
 elsif act='create_request' then
 if p.role not in ('ADMIN','HR','MANAGER') or not rm_private.allowed_unit(p,d->>'unit') then raise exception 'ไม่มีสิทธิ์ขอคนหน่วยงานนี้' using errcode='42501';end if;
 if not exists(select 1 from rm_private.units where name=d->>'unit' and active) then raise exception 'หน่วยงานไม่ถูกต้อง';end if;
 if jsonb_array_length(d->'lines') not between 1 and 30 then raise exception 'ระบุอัตรา 1–30 รายการ';end if;
 insert into rm_private.requests(title,unit,created_by,notes)values(trim(d->>'title'),d->>'unit',p.id,note)returning id into i;
 insert into rm_private.slots(request_id,plate,fleet_type,position)select i,trim(x->>'plate'),x->>'fleet_type',x->>'position' from jsonb_array_elements(d->'lines')x;
 insert into rm_private.activities(actor_id,action,note)values(p.id,'REQUEST_CREATED',i::text);return jsonb_build_object('id',i);
 elsif act in ('receive_request','cancel_slot') then
 if p.role not in ('ADMIN','HR') then raise exception 'เฉพาะ HR' using errcode='42501';end if;
 if act='receive_request' then
 select * into r from rm_private.requests where id=(d->>'id')::uuid for update;if r.id is null or r.received_at is not null or r.version<>coalesce((d->>'version')::int,0) then raise exception 'คำขอเปลี่ยนแล้ว กรุณารีเฟรช';end if;
 update rm_private.requests set received_at=now(),received_by=p.id,version=version+1 where id=r.id;
 else
 select * into s from rm_private.slots where id=(d->>'id')::uuid for update;if s.id is null or s.status<>'OPEN' or s.applicant_id is not null or s.version<>coalesce((d->>'version')::int,0) then raise exception 'ยกเลิกได้เฉพาะอัตราว่างและข้อมูลล่าสุด';end if;
 if note='' then raise exception 'ระบุเหตุผลยกเลิก';end if;update rm_private.slots set status='CANCELLED',cancel_note=note,version=version+1 where id=s.id;
 end if;insert into rm_private.activities(actor_id,action,note)values(p.id,upper(act),d->>'id');return jsonb_build_object('ok',true);
 elsif act='save_topic' then
 if p.role not in ('ADMIN','HR','COACH','SAFETY','DISPATCH_MANAGER','DRIVER_TRAINER','MANAGER') then raise exception 'ไม่มีสิทธิ์';end if;
 if p.role='COACH' and d->>'category'<>'COACH' or p.role in ('SAFETY','DRIVER_TRAINER') and d->>'category'<>p.role then raise exception 'หัวข้อไม่ตรงบทบาท';end if;
 if p.role='MANAGER' and not coalesce(d->>'unit'=any(p.units),false) then raise exception 'เลือกหน่วยงานที่รับผิดชอบ';end if;
 insert into rm_private.topics(title,category,position,unit)values(trim(d->>'title'),d->>'category',nullif(d->>'position',''),nullif(d->>'unit',''));return jsonb_build_object('ok',true);
 end if;
 -- Applicant commands lock in one order (applicant then slot), with optimistic version check.
 select * into a from rm_private.applicants where id=(d->>'id')::uuid for update;
 if a.id is null or not rm_private.can_read(p,a) then raise exception 'ไม่พบข้อมูลหรือไม่มีสิทธิ์' using errcode='42501';end if;
 if act='detail' then
 return jsonb_build_object('applicant',case when p.role in ('ADMIN','HR','MANAGER') then to_jsonb(a) else to_jsonb(a)||jsonb_build_object('data',a.data-array['national_id','id_issued_at','id_expires_at','driver_license_no','birth_date']) end,'evaluations',case when p.role in ('ADMIN','HR','MANAGER') then coalesce((select jsonb_agg(to_jsonb(e) order by round desc) from rm_private.evaluations e where applicant_id=a.id),'[]') else '[]'::jsonb end,'training',coalesce((select jsonb_agg(to_jsonb(q))from(select tr.*,t.title from rm_private.training tr join rm_private.topics t on tr.topic_id=t.id where tr.applicant_id=a.id order by tr.training_date desc)q),'[]'),'documents',case when p.role in ('ADMIN','HR','MANAGER') then coalesce((select jsonb_agg(to_jsonb(x))from rm_private.documents x where applicant_id=a.id),'[]') else '[]'::jsonb end,'activities',coalesce((select jsonb_agg(to_jsonb(q))from(select x.id,x.action,x.note,x.created_at,u.display_name from rm_private.activities x left join rm_private.profiles u on u.id=x.actor_id where applicant_id=a.id order by x.id desc limit 50)q),'[]'),'duplicates',case when p.role in ('ADMIN','HR') then coalesce((select jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,'status',status)) from rm_private.applicants x where x.id<>a.id and (x.phone=a.phone or x.data->>'national_id'=a.data->>'national_id')),'[]') else '[]'::jsonb end);
 end if;
 if a.version<>coalesce((d->>'version')::int,0) then raise exception 'ข้อมูลเปลี่ยนแล้ว กรุณาเปิดรายการใหม่ก่อนบันทึก' using errcode='40001';end if;
 if act='edit_applicant' then
 if p.role not in ('ADMIN','HR') then raise exception 'เฉพาะ HR' using errcode='42501';end if;
 if not exists(select 1 from rm_private.units where name=d->>'unit' and active) then raise exception 'หน่วยงานไม่ถูกต้อง';end if;
 if a.hiring_unit<>d->>'unit' then
 if note='' then raise exception 'ระบุเหตุผลเปลี่ยนหน่วยงาน';end if;perform rm_private.release_slot(a);
 delete from rm_private.evaluations where applicant_id=a.id and round=a.round and stage='DRAFT';
 update rm_private.applicants set owner_id=null,supervisor_id=null,data=data-'plate'-'fleet_type',status=case when status='INTERVIEW' then 'HR_REVIEW' else status end where id=a.id;
 end if;
 clean:=rm_private.clean_data(d->'data');perform rm_private.validate_data(clean,a.position);
 update rm_private.applicants set full_name=trim(d->>'full_name'),phone=trim(d->>'phone'),hiring_unit=d->>'unit',data=data||clean where id=a.id;
 elsif act='screen' then
 if p.role not in ('ADMIN','HR') or a.status not in ('HR_REVIEW','WAITING_INFO','INTERVIEW') or a.owner_id is not null then raise exception 'HR คัดกรองได้ก่อนมีผู้รับงานสัมภาษณ์';end if;
 if coalesce(d->>'result','') not in ('FORWARD','MORE_INFO','REJECT') then raise exception 'ผลคัดกรองไม่ถูกต้อง';end if;
 if d->>'result'<>'FORWARD' and note='' then raise exception 'ระบุเหตุผล';end if;
 if d->>'result'='MORE_INFO' and (nullif(d->>'followup_date','')::date is null or (d->>'followup_date')::date<day) then raise exception 'ระบุวันติดตามตั้งแต่วันนี้';end if;
 if d->>'result'='FORWARD' and exists(select 1 from rm_private.applicants x where x.id<>a.id and (x.phone=a.phone or x.data->>'national_id'=a.data->>'national_id')) and trim(coalesce(d->>'duplicate_note',''))='' then raise exception 'พบใบสมัครซ้ำ กรุณาตรวจและบันทึกเหตุผล';end if;
 if d->>'result'='FORWARD' and (extract(year from age(day,(a.data->>'birth_date')::date)) < case when a.position='DRIVER' then 25 else 18 end) and trim(coalesce(d->>'age_note',''))='' then raise exception 'อายุต่ำกว่าเกณฑ์ (คนขับ 25 ปี / เด็กติดรถ 18 ปี) ระบุเหตุผลอนุมัติข้อยกเว้น';end if;
 update rm_private.applicants set status=case d->>'result' when 'FORWARD' then 'INTERVIEW' when 'MORE_INFO' then 'WAITING_INFO' else 'REJECTED' end,data=data||jsonb_build_object('screen_note',note,'forwarded_at',case when d->>'result'='FORWARD' then now()::text else a.data->>'forwarded_at' end,'followup_date',coalesce(d->>'followup_date',''),'age_note',coalesce(d->>'age_note',''),'duplicate_note',coalesce(d->>'duplicate_note','')) where id=a.id;
 elsif act in ('claim','release_interview') then
 if p.role<>'MANAGER' and not(p.role in ('ADMIN','HR') and act='release_interview') then raise exception 'เฉพาะหัวหน้างาน';end if;
 if p.role='MANAGER' and not rm_private.allowed_unit(p,a.hiring_unit) or a.status<>'INTERVIEW' then raise exception 'รับงานได้เฉพาะหน่วยงานที่รับผิดชอบ';end if;
 if act='claim' then
 if a.owner_id is not null and a.owner_id<>p.id then raise exception 'มีผู้รับงานแล้ว';end if;update rm_private.applicants set owner_id=p.id where id=a.id;
 else
 if p.role='MANAGER' and a.owner_id is distinct from p.id then raise exception 'คืนได้เฉพาะงานของตนเอง';end if;update rm_private.applicants set owner_id=null where id=a.id;delete from rm_private.evaluations where applicant_id=a.id and round=a.round and stage='DRAFT';end if;
 elsif act='interview' then
 if p.role<>'MANAGER' or a.owner_id is distinct from p.id or not rm_private.allowed_unit(p,a.hiring_unit) or a.status<>'INTERVIEW' then raise exception 'รับงานสัมภาษณ์ในหน่วยงานของตนก่อน' using errcode='42501';end if;
 if exists(select 1 from rm_private.evaluations where applicant_id=a.id and round=a.round and stage='SUBMITTED') then raise exception 'รอบนี้ยืนยันแล้ว';end if;
 if coalesce((d->>'submit')::boolean,false) and (nullif(d->>'score','')::int is null or coalesce(d->>'result','') not in ('PASS','FAIL')) then raise exception 'ระบุคะแนน 1–5 และผลสัมภาษณ์';end if;
 if d->>'result'='PASS' and d->>'road_result'='FAIL' then raise exception 'ผลทดลองขับไม่ผ่าน ไม่สามารถยืนยันผ่านสัมภาษณ์';end if;
 insert into rm_private.evaluations(applicant_id,round,evaluator_id,stage,score,result,road_result,fuel,note)values(a.id,a.round,p.id,case when (d->>'submit')::boolean then 'SUBMITTED' else 'DRAFT' end,nullif(d->>'score','')::int,nullif(d->>'result',''),case when a.position='DRIVER' then nullif(d->>'road_result','') else null end,left(coalesce(d->>'fuel',''),300),note)on conflict(applicant_id,round) do update set evaluator_id=excluded.evaluator_id,stage=excluded.stage,score=excluded.score,result=excluded.result,road_result=excluded.road_result,fuel=excluded.fuel,note=excluded.note,updated_at=now();
 if (d->>'submit')::boolean then
 if d->>'result'='PASS' then
 if a.slot_id is not null then select * into s from rm_private.slots where id=a.slot_id for update;if s.applicant_id is distinct from a.id or s.status<>'MATCHED' then raise exception 'การผูกคำขอเปลี่ยนแล้ว';end if;update rm_private.slots set status='FILLED',filled_at=now(),first_filled_at=coalesce(first_filled_at,now()),version=version+1 where id=s.id;end if;
 update rm_private.applicants set status='HIRED',data=data||jsonb_build_object('accepted_at',now()) where id=a.id;
 else perform rm_private.release_slot(a);update rm_private.applicants set status='REJECTED' where id=a.id;end if;end if;
 elsif act='match' then
 if p.role not in ('ADMIN','HR') or a.status not in ('HR_REVIEW','WAITING_INFO','INTERVIEW','RESERVE','HIRED') then raise exception 'ไม่สามารถผูกคำขอในสถานะนี้';end if;
 perform rm_private.release_slot(a);
 if coalesce(d->>'slot_id','')<>'' then
 select * into s from rm_private.slots where id=(d->>'slot_id')::uuid for update;select * into r from rm_private.requests where id=s.request_id;
 if s.id is null or s.applicant_id is not null or s.status<>'OPEN' or r.received_at is null or r.unit<>a.hiring_unit or s.position<>a.position then raise exception 'อัตราไม่ว่าง/หน่วยงานหรือตำแหน่งไม่ตรง';end if;
 update rm_private.slots set applicant_id=a.id,status=case when a.status='HIRED' then 'FILLED' else 'MATCHED' end,filled_at=case when a.status='HIRED' then now() end,first_filled_at=case when a.status='HIRED' then coalesce(first_filled_at,now()) else first_filled_at end,version=version+1 where id=s.id;
 update rm_private.applicants set slot_id=s.id,data=data||jsonb_build_object('plate',s.plate,'fleet_type',s.fleet_type)where id=a.id;
 end if;
 elsif act='reserve' then
 if p.role not in ('ADMIN','HR') or a.status not in ('HR_REVIEW','WAITING_INFO','INTERVIEW','HIRED','REJECTED') or note='' then raise exception 'ระบุเหตุผลและสำรองก่อนเริ่มงาน';end if;
 perform rm_private.release_slot(a);update rm_private.applicants set status='RESERVE',owner_id=null,data=data||jsonb_build_object('reserve_note',note)where id=a.id;
 elsif act='recall' then
 if p.role not in ('ADMIN','HR') or a.status<>'RESERVE' or note='' then raise exception 'เรียกกลับได้เฉพาะผู้สมัครสำรองและต้องระบุเหตุผล';end if;
 -- Reuse means copying the last result into a new draft; manager still confirms the new round.
 update rm_private.applicants set status='HR_REVIEW',owner_id=null,round=round+1,data=data||jsonb_build_object('recall_note',note)where id=a.id;
 if coalesce((d->>'reuse')::boolean,false) then insert into rm_private.evaluations(applicant_id,round,evaluator_id,stage,score,result,road_result,fuel,note)select a.id,a.round+1,p.id,'DRAFT',score,result,road_result,fuel,'ใช้ผลเดิมเพื่อทบทวน | '||note from rm_private.evaluations where applicant_id=a.id and stage='SUBMITTED' order by round desc limit 1;end if;
 elsif act='handover' then
 if p.role not in ('ADMIN','HR','MANAGER','DISPATCH_MANAGER') or not rm_private.allowed_unit(p,a.hiring_unit) or a.status not in ('HIRED','STARTED') then raise exception 'ไม่มีสิทธิ์ส่งมอบพนักงานนี้';end if;
 if coalesce(d->>'coach_id','')<>'' and not exists(select 1 from rm_private.profiles where id=(d->>'coach_id')::uuid and active and role='COACH') then raise exception 'Coach ไม่ถูกต้อง';end if;
 if coalesce(d->>'supervisor_id','')<>'' and not exists(select 1 from rm_private.profiles where id=(d->>'supervisor_id')::uuid and active and role='MANAGER' and a.hiring_unit=any(units)) then raise exception 'ผู้ดูแลไม่ตรงหน่วยงาน';end if;
 if a.slot_id is not null then select * into s from rm_private.slots where id=a.slot_id;if coalesce(d->>'plate','')<>s.plate or d->>'fleet_type'<>s.fleet_type then raise exception 'ทะเบียนและรถต้องตรงคำขอ หรือให้ HR ปลดคำขอก่อน';end if;end if;
 if coalesce(d->>'fleet_type','') not in ('','COMPANY','PARTNER') then raise exception 'ประเภทรถไม่ถูกต้อง';end if;
 update rm_private.applicants set coach_id=nullif(d->>'coach_id','')::uuid,supervisor_id=nullif(d->>'supervisor_id','')::uuid,data=data||jsonb_build_object('plate',left(coalesce(d->>'plate',''),50),'fleet_type',coalesce(d->>'fleet_type','')) where id=a.id;
 elsif act='employment' then
 if p.role not in ('ADMIN','HR','MANAGER','DISPATCH_MANAGER') or not rm_private.allowed_unit(p,a.hiring_unit) or a.status not in ('HIRED','STARTED') then raise exception 'ไม่มีสิทธิ์แก้การเริ่มงาน';end if;
 start_date:=nullif(d->>'actual_start_date','')::date;end_date:=nullif(d->>'resignation_date','')::date;
 if a.actual_start_date is not null and start_date is distinct from a.actual_start_date and exists(select 1 from rm_private.training where applicant_id=a.id) then raise exception 'มีผลอบรมแล้ว ไม่สามารถเปลี่ยนวันเริ่มงาน';end if;
 if start_date>day or end_date>day or end_date is not null and (start_date is null or end_date<start_date) then raise exception 'วันเริ่มงาน/ลาออกไม่ถูกต้อง';end if;
 if a.status='STARTED' and start_date is null then raise exception 'ไม่สามารถลบวันเริ่มงานจริง';end if;
 if end_date is not null and note='' then raise exception 'ระบุเหตุผลลาออก';end if;
 update rm_private.applicants set scheduled_start_date=nullif(d->>'scheduled_start_date','')::date,actual_start_date=start_date,resignation_date=end_date,employment_status=case when end_date is not null then 'RESIGNED' when start_date is not null then 'ACTIVE' else 'PENDING' end,status=case when start_date is not null then 'STARTED' else 'HIRED' end where id=a.id;
 if end_date is not null then perform rm_private.release_slot(a);end if;
 elsif act='close' then
 if p.role not in ('ADMIN','HR') or a.status='STARTED' or note='' or d->>'result' not in ('WITHDRAWN','NO_SHOW','CANCELLED') then raise exception 'ระบุสถานะปิดเคสและเหตุผล ก่อนเริ่มงานจริง';end if;
 perform rm_private.release_slot(a);update rm_private.applicants set status=d->>'result',data=data||jsonb_build_object('closed_note',note),owner_id=null where id=a.id;
 elsif act='contact' then
 if p.role not in ('ADMIN','HR') or note='' then raise exception 'เฉพาะ HR และต้องระบุบันทึก';end if;
 if coalesce(d->>'next_contact_date','')<>'' then start_date:=(d->>'next_contact_date')::date;end if;
 update rm_private.applicants set data=data||jsonb_build_object('contact_note',note,'next_contact_date',coalesce(d->>'next_contact_date','')) where id=a.id;
 elsif act='training' then
 select * into t from rm_private.topics where id=(d->>'topic_id')::uuid and active;
 if t.id is null or not rm_private.can_train(p,a,t.category) or a.status<>'STARTED' or a.actual_start_date is null or t.position is not null and t.position<>a.position or t.unit is not null and t.unit<>a.hiring_unit then raise exception 'ไม่มีสิทธิ์อบรม/หัวข้อไม่ตรงพนักงาน' using errcode='42501';end if;
 if nullif(d->>'training_date','')::date is null or (d->>'training_date')::date not between a.actual_start_date and day then raise exception 'วันอบรมต้องอยู่ระหว่างวันเริ่มงานถึงวันนี้';end if;
 if a.resignation_date is not null and (d->>'training_date')::date>a.resignation_date then raise exception 'วันอบรมต้องไม่หลังวันลาออก';end if;
 if coalesce(d->>'training_id','')<>'' then select * into tr from rm_private.training where id=(d->>'training_id')::uuid for update;
 if tr.id is null or tr.applicant_id<>a.id or tr.version<>coalesce((d->>'training_version')::int,0) or tr.category<>t.category or not rm_private.can_train(p,a,tr.category) or note='' then raise exception 'ไม่มีสิทธิ์แก้ผลเดิม/ข้อมูลเปลี่ยนแล้ว หรือยังไม่ระบุเหตุผล';end if;
 update rm_private.training set topic_id=t.id,training_date=(d->>'training_date')::date,result=d->>'result',note=note,updated_by=p.id,updated_at=now(),version=version+1 where id=tr.id;
 else insert into rm_private.training(applicant_id,topic_id,category,training_date,result,note,created_by,updated_by)values(a.id,t.id,t.category,(d->>'training_date')::date,d->>'result',note,p.id,p.id);end if;
 elsif act='document' then
 if p.role not in ('ADMIN','HR','MANAGER') or p.role='MANAGER' and not rm_private.allowed_unit(p,a.hiring_unit) then raise exception 'ไม่มีสิทธิ์เอกสาร';end if;
 if d->>'path' not like p.id::text||'/'||a.id::text||'/%' or length(d->>'title') not between 1 and 200 then raise exception 'เส้นทางไฟล์ไม่ถูกต้อง';end if;
 insert into rm_private.documents(applicant_id,path,title,created_by)values(a.id,d->>'path',d->>'title',p.id);
 else raise exception 'ไม่รองรับคำสั่งนี้';end if;
 update rm_private.applicants set version=version+1,updated_at=now() where id=a.id;
 insert into rm_private.activities(applicant_id,actor_id,action,note)values(a.id,p.id,upper(act),note);
 return jsonb_build_object('ok',true);
end $$;
create function public.recruitment_command(p_action text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select rm_private.command(p_action,p_payload) $$;
-- Definer functions are private and narrowly granted; never expose rm_private via Data API.
revoke all on all functions in schema rm_private from public,anon,authenticated;
grant execute on function rm_private.command(text,jsonb) to authenticated;
-- apply is callable only through checked definer functions.
-- Do not grant apply(false) to anon: its public entrypoint uses a separate fixed-true wrapper.
create function rm_private.public_apply(d jsonb) returns uuid language sql security definer set search_path='' as $$ select rm_private.apply(d,true) $$;
revoke all on function rm_private.public_apply(jsonb) from public;
grant execute on function rm_private.public_apply(jsonb),rm_private.public_info() to anon,authenticated;
create or replace function public.recruitment_apply(p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select jsonb_build_object('id',rm_private.public_apply(p_payload)) $$;
revoke all on function public.recruitment_command(text,jsonb),public.recruitment_apply(jsonb),public.recruitment_public_info() from public;
grant execute on function public.recruitment_command(text,jsonb) to authenticated;
grant execute on function public.recruitment_apply(jsonb),public.recruitment_public_info() to anon,authenticated;
-- Private document bucket. Authenticated uploads only; applicants give documents to HR.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('recruitment-documents','recruitment-documents',false,5242880,array['application/pdf','image/jpeg','image/png']) on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
create function rm_private.document_access(path text,upload boolean) returns boolean language plpgsql security definer set search_path='' as $$ declare p rm_private.profiles;a rm_private.applicants;begin
 p:=rm_private.actor();select * into a from rm_private.applicants where id=split_part(path,'/',2)::uuid;
 return a.id is not null and p.role in ('ADMIN','HR','MANAGER') and rm_private.can_read(p,a) and (not upload or (split_part(path,'/',1)=p.id::text and rm_private.allowed_unit(p,a.hiring_unit)));
 exception when others then return false;end $$;
revoke all on function rm_private.document_access(text,boolean) from public;
grant execute on function rm_private.document_access(text,boolean) to authenticated;
create policy recruitment_documents_read on storage.objects for select to authenticated using(bucket_id='recruitment-documents' and rm_private.document_access(name,false));
create policy recruitment_documents_upload on storage.objects for insert to authenticated with check(bucket_id='recruitment-documents' and rm_private.document_access(name,true));
commit;
