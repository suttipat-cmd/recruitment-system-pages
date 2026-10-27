do $guard$ begin if (select md5(prosrc) from pg_proc where oid='rm_private.command(text,jsonb)'::regprocedure)<>'09090512bdc9eaa78ee638a1b68d8acb' then raise exception 'ฐานต่างจาก V4.10 ที่ตรวจแล้ว หยุดติดตั้งก่อน';end if;end $guard$;
-- V4.11: isolated corrections; no data rewrites or new grants.
create function rm_private.correct_applicant(p rm_private.profiles,a rm_private.applicants,d jsonb,act text) returns jsonb
language plpgsql set search_path='' as $$
declare clean jsonb;merged jsonb;changes jsonb:='[]';k text;oldval text;newval text;nm text:=a.full_name;ph text:=a.phone;pos text:=a.position;u text:=a.hiring_unit;reason text:=trim(coalesce(d->>'note',''));day date:=(now() at time zone 'Asia/Bangkok')::date;needs_reason boolean:=false;review boolean:=false;dups int;code text;begin
 if length(reason)>2000 then raise exception 'เหตุผลยาวเกิน 2000 ตัวอักษร';end if;
 if p.role not in ('ADMIN','HR') or p.id is distinct from auth.uid() then raise exception 'เฉพาะ HR/Admin แก้ข้อมูลใบสมัครได้' using errcode='42501';end if;
 if act='change_unit' then
  u:=trim(coalesce(d->>'unit',''));
  if u=a.hiring_unit then raise exception 'ยังไม่ได้เปลี่ยนหน่วยงาน';end if;
  if reason='' or not exists(select 1 from rm_private.units where name=u and active) then raise exception 'เลือกหน่วยงานที่เปิดใช้งานและระบุเหตุผล';end if;
  if not coalesce((d->>'preview')::boolean,false) and coalesce(d->>'confirm_impact','')<>'true' then raise exception 'ยืนยันผลกระทบจากการเปลี่ยนหน่วยงานก่อน';end if;
  if coalesce((d->>'preview')::boolean,false) then return jsonb_build_object('changes',jsonb_build_array(jsonb_build_object('field','unit','before',a.hiring_unit,'after',u)),'needs_reason',true,'duplicates','[]'::jsonb);end if;
  perform rm_private.release_slot(a);
  -- Keep finalized interview history. Only abandoned drafts are removed.
  delete from rm_private.evaluations where applicant_id=a.id and round=a.round and stage='DRAFT';
  update rm_private.applicants set hiring_unit=u,owner_id=null,supervisor_id=null,coach_id=null,data=data-'plate'-'fleet_type',status=case when status='INTERVIEW' then 'HR_REVIEW' else status end,version=version+1,updated_at=now() where id=a.id;
  changes:=jsonb_build_array(jsonb_build_object('field','unit','before',a.hiring_unit,'after',u));
 else
  if d ? 'unit' and d->>'unit' is distinct from a.hiring_unit then raise exception 'ใช้เมนูเปลี่ยนหน่วยงานแยกต่างหาก';end if;
  if jsonb_typeof(coalesce(d->'data','{}'))<>'object' then raise exception 'ข้อมูลไม่ถูกต้อง';end if;
  clean:=rm_private.clean_data(coalesce(d->'data','{}'));if exists(select 1 from jsonb_each(coalesce(d->'data','{}')) where not (clean ? key)) then raise exception 'พบฟิลด์ที่แก้ไม่ได้หรือค่าไม่ถูกต้อง';end if;merged:=a.data||clean;
  nm:=trim(coalesce(d->>'full_name',a.full_name));ph:=trim(coalesce(d->>'phone',a.phone));pos:=coalesce(d->>'position',a.position);
  if length(nm) not between 2 and 200 or ph !~ '^[0-9+ -]{8,20}$' or pos not in ('DRIVER','HELPER') then raise exception 'ชื่อ เบอร์โทร หรือตำแหน่งไม่ถูกต้อง';end if;
  if pos<>a.position and (a.status not in ('HR_REVIEW','WAITING_INFO') or a.owner_id is not null or a.slot_id is not null or exists(select 1 from rm_private.evaluations where applicant_id=a.id)) then raise exception 'เปลี่ยนตำแหน่งได้เฉพาะก่อนส่งสัมภาษณ์และยังไม่ผูกคำขอ';end if;
  -- Validate edited fields, without forcing unrelated legacy blanks to be backfilled.
  if octet_length(merged::text)>20000 then raise exception 'ข้อมูลยาวเกินไป';end if;
  if clean ? 'birth_date' and (coalesce(merged->>'birth_date','')='' or (merged->>'birth_date')::date>day) then raise exception 'กรุณาระบุวันเกิดที่ถูกต้อง';end if;
  if clean ? 'national_id' and coalesce(merged->>'national_id','') !~ '^[0-9]{13}$' then raise exception 'เลขบัตรประชาชนต้องมี 13 หลัก';end if;
  if pos='DRIVER' and (pos<>a.position or clean ?| array['vehicle_type','license_type','driver_license_no']) and (coalesce(merged->>'vehicle_type','')='' or coalesce(merged->>'license_type','')='' or coalesce(merged->>'driver_license_no','')='') then raise exception 'กรอกประเภทรถและใบขับขี่ให้ครบ';end if;
  for k in select key from jsonb_each(clean) where key=any(array['birth_date','id_issued_at','id_expires_at','license_issued_at','license_expires_at','available_start_date']) and value #>> '{}' <> '' loop perform (clean->>k)::date;end loop;
  for k,newval in select key,value #>> '{}' from jsonb_each(clean) loop
   oldval:=coalesce(a.data->>k,'');
   if oldval is not distinct from newval then continue;end if;
   if k in ('birth_date','national_id','id_issued_at','id_expires_at','driver_license_no','license_type','license_issued_at','license_expires_at','prefix','gender') then needs_reason:=true;end if;
   if k in ('id_issued_at','id_expires_at','current_job_status','available_start_date','cargo_types','other_cargo_note') and trim(newval)='' then raise exception 'ข้อมูลบังคับห้ามล้างค่า';end if;
   if k in ('id_issued_at','id_expires_at','license_issued_at','license_expires_at','available_start_date','birth_date') and newval<>'' and newval !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'รูปแบบวันที่ไม่ถูกต้อง';end if;
   if (k='vehicle_type' and newval not in ('','เทรเลอร์','4W','6W','10W')) or (k='license_type' and newval not in ('','ท.1','ท.2','ท.3','ท.4','ส่วนบุคคล')) or (k='fuel_type' and newval not in ('','รถก๊าซ','รถน้ำมัน','รถไฟฟ้า','ได้ทั้งหมด')) or (k='current_job_status' and newval not in ('ว่างงาน','ทำงานอยู่','อื่นๆ')) or (k='gender' and newval not in ('','ชาย','หญิง','ไม่ประสงค์ระบุ','อื่นๆ')) then raise exception 'ค่าในรายการเลือกไม่ถูกต้อง';end if;
   changes:=changes||jsonb_build_array(jsonb_build_object('field',k,'before',case when k in ('national_id','driver_license_no') and oldval<>'' then '••••'||right(oldval,4) else oldval end,'after',case when k in ('national_id','driver_license_no') and newval<>'' then '••••'||right(newval,4) else newval end));
  end loop;
  if nm<>a.full_name then needs_reason:=true;changes:=changes||jsonb_build_array(jsonb_build_object('field','full_name','before',a.full_name,'after',nm));end if;
  if ph<>a.phone then changes:=changes||jsonb_build_array(jsonb_build_object('field','phone','before',a.phone,'after',ph));end if;
  if pos<>a.position then needs_reason:=true;changes:=changes||jsonb_build_array(jsonb_build_object('field','position','before',a.position,'after',pos));end if;
  if jsonb_array_length(changes)=0 then raise exception 'ยังไม่มีข้อมูลเปลี่ยนแปลง';end if;
  if not coalesce((d->>'preview')::boolean,false) and needs_reason and reason='' then raise exception 'ระบุเหตุผลและตรวจเทียบเอกสารก่อนแก้ข้อมูลสำคัญ';end if;
  if clean ?| array['id_issued_at','id_expires_at'] and (nullif(merged->>'id_issued_at','')::date>day or nullif(merged->>'id_expires_at','')::date<nullif(merged->>'id_issued_at','')::date) then raise exception 'ตรวจวันออกและวันหมดอายุบัตรประชาชน';end if;
  if clean ?| array['license_issued_at','license_expires_at'] and (nullif(merged->>'license_issued_at','')::date>day or nullif(merged->>'license_expires_at','')::date<nullif(merged->>'license_issued_at','')::date) then raise exception 'ตรวจวันออกและวันหมดอายุใบขับขี่';end if;
  if ph<>a.phone or merged->>'national_id' is distinct from a.data->>'national_id' then
   -- Serialize identical identity corrections so concurrent writers cannot bypass acknowledgement.
   for k in select v from unnest(array['phone:'||ph,'national:'||(merged->>'national_id')])v order by v loop perform pg_advisory_xact_lock(hashtextextended(k,411));end loop;
   select count(*) into dups from rm_private.applicants x where x.id<>a.id and (x.phone=ph or x.data->>'national_id'=merged->>'national_id');
   if not coalesce((d->>'preview')::boolean,false) and dups>0 and coalesce(d->>'duplicate_ack','')<>'true' then raise exception 'พบเบอร์โทรหรือเลขบัตรซ้ำ กรุณาตรวจรายการซ้ำและยืนยันก่อนบันทึก';end if;
  end if;
  review:=a.status not in ('HR_REVIEW','WAITING_INFO') and (merged->>'birth_date' is distinct from a.data->>'birth_date');
  if not coalesce((d->>'preview')::boolean,false) and review and coalesce(d->>'age_review_ack','')<>'true' then raise exception 'วันเกิดเปลี่ยนหลังคัดกรอง กรุณาทบทวนเกณฑ์อายุและยืนยัน';end if;
  if not coalesce((d->>'preview')::boolean,false) and (review or pos<>a.position) and extract(year from age(day,(merged->>'birth_date')::date))<(case when pos='DRIVER' then 25 else 18 end) and reason='' then raise exception 'ระบุเหตุผลทบทวนเกณฑ์อายุ';end if;
  if coalesce((d->>'preview')::boolean,false) then return jsonb_build_object('changes',changes,'needs_reason',needs_reason,'age_review',review,'duplicates',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.full_name,'status',x.status)) from rm_private.applicants x where x.id<>a.id and (ph<>a.phone or merged->>'national_id' is distinct from a.data->>'national_id') and (x.phone=ph or x.data->>'national_id'=merged->>'national_id')),'[]'::jsonb));end if;
  code:=coalesce(a.document_code,(case when a.position='DRIVER' then 'DRV-' else 'AST-' end)||to_char(a.created_at at time zone 'Asia/Bangkok','YYYYMMDD')||'-'||upper(left(replace(a.id::text,'-',''),8)));
  update rm_private.applicants set full_name=nm,phone=ph,position=pos,data=merged,document_code=case when pos<>a.position then code else document_code end,version=version+1,updated_at=now() where id=a.id;
 end if;
 insert into rm_private.activities(applicant_id,actor_id,action,note) values(a.id,p.id,case when act='change_unit' then 'CHANGE_UNIT' else 'CORRECT_APPLICANT' end,jsonb_build_object('kind','correction_v411','reason',reason,'changes',changes,'age_review',review)::text);
 return jsonb_build_object('ok',true,'changed',jsonb_array_length(changes));
end $$;
revoke all on function rm_private.correct_applicant(rm_private.profiles,rm_private.applicants,jsonb,text) from public,anon,authenticated;
-- Patch only the reviewed command branch; preserve Drive, reset and all other workflows.
do $patch$ declare src text;old text;begin
 src:=pg_get_functiondef('rm_private.command(text,jsonb)'::regprocedure);
 old:=substring(src from ' if act=''edit_applicant'' then.*? elsif act=''screen'' then');
 if old is null then raise exception 'Correction branch differs; inspect before installing V4.11';end if;
 src:=replace(src,old,$new$ if act in ('edit_applicant','correct_applicant','change_unit') then
 return rm_private.correct_applicant(p,a,d,act);
 elsif act='screen' then$new$);
 src:=replace(src,'select x.id,x.action,x.note,x.created_at,u.display_name', 'select x.id,x.action,case when x.action in (''CORRECT_APPLICANT'',''CHANGE_UNIT'') and p.role=''COACH'' then ''HR แก้ไขข้อมูลใบสมัคร (รายละเอียดเฉพาะ HR/Supervisor)'' else x.note end as note,x.created_at,u.display_name');
 execute src;
end $patch$;
