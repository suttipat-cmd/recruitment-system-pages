-- Additive only: preserves all recruitment records, accounts, and configuration.
create table rm_private.application_gate(id boolean primary key default true check(id),secret text not null,attempt_minute bigint not null default 0,attempts int not null default 0);
insert into rm_private.application_gate(id,secret) values(true,gen_random_uuid()::text||gen_random_uuid()::text);
create table rm_private.application_tickets(token_hash text primary key,expires_at timestamptz not null);
alter table rm_private.application_gate enable row level security;
alter table rm_private.application_tickets enable row level security;
revoke all on rm_private.application_gate,rm_private.application_tickets from public,anon,authenticated;
create function rm_private.pin_at(t timestamptz) returns text language sql stable set search_path='' as $$
 select lpad(((('x'||substr(md5(secret||':'||floor(extract(epoch from t)/60)::bigint::text),1,8))::bit(32)::bigint)%1000000)::text,6,'0') from rm_private.application_gate where id
$$;
create function rm_private.application_pin() returns jsonb language plpgsql security definer set search_path='' as $$
declare p rm_private.profiles; t timestamptz:=clock_timestamp(); begin
 p:=rm_private.actor(); if p.role not in ('HR','ADMIN') then raise exception 'เฉพาะ HR และ Admin เท่านั้น' using errcode='42501';end if;
 return jsonb_build_object('pin',rm_private.pin_at(t),'server_time',t,'expires_at',date_trunc('minute',t)+interval '1 minute');
end $$;
create function public.recruitment_application_pin() returns jsonb language sql security invoker set search_path='' as $$select rm_private.application_pin()$$;
create function rm_private.unlock_application(pin text) returns jsonb language plpgsql security definer set search_path='' as $$
declare t timestamptz; minute_id bigint; g rm_private.application_gate; ticket text; begin
 if not coalesce((select (data->>'public_apply')::boolean from rm_private.settings where id),false) then return jsonb_build_object('ok',false,'message','ยังไม่เปิดรับสมัครออนไลน์');end if;
 select * into g from rm_private.application_gate where id for update;
 t:=clock_timestamp(); minute_id:=floor(extract(epoch from t)/60)::bigint;
 if g.attempt_minute<>minute_id then g.attempts:=0;end if;
 -- Global ceiling bounds brute force even if a caller changes browser/IP. Failures return
 -- JSON (not exceptions) so the rate-limit counter is committed by PostgREST.
 if g.attempts>=100 then return jsonb_build_object('ok',false,'message','มีการลองรหัสมากเกินไป กรุณารอนาทีถัดไปแล้วขอ PIN ใหม่จาก HR');end if;
 update rm_private.application_gate set attempt_minute=minute_id,attempts=g.attempts+1 where id;
 if pin is null or pin !~ '^[0-9]{6}$' or pin<>rm_private.pin_at(t) then return jsonb_build_object('ok',false,'message','PIN ไม่ถูกต้องหรือหมดอายุ กรุณาขอรหัสล่าสุดจาก HR');end if;
 ticket:=gen_random_uuid()::text||gen_random_uuid()::text;
 delete from rm_private.application_tickets where expires_at<t;
 insert into rm_private.application_tickets values(md5(ticket),t+interval '2 hours');
 return jsonb_build_object('ok',true,'token',ticket,'server_time',t,'expires_at',t+interval '2 hours');
end $$;
create function public.recruitment_unlock_application(p_pin text) returns jsonb language sql security invoker set search_path='' as $$select rm_private.unlock_application(p_pin)$$;
create or replace function rm_private.public_apply(d jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare h text:=md5(coalesce(d->>'access_token',''));i uuid;begin
 perform 1 from rm_private.application_tickets where token_hash=h and expires_at>clock_timestamp() for update;
 if not found then raise exception 'กรุณาเปิดฟอร์มด้วย PIN จาก HR ใหม่' using errcode='42501';end if;
 i:=rm_private.apply(d-'access_token',true);
 delete from rm_private.application_tickets where token_hash=h;
 return i;
end $$;
create or replace function rm_private.clean_data(d jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(d) where key=any(array['prefix','gender','birth_date','line_id','national_id','id_issued_at','id_expires_at','vehicle_type','license_type','driver_license_no','license_issued_at','license_expires_at','cargo_types','construction_brands','beverage_brands','other_cargo_note','current_job_status','available_start_date','availability_note','fuel_type']) and jsonb_typeof(value)='string' and (key<>'fuel_type' or value #>> '{}' = any(array['','รถก๊าซ','รถน้ำมัน','รถไฟฟ้า','ได้ทั้งหมด']))
$$;
revoke all on function rm_private.pin_at(timestamptz),rm_private.application_pin(),rm_private.unlock_application(text) from public,anon,authenticated;
grant execute on function rm_private.application_pin() to authenticated;
grant execute on function rm_private.unlock_application(text) to anon,authenticated;
revoke all on function public.recruitment_application_pin(),public.recruitment_unlock_application(text) from public,anon,authenticated;
grant execute on function public.recruitment_application_pin() to authenticated;
grant execute on function public.recruitment_unlock_application(text) to anon,authenticated;
