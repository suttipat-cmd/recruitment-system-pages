do $guard$ begin
 if (select md5(prosrc) from pg_proc where oid='rm_private.command(text,jsonb)'::regprocedure)<>'2cf0c7c951b996456d1a9bafb922a0db' or (select md5(prosrc) from pg_proc where oid='rm_private.applicant_list(rm_private.profiles,jsonb)'::regprocedure)<>'7fe1a2d34cbe3e301b230fca03ecbd51' then raise exception 'ฐานต่างจาก V4.9 ที่ตรวจแล้ว กรุณาตรวจความต่างก่อนติดตั้ง Drive';end if;
end $guard$;
-- Additive, disabled until the owner deploys/configures the Apps Script bridge.
alter table rm_private.applicants add column if not exists document_code text unique;
create table rm_private.drive_config(id boolean primary key default true check(id),enabled boolean not null default false,bridge_url text,bridge_key_hash text,
 check(bridge_url is null or bridge_url ~ '^https://script[.]google[.]com/macros/s/[A-Za-z0-9_-]+/exec$'),check(bridge_key_hash is null or bridge_key_hash ~ '^[0-9a-f]{64}$'));
insert into rm_private.drive_config(id) values(true);
create table rm_private.drive_upload_grants(id uuid primary key default gen_random_uuid(),applicant_id uuid not null references rm_private.applicants(id),token_hash text unique not null,submission_hash text unique not null,expires_at timestamptz not null,max_files int not null check(max_files between 1 and 10));
create table rm_private.drive_attachments(id uuid primary key,applicant_id uuid not null references rm_private.applicants(id),folder_code text not null,filename text not null,mime_type text not null check(mime_type in ('image/jpeg','image/png','application/pdf')),byte_size int not null check(byte_size between 1 and 10485760),sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),drive_file_id text unique,state text not null default 'PENDING' check(state in ('PENDING','READY')),created_by uuid references rm_private.profiles(id),grant_id uuid references rm_private.drive_upload_grants(id),authorized_by uuid references rm_private.profiles(id),authorized_until timestamptz not null,created_at timestamptz not null default now(),ready_at timestamptz);
create index on rm_private.drive_attachments(applicant_id,created_at);
create index on rm_private.drive_attachments(grant_id);
alter table rm_private.drive_config enable row level security;
alter table rm_private.drive_upload_grants enable row level security;
alter table rm_private.drive_attachments enable row level security;
revoke all on rm_private.drive_config,rm_private.drive_upload_grants,rm_private.drive_attachments from public,anon,authenticated;
create function rm_private.drive_hash(value text) returns text language sql immutable set search_path='' as $$select encode(sha256(convert_to(value,'UTF8')),'hex')$$;
revoke all on function rm_private.drive_hash(text) from public,anon,authenticated;
create function rm_private.drive_status() returns jsonb language sql security definer stable set search_path='' as $$select jsonb_build_object('enabled',enabled and bridge_url is not null and bridge_key_hash is not null,'url',case when enabled then bridge_url end) from rm_private.drive_config where id$$;
create function public.recruitment_drive_status() returns jsonb language sql security invoker set search_path='' as $$select rm_private.drive_status()$$;
create function rm_private.apply_with_documents(d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i uuid;t text;code text;g rm_private.drive_upload_grants;n int:=coalesce((d->>'document_count')::int,0);begin
 if n not between 0 and 10 then raise exception 'แนบได้สูงสุด 10 ไฟล์ต่อครั้ง';end if;
 if n>0 and not coalesce((rm_private.drive_status()->>'enabled')::boolean,false) then raise exception 'ยังไม่เปิดรับไฟล์แนบ';end if;
 if n>0 then
  perform pg_advisory_xact_lock(hashtextextended(rm_private.drive_hash(coalesce(d->>'access_token','')),410));
  select * into g from rm_private.drive_upload_grants where submission_hash=rm_private.drive_hash(coalesce(d->>'access_token','')) and expires_at>clock_timestamp();
  if g.id is not null then
   if n<>g.max_files then raise exception 'จำนวนไฟล์ต่างจากใบสมัครที่บันทึกแล้ว';end if;
   select document_code into code from rm_private.applicants where id=g.applicant_id;
   select rm_private.drive_hash(secret||':'||(d->>'access_token')) into t from rm_private.application_gate where id;
   return jsonb_build_object('id',g.applicant_id,'reference_code',code,'upload_token',t,'expires_in',greatest(0,extract(epoch from g.expires_at-clock_timestamp())::int));
  end if;
 end if;
 i:=rm_private.public_apply(d-'document_count');
 select (case when position='DRIVER' then 'DRV-' else 'AST-' end)||to_char(created_at at time zone 'Asia/Bangkok','YYYYMMDD')||'-'||upper(left(replace(id::text,'-',''),8)) into code from rm_private.applicants where id=i;
 if n>0 then
 update rm_private.applicants set document_code=code where id=i;
 select rm_private.drive_hash(secret||':'||(d->>'access_token')) into t from rm_private.application_gate where id;
 insert into rm_private.drive_upload_grants(applicant_id,token_hash,submission_hash,expires_at,max_files) values(i,rm_private.drive_hash(t),rm_private.drive_hash(d->>'access_token'),clock_timestamp()+interval '2 hours',n);
 end if;
 return jsonb_build_object('id',i,'reference_code',code,'upload_token',t,'expires_in',case when n>0 then 7200 else 0 end);
end $$;
create function public.recruitment_apply_with_documents(p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select rm_private.apply_with_documents(p_payload)$$;
create function rm_private.drive_documents(i uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p rm_private.profiles;a rm_private.applicants;begin
 p:=rm_private.actor();select * into a from rm_private.applicants where id=i;
 if a.id is null or not rm_private.can_read(p,a) then raise exception 'ไม่มีสิทธิ์ดูเอกสาร' using errcode='42501';end if;
 if not coalesce((rm_private.drive_status()->>'enabled')::boolean,false) then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'applicant_id',x.applicant_id,'folder_code',x.folder_code,'filename',x.filename,'mime_type',x.mime_type,'byte_size',x.byte_size,'state',x.state,'created_at',x.created_at) order by x.created_at,x.id) from rm_private.drive_attachments x where x.applicant_id=a.id and (x.state='READY' or p.role in ('ADMIN','HR'))),'[]'::jsonb);
end $$;
create function public.recruitment_drive_documents(p_applicant_id uuid) returns jsonb language sql security invoker set search_path='' as $$select rm_private.drive_documents(p_applicant_id)$$;
create function rm_private.drive_authorize(d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p rm_private.profiles;a rm_private.applicants;g rm_private.drive_upload_grants;f rm_private.drive_attachments;act text:=d->>'action';i uuid:=(d->>'applicant_id')::uuid;doc_id uuid:=(d->>'document_id')::uuid;code text;begin
 if not coalesce((rm_private.drive_status()->>'enabled')::boolean,false) then raise exception 'ยังไม่เปิดใช้งานไฟล์แนบ' using errcode='42501';end if;
 if coalesce(act,'') not in ('upload','read','recover') or i is null or doc_id is null then raise exception 'คำขอไม่ถูกต้อง';end if;
 select * into a from rm_private.applicants where id=i for update;
 if a.id is null then raise exception 'ไม่พบรายการหรือไม่มีสิทธิ์' using errcode='42501';end if;
 if auth.uid() is not null then
 p:=rm_private.actor();
 if not rm_private.can_read(p,a) or (act in ('upload','recover') and p.role not in ('ADMIN','HR')) then raise exception 'ไม่มีสิทธิ์เอกสาร' using errcode='42501';end if;
 else
 if act<>'upload' or length(coalesce(d->>'upload_token',''))<60 then raise exception 'ไม่มีสิทธิ์เอกสาร' using errcode='42501';end if;
 select * into g from rm_private.drive_upload_grants where applicant_id=i and token_hash=rm_private.drive_hash(d->>'upload_token') and expires_at>clock_timestamp() for update;
 if g.id is null then raise exception 'สิทธิ์แนบไฟล์หมดอายุ กรุณาติดต่อ HR' using errcode='42501';end if;
 end if;
 select * into f from rm_private.drive_attachments where id=doc_id for update;
 if act='read' then
 if f.id is null or f.applicant_id<>i or f.state<>'READY' then raise exception 'ไม่พบไฟล์ที่พร้อมดู';end if;
 return to_jsonb(f)-array['grant_id','authorized_by','authorized_until','created_by'];
 end if;
 if act='recover' then
 if f.id is null or f.applicant_id<>i then raise exception 'ไม่พบไฟล์';end if;
 update rm_private.drive_attachments set authorized_by=p.id,authorized_until=clock_timestamp()+interval '10 minutes' where id=f.id returning * into f;
 return to_jsonb(f)-array['grant_id','authorized_by','authorized_until','created_by'];
 end if;
 if coalesce(d->>'mime_type','') not in ('image/jpeg','image/png','application/pdf') or coalesce((d->>'byte_size')::int,0) not between 1 and 10485760 or coalesce(d->>'sha256','') !~ '^[0-9a-f]{64}$' or length(trim(coalesce(d->>'filename',''))) not between 1 and 200 or d->>'filename' ~ '[[:cntrl:]/\\]' then raise exception 'รองรับ JPG PNG PDF ไม่เกิน 10 MB ต่อไฟล์';end if;
 if f.id is not null then
 if f.applicant_id<>i or (p.id is null and f.grant_id is distinct from g.id) or (p.id is not null and f.created_by is distinct from p.id) or f.filename<>d->>'filename' or f.mime_type<>d->>'mime_type' or f.byte_size<>(d->>'byte_size')::int or f.sha256<>d->>'sha256' then raise exception 'รหัสส่งไฟล์ซ้ำกับข้อมูลอื่น';end if;
 update rm_private.drive_attachments set authorized_by=p.id,authorized_until=clock_timestamp()+interval '10 minutes' where id=f.id returning * into f;
 else
 if g.id is not null and (select count(*) from rm_private.drive_attachments where grant_id=g.id)>=g.max_files then raise exception 'ครบจำนวนไฟล์ที่เลือกแล้ว กรุณาติดต่อ HR หากต้องการแนบเพิ่ม';end if;
 code:=coalesce(a.document_code,(case when a.position='DRIVER' then 'DRV-' else 'AST-' end)||to_char(a.created_at at time zone 'Asia/Bangkok','YYYYMMDD')||'-'||upper(left(replace(a.id::text,'-',''),8)));
 if a.document_code is null then update rm_private.applicants set document_code=code where id=i;end if;
 insert into rm_private.drive_attachments(id,applicant_id,folder_code,filename,mime_type,byte_size,sha256,created_by,grant_id,authorized_by,authorized_until) values(doc_id,i,code,d->>'filename',d->>'mime_type',(d->>'byte_size')::int,d->>'sha256',p.id,g.id,p.id,clock_timestamp()+interval '10 minutes') returning * into f;
 end if;
 return to_jsonb(f)-array['grant_id','authorized_by','authorized_until','created_by'];
end $$;
create function public.recruitment_drive_authorize(p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select rm_private.drive_authorize(p_payload)$$;
create function rm_private.drive_commit(d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c rm_private.drive_config;f rm_private.drive_attachments;p rm_private.profiles;begin
 select * into c from rm_private.drive_config where id;
 if not c.enabled or c.bridge_key_hash is null or length(coalesce(d->>'bridge_key',''))<60 or rm_private.drive_hash(d->>'bridge_key')<>c.bridge_key_hash then raise exception 'ไม่มีสิทธิ์บันทึกไฟล์' using errcode='42501';end if;
 select * into f from rm_private.drive_attachments where id=(d->>'document_id')::uuid for update;
 if f.id is null or coalesce(d->>'file_id','') !~ '^[A-Za-z0-9_-]{10,200}$' or f.sha256<>coalesce(d->>'sha256','') then raise exception 'ข้อมูลไฟล์ไม่ตรงกับรายการที่อนุญาต';end if;
 if f.state='READY' then
 if f.drive_file_id<>d->>'file_id' then raise exception 'ไฟล์เดิมถูกบันทึกแล้ว';end if;
 return jsonb_build_object('ok',true,'id',f.id);
 end if;
 if f.authorized_until<clock_timestamp() then raise exception 'สิทธิ์ส่งไฟล์หมดอายุ กรุณาลองใหม่';end if;
 if f.authorized_by is not null then
 select * into p from rm_private.profiles where id=f.authorized_by and active and role in ('ADMIN','HR');
 if p.id is null then raise exception 'บัญชีถูกปิดสิทธิ์' using errcode='42501';end if;
 elsif not exists(select 1 from rm_private.drive_upload_grants where id=f.grant_id and expires_at>clock_timestamp()) then raise exception 'สิทธิ์ผู้สมัครหมดอายุ';end if;
 update rm_private.drive_attachments set drive_file_id=d->>'file_id',state='READY',ready_at=clock_timestamp() where id=f.id;
 insert into rm_private.activities(applicant_id,actor_id,action,note)values(f.applicant_id,f.authorized_by,'DRIVE_DOCUMENT_ADDED',f.filename);
 return jsonb_build_object('ok',true,'id',f.id);
end $$;
create function public.recruitment_drive_commit(p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select rm_private.drive_commit(p_payload)$$;
-- Persist folder/reference codes when position changes after an attachment is added.
do $patch$ declare definition text;old text:=$old$(case when x.position='DRIVER' then 'DRV-' else 'AST-' end)||to_char(x.created_at at time zone 'Asia/Bangkok','YYYYMMDD')||'-'||upper(left(replace(x.id::text,'-',''),8)) as applicant_code$old$;begin
 definition:=pg_get_functiondef('rm_private.applicant_list(rm_private.profiles,jsonb)'::regprocedure);
 if position(old in definition)=0 then raise exception 'Applicant list differs; inspect before updating attachment codes';end if;
 execute replace(definition,old,'coalesce(x.document_code,'||replace(old,' as applicant_code',') as applicant_code'));
end $patch$;
-- Reset remains blocked when Drive documents OR incomplete uploads exist. Avoid orphaning real files.
do $patch$ declare definition text;old text:=$old$if (result->>'documents')::int>0 or (result->>'storage_files')::int>0 then$old$;begin
 definition:=pg_get_functiondef('rm_private.command(text,jsonb)'::regprocedure);
 if position(old in definition)=0 then raise exception 'Reset guard differs; inspect before updating';end if;
 definition:=replace(definition,'''settings'',(select data from rm_private.settings where id)', '''drive_attachments'',(select coalesce(jsonb_agg(to_jsonb(x)),''[]'') from rm_private.drive_attachments x),''settings'',(select data from rm_private.settings where id)');
 definition:=replace(definition,'''documents'',(select count(*) from rm_private.documents)', '''documents'',((select count(*) from rm_private.documents)+(select count(*) from rm_private.drive_attachments))');
 definition:=replace(definition,'delete from rm_private.slots;delete from rm_private.requests;delete from rm_private.applicants;', 'delete from rm_private.drive_upload_grants;delete from rm_private.slots;delete from rm_private.requests;delete from rm_private.applicants;');
 definition:=replace(definition,'จัดการไฟล์ใน Storage ก่อนรีเซ็ต','จัดการไฟล์ใน Drive/Storage และรายการอัปโหลดค้างก่อนรีเซ็ต');
 execute replace(definition,old,$new$if exists(select 1 from rm_private.drive_attachments) or (result->>'documents')::int>0 or (result->>'storage_files')::int>0 then$new$);
end $patch$;
revoke all on function rm_private.drive_status(),rm_private.apply_with_documents(jsonb),rm_private.drive_documents(uuid),rm_private.drive_authorize(jsonb),rm_private.drive_commit(jsonb) from public,anon,authenticated;
revoke all on function public.recruitment_drive_status(),public.recruitment_apply_with_documents(jsonb),public.recruitment_drive_documents(uuid),public.recruitment_drive_authorize(jsonb),public.recruitment_drive_commit(jsonb) from public,anon,authenticated;
grant execute on function rm_private.drive_status(),rm_private.apply_with_documents(jsonb),rm_private.drive_authorize(jsonb),rm_private.drive_commit(jsonb),public.recruitment_drive_status(),public.recruitment_apply_with_documents(jsonb),public.recruitment_drive_authorize(jsonb),public.recruitment_drive_commit(jsonb) to anon,authenticated;
grant execute on function rm_private.drive_documents(uuid),public.recruitment_drive_documents(uuid) to authenticated;
