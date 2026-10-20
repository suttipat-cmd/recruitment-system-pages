-- Run AFTER migration, once. First create this email in Supabase Authentication > Users.
-- Replace the placeholder before running. No default password is provided.
do $$
declare target uuid;mail text := 'REPLACE_WITH_ADMIN_EMAIL';
begin
 if mail='REPLACE_WITH_ADMIN_EMAIL' then raise exception 'แก้ REPLACE_WITH_ADMIN_EMAIL เป็นอีเมล Admin ก่อน';end if;
 if exists(select 1 from rm_private.profiles where role='ADMIN' and active) then raise exception 'มี Admin แล้ว ใช้หน้าตั้งค่าระบบเพิ่มสิทธิ์แทน';end if;
 select id into target from auth.users where lower(email)=lower(mail);
 if target is null then raise exception 'ยังไม่มีอีเมลนี้ใน Authentication';end if;
 insert into rm_private.profiles(id,email,display_name,role)values(target,mail,'ผู้ดูแลระบบ','ADMIN');
end $$;
