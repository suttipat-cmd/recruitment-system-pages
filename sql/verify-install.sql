-- Read-only verification for the project owner. All rows should match expected results.
select 'private tables with RLS' as check_name,count(*) as actual,13 as expected from pg_tables t join pg_class c on c.relname=t.tablename join pg_namespace n on n.oid=c.relnamespace and n.nspname=t.schemaname where t.schemaname='rm_private' and c.relrowsecurity;
select proname,has_function_privilege('anon',p.oid,'execute') as anon_can_execute,has_function_privilege('authenticated',p.oid,'execute') as authenticated_can_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'recruitment_%';
select count(*) as active_admins from rm_private.profiles where role='ADMIN' and active;
select id,public,file_size_limit from storage.buckets where id='recruitment-documents';
-- rm_private must NOT be added to the Supabase Data API exposed-schema list.
