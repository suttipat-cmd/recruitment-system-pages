do $guard$ declare current_hash text;begin
 select md5(replace(prosrc,chr(13)||chr(10),chr(10))) into current_hash from pg_proc where oid='rm_private.applicant_list(rm_private.profiles,jsonb)'::regprocedure;
 if current_hash not in ('56ecdb0743fab20d05336b497508ab70','7fe1a2d34cbe3e301b230fca03ecbd51') then raise exception 'Applicant list differs from reviewed V4.7/V4.9; inspect before replacing';end if;
end $guard$;
-- Add read-only derived workflow summaries. No applicant rows or permissions are changed.
create or replace function rm_private.workflow_date(value text) returns date
language plpgsql immutable set search_path='' as $$ begin
 if value is null or value !~ '^\d{4}-\d{2}-\d{2}$' then return null;end if;
 return value::date;
exception when others then return null;end $$;
revoke all on function rm_private.workflow_date(text) from public,anon,authenticated;
create or replace function rm_private.workflow_stage(a rm_private.applicants,as_of date) returns text
language sql stable set search_path='' as $$ select case
 when a.status='STARTED' then case when a.employment_status='RESIGNED' then 'RESIGNED' else 'ACTIVE' end
 when a.status='INTERVIEW' then case when a.owner_id is null then 'INTERVIEW_UNCLAIMED' else 'INTERVIEW_IN_PROGRESS' end
 when a.status='HIRED' then case
  when a.coach_id is null or a.supervisor_id is null or coalesce(trim(a.data->>'plate'),'')='' or coalesce(trim(a.data->>'fleet_type'),'')='' then 'HANDOVER_PENDING'
  when a.scheduled_start_date is null then 'START_DATE_PENDING'
  when a.scheduled_start_date<as_of then 'START_OVERDUE'
  when a.scheduled_start_date=as_of then 'START_TODAY'
  else 'START_SCHEDULED' end
 else a.status end $$;
revoke all on function rm_private.workflow_stage(rm_private.applicants,date) from public,anon,authenticated;
create or replace function rm_private.applicant_list(p rm_private.profiles,d jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare page_size integer:=coalesce(nullif(d->>'size','')::integer,30);off integer:=greatest(0,coalesce((d->>'offset')::integer,0));
 sort_key text:=coalesce(d->>'sort','created_at');sort_order text:=coalesce(d->>'order','desc');
 as_of date:=(now() at time zone 'Asia/Bangkok')::date;lo integer:=nullif(d->>'age_min','')::integer;hi integer:=nullif(d->>'age_max','')::integer;
 start_day date:=nullif(d->>'from','')::date;end_day date:=nullif(d->>'to','')::date;result jsonb;
begin
 if page_size not in (10,20,30,50,100) then raise exception 'จำนวนแถวต้องเป็น 10, 20, 30, 50 หรือ 100';end if;
 if sort_key not in ('created_at','full_name','age','hiring_unit','next_date') or sort_order not in ('asc','desc') then raise exception 'การเรียงลำดับไม่ถูกต้อง';end if;
 if p.role='COACH' and (lo is not null or hi is not null or sort_key='age') then raise exception 'บทบาทนี้ไม่เปิดข้อมูลอายุ' using errcode='42501';end if;
 if (lo is not null and (lo<0 or lo>120)) or (hi is not null and (hi<0 or hi>120)) or (lo is not null and hi is not null and lo>hi) or (start_day is not null and end_day is not null and start_day>end_day) then raise exception 'ช่วงตัวกรองไม่ถูกต้อง';end if;
 if coalesce(d->>'workflow_stage','') not in ('','HR_REVIEW','WAITING_INFO','INTERVIEW_UNCLAIMED','INTERVIEW_IN_PROGRESS','HANDOVER_PENDING','START_DATE_PENDING','START_TODAY','START_OVERDUE','START_SCHEDULED','ACTIVE','RESIGNED','RESERVE','REJECTED','WITHDRAWN','NO_SHOW','CANCELLED') then raise exception 'ขั้นตอนไม่ถูกต้อง';end if;
 if coalesce(d->>'queue','') not in ('','coach_pending') then raise exception 'คิวไม่ถูกต้อง';end if;
 if d->>'queue'='coach_pending' and p.role<>'COACH' then raise exception 'คิวเฉพาะ Driver Coach' using errcode='42501';end if;
 with available as materialized (
  select x.id,x.full_name,x.phone,x.position,x.hiring_unit,x.original_unit,x.status,x.version,x.created_at,x.owner_id,x.coach_id,x.supervisor_id,x.slot_id,x.actual_start_date,x.scheduled_start_date,x.resignation_date,x.employment_status,
   (case when x.position='DRIVER' then 'DRV-' else 'AST-' end)||to_char(x.created_at at time zone 'Asia/Bangkok','YYYYMMDD')||'-'||upper(left(replace(x.id::text,'-',''),8)) as applicant_code,
   case when p.role in ('ADMIN','HR','MANAGER') then rm_private.applicant_age(x.data->>'birth_date',as_of) else null end as age_years,
   coalesce(x.data->>'vehicle_type','') as vehicle_type,
   rm_private.workflow_stage(x,as_of) as workflow_stage,
   array_remove(array[case when x.coach_id is null then 'Driver Coach' end,case when x.supervisor_id is null then 'Supervisor ผู้ดูแล' end,case when coalesce(trim(x.data->>'plate'),'')='' then 'ทะเบียนรถ' end,case when coalesce(trim(x.data->>'fleet_type'),'')='' then 'ประเภทรถ' end],null) as handover_missing,
   (x.status in ('HIRED','STARTED') and x.employment_status<>'RESIGNED' and coalesce(x.data->>'road_test_result','')='') as road_test_pending,
   case when x.status='WAITING_INFO' then rm_private.workflow_date(x.data->>'followup_date') when x.status='HIRED' then x.scheduled_start_date end as next_date,
   coalesce((select e.created_at from rm_private.activities e where e.applicant_id=x.id order by e.created_at desc,e.id desc limit 1),x.created_at) as latest_at,
   (select e.action from rm_private.activities e where e.applicant_id=x.id order by e.created_at desc,e.id desc limit 1) as latest_action
  from rm_private.applicants x where rm_private.can_read(p,x)
 ),filtered as materialized (
  select *,case when age_years is null then null else age_years>=case when position='DRIVER' then 25 else 18 end end as age_eligible
  from available x where (coalesce(d->>'status','')='' or x.status=d->>'status') and (coalesce(d->>'unit','')='' or x.hiring_unit=d->>'unit')
   and (coalesce(d->>'position','')='' or x.position=d->>'position') and (coalesce(d->>'vehicle','')='' or x.vehicle_type=d->>'vehicle')
   and (coalesce(d->>'workflow_stage','')='' or x.workflow_stage=d->>'workflow_stage')
   and (coalesce(d->>'queue','')='' or (x.coach_id=p.id and x.road_test_pending))
   and (lo is null or age_years>=lo) and (hi is null or age_years<=hi)
   and (start_day is null or x.created_at >= (start_day::timestamp at time zone 'Asia/Bangkok'))
   and (end_day is null or x.created_at < ((end_day+1)::timestamp at time zone 'Asia/Bangkok'))
   and (coalesce(d->>'search','')='' or x.full_name ilike '%'||left(d->>'search',100)||'%' or x.phone ilike '%'||left(d->>'search',100)||'%' or x.applicant_code ilike '%'||left(d->>'search',100)||'%')
 ),paged as (
  select * from filtered order by
   case when sort_key='next_date' and sort_order='asc' then next_date end asc nulls last,
   case when sort_key='next_date' and sort_order='desc' then next_date end desc nulls last,
   case when sort_key='full_name' and sort_order='asc' then full_name end asc,
   case when sort_key='full_name' and sort_order='desc' then full_name end desc,
   case when sort_key='hiring_unit' and sort_order='asc' then hiring_unit end asc,
   case when sort_key='hiring_unit' and sort_order='desc' then hiring_unit end desc,
   case when sort_key='age' and sort_order='asc' then age_years end asc nulls last,
   case when sort_key='age' and sort_order='desc' then age_years end desc nulls last,
   case when sort_key='created_at' and sort_order='asc' then created_at end asc,
   case when sort_key='created_at' and sort_order='desc' then created_at end desc,
   id asc limit page_size offset off
 ) select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(q)) from paged q),'[]'::jsonb),'size',page_size) into result;
 return result;
end $$;
revoke all on function rm_private.applicant_list(rm_private.profiles,jsonb) from public,anon,authenticated;

