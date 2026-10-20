-- Return useful list columns without exposing identity documents or birth dates.
create or replace function rm_private.applicant_age(b text,as_of date) returns integer
language plpgsql immutable set search_path='' as $$
declare dt date;begin
 if b is null or b !~ '^\d{4}-\d{2}-\d{2}$' then return null;end if;
 dt:=b::date;if dt>as_of or dt<as_of-interval '120 years' then return null;end if;
 return extract(year from age(as_of,dt))::integer;
exception when others then return null;end $$;
revoke all on function rm_private.applicant_age(text,date) from public,anon,authenticated;
create or replace function rm_private.applicant_list(p rm_private.profiles,d jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare page_size integer:=coalesce(nullif(d->>'size','')::integer,30);off integer:=greatest(0,coalesce((d->>'offset')::integer,0));
 sort_key text:=coalesce(d->>'sort','created_at');sort_order text:=coalesce(d->>'order','desc');
 as_of date:=(now() at time zone 'Asia/Bangkok')::date;lo integer:=nullif(d->>'age_min','')::integer;hi integer:=nullif(d->>'age_max','')::integer;
 start_day date:=nullif(d->>'from','')::date;end_day date:=nullif(d->>'to','')::date;result jsonb;
begin
 if page_size not in (10,20,30,50,100) then raise exception 'จำนวนแถวต้องเป็น 10, 20, 30, 50 หรือ 100';end if;
 if sort_key not in ('created_at','full_name','age','hiring_unit') or sort_order not in ('asc','desc') then raise exception 'การเรียงลำดับไม่ถูกต้อง';end if;
 if p.role='COACH' and (lo is not null or hi is not null or sort_key='age') then raise exception 'บทบาทนี้ไม่เปิดข้อมูลอายุ' using errcode='42501';end if;
 if (lo is not null and (lo<0 or lo>120)) or (hi is not null and (hi<0 or hi>120)) or (lo is not null and hi is not null and lo>hi) or (start_day is not null and end_day is not null and start_day>end_day) then raise exception 'ช่วงตัวกรองไม่ถูกต้อง';end if;
 with available as materialized (
  select x.id,x.full_name,x.phone,x.position,x.hiring_unit,x.original_unit,x.status,x.version,x.created_at,x.owner_id,x.coach_id,x.supervisor_id,x.slot_id,x.actual_start_date,x.scheduled_start_date,x.resignation_date,x.employment_status,
   (case when x.position='DRIVER' then 'DRV-' else 'AST-' end)||to_char(x.created_at at time zone 'Asia/Bangkok','YYYYMMDD')||'-'||upper(left(replace(x.id::text,'-',''),8)) as applicant_code,
   case when p.role in ('ADMIN','HR','MANAGER') then rm_private.applicant_age(x.data->>'birth_date',as_of) else null end as age_years,
   coalesce(x.data->>'vehicle_type','') as vehicle_type
  from rm_private.applicants x where rm_private.can_read(p,x)
 ),filtered as materialized (
  select *,case when age_years is null then null else age_years>=case when position='DRIVER' then 25 else 18 end end as age_eligible
  from available x where (coalesce(d->>'status','')='' or x.status=d->>'status') and (coalesce(d->>'unit','')='' or x.hiring_unit=d->>'unit')
   and (coalesce(d->>'position','')='' or x.position=d->>'position') and (coalesce(d->>'vehicle','')='' or x.vehicle_type=d->>'vehicle')
   and (lo is null or age_years>=lo) and (hi is null or age_years<=hi)
   and (start_day is null or x.created_at >= (start_day::timestamp at time zone 'Asia/Bangkok'))
   and (end_day is null or x.created_at < ((end_day+1)::timestamp at time zone 'Asia/Bangkok'))
   and (coalesce(d->>'search','')='' or x.full_name ilike '%'||left(d->>'search',100)||'%' or x.phone ilike '%'||left(d->>'search',100)||'%' or x.applicant_code ilike '%'||left(d->>'search',100)||'%')
 ),paged as (
  select * from filtered order by
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

-- Patch only the list branch; all mutation and authorization branches remain unchanged.
do $patch$
declare definition text;old_branch text:=$old$ elsif act='applicants' then
 idx:=greatest(0,least(100000,coalesce((d->>'offset')::int,0)));
 select jsonb_build_object('total',count(*)) into result from rm_private.applicants x where rm_private.can_read(p,x) and (coalesce(d->>'status','')='' or x.status=d->>'status') and (coalesce(d->>'unit','')='' or x.hiring_unit=d->>'unit') and (coalesce(d->>'search','')='' or x.full_name ilike '%'||left(d->>'search',100)||'%' or x.phone ilike '%'||left(d->>'search',100)||'%');
 return result||jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select x.id,x.full_name,x.phone,x.position,x.hiring_unit,x.original_unit,x.status,x.version,x.created_at,x.owner_id,x.coach_id,x.supervisor_id,x.slot_id,x.actual_start_date,x.scheduled_start_date,x.resignation_date,x.employment_status from rm_private.applicants x where rm_private.can_read(p,x) and (coalesce(d->>'status','')='' or x.status=d->>'status') and (coalesce(d->>'unit','')='' or x.hiring_unit=d->>'unit') and (coalesce(d->>'search','')='' or x.full_name ilike '%'||left(d->>'search',100)||'%' or x.phone ilike '%'||left(d->>'search',100)||'%') order by x.created_at desc,x.id limit 30 offset idx)q));
$old$;begin
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid='rm_private.command(text,jsonb)'::regprocedure)<>'1fdcfca8a349c5dda4a6c845ed0262c6' then raise exception 'คำสั่งระบบต่างจาก V4.4 กรุณาตรวจความต่างก่อนอัปเดต';end if;
 definition:=replace(pg_get_functiondef('rm_private.command(text,jsonb)'::regprocedure),chr(13)||chr(10),chr(10));
 if position(old_branch in definition)=0 then raise exception 'ไม่พบส่วนรายการผู้สมัครที่ต้องอัปเดต';end if;
 execute replace(definition,old_branch,$new$ elsif act='applicants' then
 return rm_private.applicant_list(p,d);
$new$);
end $patch$;
