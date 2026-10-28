-- Applicant references are separate from immutable Drive folder codes.
lock table rm_private.applicants in share row exclusive mode;
alter table rm_private.applicants add column reference_code text unique;
create table rm_private.applicant_month_sequences (month_key text primary key check(month_key ~ '^[0-9]{6}$'), last_value integer not null check(last_value between 1 and 9999));
alter table rm_private.applicant_month_sequences enable row level security;
revoke all on rm_private.applicant_month_sequences from public, anon, authenticated;
create function rm_private.next_applicant_reference(p_position text,p_created timestamptz) returns text
language plpgsql security definer set search_path='' as $$
declare m text:=to_char(p_created at time zone 'Asia/Bangkok','YYYYMM'); n integer;
begin
 insert into rm_private.applicant_month_sequences(month_key,last_value) values(m,1)
 on conflict(month_key) do update set last_value=rm_private.applicant_month_sequences.last_value+1
 where rm_private.applicant_month_sequences.last_value<9999 returning last_value into n;
 if n is null then raise exception 'รหัสผู้สมัครเดือนนี้เต็มแล้ว กรุณาติดต่อผู้ดูแลระบบ'; end if;
 return (case when p_position='DRIVER' then 'DRV-' else 'AST-' end)||substring(m from 3)||lpad(n::text,4,'0');
end $$;
revoke all on function rm_private.next_applicant_reference(text,timestamptz) from public,anon,authenticated;
-- Existing applicants are renumbered for display only; document_code and Drive files are preserved.
do $$ declare r record; begin
 for r in select id,position,created_at from rm_private.applicants order by created_at,id loop
  update rm_private.applicants set reference_code=rm_private.next_applicant_reference(r.position,r.created_at) where id=r.id;
 end loop;
end $$;
alter table rm_private.applicants alter column reference_code set not null;
create function rm_private.assign_applicant_reference() returns trigger language plpgsql security definer set search_path='' as $$
begin new.reference_code:=rm_private.next_applicant_reference(new.position,new.created_at); return new; end $$;
revoke all on function rm_private.assign_applicant_reference() from public,anon,authenticated;
create trigger assign_applicant_reference before insert on rm_private.applicants for each row execute function rm_private.assign_applicant_reference();
-- Include title and new searchable code in the existing role-scoped list.
do $patch$ declare def text; old text:=$old$coalesce(x.document_code,(case when x.position='DRIVER' then 'DRV-' else 'AST-' end)||to_char(x.created_at at time zone 'Asia/Bangkok','YYYYMMDD')||'-'||upper(left(replace(x.id::text,'-',''),8))) as applicant_code$old$; begin
 def:=pg_get_functiondef('rm_private.applicant_list(rm_private.profiles,jsonb)'::regprocedure);
 if position(old in def)=0 then raise exception 'รูปแบบรายการผู้สมัครต่างจากรุ่นที่ตรวจ'; end if;
 execute replace(def,old,'x.reference_code as applicant_code, coalesce(x.data->>''prefix'','''') as prefix');
end $patch$;
-- Keep legacy code for Drive authorization, but show the new reference in both receipt paths.
create function rm_private.public_apply_reference(d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i uuid; c text; begin i:=rm_private.public_apply(d); select reference_code into c from rm_private.applicants where id=i; return jsonb_build_object('id',i,'reference_code',c); end $$;
revoke all on function rm_private.public_apply_reference(jsonb) from public,anon,authenticated;
grant execute on function rm_private.public_apply_reference(jsonb) to anon,authenticated;
create or replace function public.recruitment_apply(p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select rm_private.public_apply_reference(p_payload)$$;
do $patch$ declare def text; old text:=$old$'reference_code',code$old$; begin
 def:=pg_get_functiondef('rm_private.apply_with_documents(jsonb)'::regprocedure);
 if (length(def)-length(replace(def,old,'')))/length(old)<>2 then raise exception 'รูปแบบใบตอบรับต่างจากรุ่นที่ตรวจ'; end if;
 execute replace(def,old,$new$'reference_code',(select reference_code from rm_private.applicants where id=coalesce(g.applicant_id,i))$new$);
end $patch$;
-- Non-follow-up screening results cannot persist a stale follow-up date.
do $patch$ declare def text; old text:=$old$'followup_date',coalesce(d->>'followup_date','')$old$; begin
 def:=pg_get_functiondef('rm_private.command(text,jsonb)'::regprocedure);
 if position(old in def)=0 then raise exception 'รูปแบบคัดกรองต่างจากรุ่นที่ตรวจ'; end if;
 execute replace(def,old,$new$'followup_date',case when d->>'result'='MORE_INFO' then coalesce(d->>'followup_date','') else '' end$new$);
end $patch$;
