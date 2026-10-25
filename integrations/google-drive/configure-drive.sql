-- Run after setupBridge() + Web app deployment. Copy the actual hash from its log.
-- Keep BRIDGE_KEY itself private in Apps Script Properties.
begin;
update rm_private.drive_config
set bridge_url = 'PASTE_YOUR_EXEC_URL_HERE',
    bridge_key_hash = 'PASTE_64_CHARACTER_HASH_FROM_SETUPBRIDGE',
    enabled = true
where id;
commit;
select public.recruitment_drive_status();
