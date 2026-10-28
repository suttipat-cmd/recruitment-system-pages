do $guard$ begin if (select md5(prosrc) from pg_proc where oid='rm_private.command(text,jsonb)'::regprocedure)<>'218dc22ee03714138f0425f1066c39f8' then raise exception 'ฐานต่างจาก V4.11 ที่ตรวจแล้ว กรุณาตรวจสอบก่อนติดตั้ง';end if;end $guard$;
-- All writes and audit entries are atomic; cancelled slots are retained for history.
create function rm_private.edit_request(p rm_private.profiles,d jsonb,act text) returns jsonb
language plpgsql set search_path='' as $$
declare r rm_private.requests;s rm_private.slots;v jsonb;changes jsonb:='[]';impacts jsonb:='[]';before_row jsonb;after_row jsonb;reason text:=trim(coalesce(d->>'reason',''));newunit text;newtitle text;newnotes text;v_plate text;v_fleet text;v_pos text;slotid uuid;locked_ids uuid[];current_ids uuid[];detach boolean:=false;preview boolean:=coalesce((d->>'preview')::boolean,false);actionlabel text;review_token text;begin
 if p.id is distinct from auth.uid() or p.role not in ('ADMIN','HR','MANAGER') then raise exception 'ไม่มีสิทธิ์แก้คำขอ' using errcode='42501';end if;
 select * into r from rm_private.requests where id=(d->>'request_id')::uuid;
 if r.id is null or not rm_private.allowed_unit(p,r.unit) then raise exception 'ไม่พบคำขอหรือไม่มีสิทธิ์' using errcode='42501';end if;
 if act='request_history' then
  return coalesce((select jsonb_agg(to_jsonb(q) order by q.id desc) from (select x.id,x.created_at,u.display_name,x.note from rm_private.activities x left join rm_private.profiles u on u.id=x.actor_id where x.action='REQUEST_CHANGED_V412' and (case when x.action='REQUEST_CHANGED_V412' then x.note::jsonb->>'request_id' end)=r.id::text order by x.id desc limit 100) q),'[]'::jsonb);
 end if;
 if r.version<>coalesce((d->>'request_version')::int,0) then raise exception 'คำขอเปลี่ยนแล้ว กรุณารีเฟรชก่อนแก้ไข' using errcode='40001';end if;
 if reason='' or length(reason)>2000 then raise exception 'กรุณาระบุเหตุผลไม่เกิน 2000 ตัวอักษร';end if;
 -- Lock applicants before slots, as the hiring workflow does; recheck that no concurrent link appeared.
 select array_agg(id order by id) into locked_ids from (select x.id from rm_private.applicants x where x.id in (select applicant_id from rm_private.slots where request_id=r.id and applicant_id is not null) order by x.id for update) q;
 select * into r from rm_private.requests where id=r.id for update;
 if r.version<>coalesce((d->>'request_version')::int,0) or not rm_private.allowed_unit(p,r.unit) then raise exception 'คำขอเปลี่ยนแล้ว กรุณารีเฟรช' using errcode='40001';end if;
 perform 1 from rm_private.slots where request_id=r.id order by id for update;
 select array_agg(applicant_id order by applicant_id) into current_ids from rm_private.slots where request_id=r.id and applicant_id is not null;
 if current_ids is distinct from locked_ids then raise exception 'การผูกผู้สมัครเปลี่ยนแล้ว กรุณารีเฟรช' using errcode='40001';end if;
 if act='edit_request' then
  newtitle:=trim(coalesce(d->>'title',''));newunit:=trim(coalesce(d->>'unit',''));newnotes:=trim(coalesce(d->>'notes',''));
  if newtitle not in ('ทดแทนอัตรากำลังเดิม','ขออัตรากำลังเพิ่ม') or length(newnotes)>5000 or not exists(select 1 from rm_private.units where name=newunit and active) or not rm_private.allowed_unit(p,newunit) then raise exception 'ข้อมูลคำขอหรือสิทธิ์หน่วยงานไม่ถูกต้อง';end if;
  before_row:=jsonb_build_object('title',r.title,'unit',r.unit,'notes',r.notes);after_row:=jsonb_build_object('title',newtitle,'unit',newunit,'notes',newnotes);
  if before_row=after_row then raise exception 'ยังไม่มีข้อมูลเปลี่ยนแปลง';end if;
  detach:=newunit<>r.unit;actionlabel:='แก้ไขคำขอ';
 else
  if act not in ('edit_request_slot','add_request_slot','cancel_request_slot','restore_request_slot') then raise exception 'คำสั่งไม่ถูกต้อง';end if;
  if act<>'add_request_slot' then
   slotid:=(d->>'slot_id')::uuid;select * into s from rm_private.slots where id=slotid and request_id=r.id;
   if s.id is null or s.version<>coalesce((d->>'slot_version')::int,0) then raise exception 'อัตราเปลี่ยนแล้ว กรุณารีเฟรช' using errcode='40001';end if;
  end if;
  if act in ('edit_request_slot','add_request_slot') then
   v_plate:=trim(coalesce(d->>'plate',''));v_fleet:=coalesce(d->>'fleet_type','');v_pos:=coalesce(d->>'position','');
   if length(v_plate) not between 1 and 50 or v_fleet not in ('COMPANY','PARTNER') or v_pos not in ('DRIVER','HELPER') then raise exception 'ตรวจทะเบียน ประเภทรถ และตำแหน่ง';end if;
   if act='add_request_slot' and (select count(*) from rm_private.slots where request_id=r.id and status<>'CANCELLED')>=30 then raise exception 'คำขอหนึ่งมีอัตราที่ใช้งานสูงสุด 30 รายการ';end if;
   before_row:=case when act='edit_request_slot' then jsonb_build_object('plate',s.plate,'fleet_type',s.fleet_type,'position',s.position) else '{}'::jsonb end;
   after_row:=jsonb_build_object('plate',v_plate,'fleet_type',v_fleet,'position',v_pos);
   if before_row=after_row then raise exception 'ยังไม่มีข้อมูลเปลี่ยนแปลง';end if;
   detach:=act='edit_request_slot' and s.applicant_id is not null and v_pos<>s.position;
   actionlabel:=case when act='add_request_slot' then 'เพิ่มอัตรา' else 'แก้ไขอัตรา' end;
  else
   if act='cancel_request_slot' and s.status='CANCELLED' then raise exception 'อัตรานี้ถูกยกเลิกแล้ว';end if;
   if act='restore_request_slot' and s.status<>'CANCELLED' then raise exception 'คืนได้เฉพาะอัตราที่ถูกยกเลิก';end if;
   if act='restore_request_slot' and (select count(*) from rm_private.slots where request_id=r.id and status<>'CANCELLED')>=30 then raise exception 'คำขอหนึ่งมีอัตราที่ใช้งานสูงสุด 30 รายการ';end if;
   before_row:=jsonb_build_object('plate',s.plate,'status',s.status);after_row:=jsonb_build_object('plate',s.plate,'status',case when act='cancel_request_slot' then 'CANCELLED' else 'OPEN' end);
   detach:=act='cancel_request_slot' and s.applicant_id is not null;actionlabel:=case when act='cancel_request_slot' then 'ยกเลิกอัตรา' else 'คืนอัตราที่ถูกยกเลิก' end;
  end if;
 end if;
 if detach then
  select coalesce(jsonb_agg(jsonb_build_object('slot_id',x.id,'plate',x.plate,'applicant_id',a.id,'name',case when rm_private.can_read(p,a) then a.full_name else 'ผู้สมัครนอกขอบเขต' end,'status',a.status) order by x.plate),'[]') into impacts from rm_private.slots x join rm_private.applicants a on a.id=x.applicant_id where x.request_id=r.id and (act='edit_request' or x.id=s.id);
 end if;
 v:=jsonb_build_object('kind','request_edit_v412','request_id',r.id,'action',actionlabel,'reason',reason,'before',before_row,'after',after_row,'slot_id',slotid,'detached_count',jsonb_array_length(impacts));
 review_token:=md5(jsonb_build_object('request',r.id,'version',r.version,'action',act,'before',before_row,'after',after_row,'reason',reason,'actor',p.id,'impacts',impacts,'slots',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'version',x.version,'applicant_id',x.applicant_id) order by x.id),'[]'::jsonb) from rm_private.slots x where x.request_id=r.id))::text);
 if preview then return jsonb_build_object('audit',v,'impacts',impacts,'kpi_warning',true,'review_token',review_token);end if;
 if coalesce(d->>'review_token','')<>review_token then raise exception 'ข้อมูลหรือการผูกผู้สมัครเปลี่ยนแล้ว กรุณาตรวจสอบผลกระทบอีกครั้ง' using errcode='40001';end if;
 if detach and jsonb_array_length(impacts)>0 and coalesce((d->>'confirm_detach')::boolean,false)=false then raise exception 'กรุณายืนยันปลดการผูกผู้สมัครก่อนบันทึก';end if;
 if coalesce((d->>'confirm_changes')::boolean,false)=false then raise exception 'กรุณาตรวจสอบผลกระทบและยืนยันก่อนบันทึก';end if;
 if detach then
  insert into rm_private.activities(applicant_id,actor_id,action,note) select applicant_id,p.id,'REQUEST_UNLINKED_V412','ปลดคำขอเนื่องจาก '||actionlabel||' · '||reason from rm_private.slots where request_id=r.id and applicant_id is not null and (act='edit_request' or id=s.id);
  update rm_private.applicants set slot_id=null,version=version+1,updated_at=now() where id in (select applicant_id from rm_private.slots where request_id=r.id and applicant_id is not null and (act='edit_request' or id=s.id));
  update rm_private.slots set applicant_id=null,status='OPEN',filled_at=null,version=version+1 where request_id=r.id and applicant_id is not null and (act='edit_request' or id=s.id);
 end if;
 if act='edit_request' then update rm_private.requests set title=newtitle,unit=newunit,notes=newnotes,version=version+1 where id=r.id;
 elsif act='add_request_slot' then insert into rm_private.slots(request_id,plate,fleet_type,position) values(r.id,v_plate,v_fleet,v_pos) returning id into slotid;v:=jsonb_set(v,'{slot_id}',to_jsonb(slotid));update rm_private.requests set version=version+1 where id=r.id;
 elsif act='edit_request_slot' then update rm_private.slots set plate=v_plate,fleet_type=v_fleet,position=v_pos,version=version+1 where id=s.id;update rm_private.requests set version=version+1 where id=r.id;
 elsif act='cancel_request_slot' then update rm_private.slots set status='CANCELLED',cancel_note=reason,version=version+1 where id=s.id;update rm_private.requests set version=version+1 where id=r.id;
 else update rm_private.slots set status='OPEN',cancel_note=null,version=version+1 where id=s.id;update rm_private.requests set version=version+1 where id=r.id;end if;
 insert into rm_private.activities(actor_id,action,note)values(p.id,'REQUEST_CHANGED_V412',v::text);
 return jsonb_build_object('ok',true);
end $$;
revoke all on function rm_private.edit_request(rm_private.profiles,jsonb,text) from public,anon,authenticated;
do $patch$ declare src text;needle text:=$needle$ elsif act='save_topic' then$needle$;begin
 src:=pg_get_functiondef('rm_private.command(text,jsonb)'::regprocedure);
 if position(needle in src)=0 then raise exception 'รูปแบบคำสั่งคำขอไม่ตรง หยุดติดตั้ง';end if;
 execute replace(src,needle,$new$ elsif act in ('request_history','edit_request','edit_request_slot','add_request_slot','cancel_request_slot','restore_request_slot') then
 return rm_private.edit_request(p,d,act);
 elsif act='save_topic' then$new$);
end $patch$;
