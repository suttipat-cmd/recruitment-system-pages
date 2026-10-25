import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
const ids = {
  peer: "10000000-0000-4000-8000-000000000009",
  admin: "10000000-0000-4000-8000-000000000001",
  hr: "10000000-0000-4000-8000-000000000002",
  mgr: "10000000-0000-4000-8000-000000000003",
  other: "10000000-0000-4000-8000-000000000004",
  coach: "10000000-0000-4000-8000-000000000005",
  safety: "10000000-0000-4000-8000-000000000006",
  trainer: "10000000-0000-4000-8000-000000000007",
  dispatch: "10000000-0000-4000-8000-000000000008",
};
const unit = "TL-ขอนแก่น",
  otherUnit = "TL-สระบุรี";
const app = (name = "ทดสอบ ระบบ", phone = "0812345678") => ({
  full_name: name,
  phone,
  position: "DRIVER",
  unit,
  data: {
    birth_date: "1990-01-01",
    national_id: "1234567890123",
    vehicle_type: "10W",
    license_type: "ท.3",
    driver_license_no: "12345",
    fuel_type: "รถไฟฟ้า",id_issued_at:"2020-01-01",id_expires_at:"2030-01-01",current_job_status:"ว่างงาน",available_start_date:"2026-11-01",cargo_types:"วัสดุก่อสร้าง",other_cargo_note:"ไม่มี",
  },
});
test("Postgres migration + complete workflows and authorization", async (t) => {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;`,
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261019120728_recruitment_system_v4.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const file of ["20261020105230_application_pin.sql","20261020111221_required_application_fields.sql","20261020113344_hiring_workflow_v43.sql","20261020120123_four_roles_and_request_types.sql","20261020130620_applicant_list_workspace_v47.sql","20261025142241_workflow_visibility_v49.sql"]) await db.exec(await readFile(new URL("../supabase/migrations/"+file,import.meta.url),"utf8"));
  // Reapplying the read-only migration must be safe and preserve all authorization paths.
  await db.exec(await readFile(new URL("../supabase/migrations/20261025142241_workflow_visibility_v49.sql",import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/20261025152924_google_drive_attachments_v410.sql",import.meta.url),"utf8"));
  for (const [key, id] of Object.entries(ids)) {
    await db.query("insert into auth.users values($1,$2)", [
      id,
      key + "@test.invalid",
    ]);
    if (["safety","trainer","dispatch"].includes(key)) continue;
    await db.query(
      "insert into rm_private.profiles(id,email,display_name,role,units) values($1,$2,$3,$4,$5)",
      [
        id,
        key + "@test.invalid",
        key,
        (
          {
            peer: "MANAGER",
            admin: "ADMIN",
            hr: "HR",
            mgr: "MANAGER",
            other: "MANAGER",
            coach: "COACH",
            safety: "SAFETY",
            trainer: "DRIVER_TRAINER",
            dispatch: "DISPATCH_MANAGER",
          } as Record<string, string>
        )[key],
        key === "other" ? [otherUnit] : [unit],
      ],
    );
  }
  async function as(
    user: keyof typeof ids | null,
    sql: string,
    params: unknown[] = [],
  ) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user ? ids[user] : "",
    ]);
    await db.exec("set role " + (user ? "authenticated" : "anon"));
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec("reset role");
    }
  }
  async function cmd(
    user: keyof typeof ids,
    action: string,
    payload: unknown = {},
  ): Promise<any> {
    const r = await as(
      user,
      "select public.recruitment_command($1,$2::jsonb) data",
      [action, JSON.stringify(payload)],
    );
    return (r.rows[0] as any).data;
  }
  async function get(id: string) {
    return (await cmd("hr", "detail", { id })).applicant;
  }
  async function mutate(
    user: keyof typeof ids,
    action: string,
    id: string,
    data: Record<string, unknown> = {},
  ) {
    const a = await get(id);
    return cmd(user, action, { id, version: a.version, ...data });
  }
  let aId = "",
    req: any,
    slotId = "";
  await t.test(
    "all private tables have RLS and deny direct access; anon cannot bypass fixed public entrypoint",
    async () => {
      for (const table of [
        "profiles",
        "applicants",
        "requests",
        "training",
        "settings",
      ])
        await assert.rejects(() =>
          as("hr", `select * from rm_private.${table}`),
        );
      await assert.rejects(() =>
        as(null, "select rm_private.apply('{}',false)"),
      );
      await assert.rejects(() =>
        as("coach", "select rm_private.apply('{}',false)"),
      );
      await assert.rejects(() =>
        as(null, "select public.recruitment_command('snapshot','{}')"),
      );
      await assert.rejects(() =>
        as(null, "select public.recruitment_apply($1)", [
          JSON.stringify(app()),
        ]),
      );
    },
  );
  await t.test("only four roles; Supervisor scope is enforced on reads and writes",async()=>{
    for(const role of ["SAFETY","DRIVER_TRAINER","DISPATCH_MANAGER"]) await assert.rejects(()=>cmd("admin","save_profile",{email:"safety@test.invalid",display_name:"retired",role,units:[],active:true}));
    assert.deepEqual((await cmd("mgr","snapshot")).units,[unit]);
    await assert.rejects(()=>cmd("mgr","create_request",{title:"ข้อความอิสระ",unit,lines:[{plate:"TEST",fleet_type:"COMPANY",position:"DRIVER"}]}));
    const id=(await cmd("hr","create_applicant",{...app("ต่างหน่วยงาน","0844444444"),data:{...app().data,national_id:"9876543210123"},unit:otherUnit})).id;
    await mutate("hr","screen",id,{result:"FORWARD"});
    await assert.rejects(()=>cmd("mgr","detail",{id}));
    assert.equal((await cmd("mgr","applicants",{unit:otherUnit})).total,0);
    await assert.rejects(()=>mutate("mgr","claim",id));
    const full={email:"mgr@test.invalid",display_name:"Supervisor",role:"MANAGER",units:[],active:true,all_units:true};
    const own=await cmd("mgr","snapshot");
    await assert.rejects(()=>cmd("mgr","save_profile",{...full,version:own.profile.version}));
    await cmd("admin","save_profile",{...full,version:own.profile.version});
    assert.equal((await cmd("mgr","snapshot")).profile.all_units,true);
    assert.ok((await cmd("mgr","snapshot")).units.includes(otherUnit));
    assert.ok((await cmd("mgr","detail",{id})).applicant);
    await mutate("mgr","claim",id);
    await mutate("mgr","interview",id,{score:4,result:"PASS",submit:true});
    await cmd("mgr","create_request",{title:"ทดแทนอัตรากำลังเดิม",unit:otherUnit,lines:[{plate:"ทดสอบ",fleet_type:"COMPANY",position:"DRIVER"}]});
    assert.ok((await cmd("mgr","requests")).some((r:any)=>r.unit===otherUnit));
    await cmd("mgr","save_topic",{title:"ต่างหน่วย",category:"LEGAL",unit:otherUnit});
    await mutate("mgr","handover",id,{coach_id:ids.coach,supervisor_id:ids.mgr,plate:"ทดสอบ",fleet_type:"COMPANY"});

    const v=(await cmd("mgr","snapshot")).profile.version;
    await cmd("admin","save_profile",{...full,units:[unit],all_units:false,version:v});
    await assert.rejects(()=>cmd("mgr","detail",{id}));
    assert.ok((await cmd("mgr","requests")).every((r:any)=>r.unit===unit));
    await assert.rejects(()=>mutate("mgr","handover",id,{}));
    await assert.rejects(()=>cmd("mgr","save_topic",{title:"ห้าม",category:"LEGAL",unit:otherUnit}));
    await assert.rejects(async()=>cmd("admin","save_profile",{email:"coach@test.invalid",display_name:"Coach",role:"COACH",units:[],active:true,all_units:true,version:(await cmd("coach","snapshot")).profile.version}));
  });
  await t.test(
    "HR creates application without a request; manager cannot see unscreened application",
    async () => {
      aId = (await cmd("hr", "create_applicant", app())).id;
      assert.equal((await cmd("mgr", "applicants")).total, 0);
      await assert.rejects(() => cmd("coach", "create_applicant", app()));
      await assert.rejects(() => cmd("mgr", "detail", { id: aId }));
    },
  );
  await t.test(
    "request has multiple plates and separate driver/helper slots; HR receives once",
    async () => {
      const id = (
        await cmd("mgr", "create_request", {
          title: "ขออัตรากำลังเพิ่ม",
          unit,
          lines: [
            { plate: "กข 123", fleet_type: "COMPANY", position: "DRIVER" },
            { plate: "กข 123", fleet_type: "COMPANY", position: "HELPER" },
            { plate: "ขค 456", fleet_type: "PARTNER", position: "DRIVER" },
          ],
        })
      ).id;
      await assert.rejects(() =>
        cmd("other", "create_request", {
          title: "ปลอมหน่วยงาน",
          unit,
          lines: [],
        }),
      );
      await cmd("hr", "receive_request", { id, version: 1 });
      await assert.rejects(() =>
        cmd("hr", "receive_request", { id, version: 1 }),
      );
      req = (await cmd("hr", "requests")).find((r:any)=>r.unit===unit);
      slotId = req.slots.find((s: any) => s.position === "DRIVER").id;
      await mutate("hr", "match", aId, { slot_id: slotId });
    },
  );
  await t.test(
    "unit change atomically releases slot, preserves original unit, increments version",
    async () => {
      const a = await get(aId);
      await mutate("hr", "edit_applicant", aId, {
        ...app(),
        unit: otherUnit,
        note: "เปลี่ยนหน่วยงาน",
        data: app().data,
      });
      const b = await get(aId);
      assert.equal(b.slot_id, null);
      assert.equal(b.original_unit, unit);
      assert.equal(b.hiring_unit, otherUnit);
      assert.equal(
        (await cmd("hr", "requests")).find((r:any)=>r.unit===unit).slots.find((s: any) => s.id === slotId)
          .status,
        "OPEN",
      );
      await assert.rejects(() =>
        cmd("hr", "screen", { id: aId, version: a.version, result: "FORWARD" }),
      );
      await mutate("hr", "edit_applicant", aId, {
        ...app(),
        note: "กลับหน่วยงานเดิม",
      });
    },
  );
  await t.test(
    "screen and interview use application fuel; PASS hires immediately and fills slot",
    async () => {
      await mutate("hr", "match", aId, { slot_id: slotId });
      await mutate("hr", "screen", aId, { result: "FORWARD" });
      await assert.rejects(() => mutate("other", "claim", aId));
      await mutate("mgr", "claim", aId);
      await assert.rejects(() =>
        mutate("other", "interview", aId, {
          score: 4,
          result: "PASS",
          submit: true,
        }),
      );
      await mutate("mgr", "interview", aId, {
        score: 4,
        result: "PASS",
        road_result: "",
        fuel: "น้ำมันและแก๊ส",
        submit: true,
      });
      assert.equal((await get(aId)).status, "HIRED");
      assert.equal((await cmd("mgr","detail",{id:aId})).evaluations[0].fuel,"รถไฟฟ้า");
      assert.equal((await cmd("mgr","detail",{id:aId})).evaluations[0].road_result,null);
      assert.equal(
        (await cmd("hr", "requests")).find((r:any)=>r.unit===unit).slots.find((s: any) => s.id === slotId)
          .status,
        "FILLED",
      );
      const k = (await cmd("hr", "dashboard")).kpi14;
      assert.equal(k.total, 2);
      assert.equal(k.on_time, 1);
    },
  );
  await t.test("handover, employment and role-scoped training", async () => {
    await assert.rejects(()=>mutate("hr","employment",aId,{scheduled_start_date:"2026-10-20"}));
    await assert.rejects(()=>mutate("hr","handover",aId,{coach_id:ids.coach}));
    await mutate("hr", "handover", aId, {
      coach_id: ids.coach,
      supervisor_id: ids.mgr,
      plate: req.slots.find((s: any) => s.id === slotId).plate,
      fleet_type: req.slots.find((s: any) => s.id === slotId).fleet_type,
    });
    const { rows } = await db.query<{ today: string }>(
      "select to_char((now() at time zone 'Asia/Bangkok')::date,'YYYY-MM-DD') today",
    );
    const day = rows[0]!.today;
    await assert.rejects(()=>mutate("mgr","employment",aId,{scheduled_start_date:day}));
    await assert.rejects(()=>mutate("admin","employment",aId,{scheduled_start_date:day}));
    await assert.rejects(()=>mutate("hr","employment",aId,{actual_start_date:day,scheduled_start_date:day}));
    await mutate("hr","employment",aId,{scheduled_start_date:day});
    await mutate("hr","employment",aId,{actual_start_date:day,scheduled_start_date:day});
    await assert.rejects(()=>mutate("hr","road_test",aId,{result:"PASS",test_date:day}));
    await mutate("coach","road_test",aId,{result:"FAIL",test_date:day,note:"ทดลองฝึก"});
    assert.equal((await get(aId)).status,"STARTED");
    assert.equal((await get(aId)).data.road_test_result,"FAIL");
    await cmd("hr", "save_topic", {title:"ทักษะขับรถ",category:"PRACTICAL",position:"DRIVER",unit});
    await cmd("mgr", "save_topic", {title:"ข้อกำหนดกฎหมาย",category:"LEGAL",position:"DRIVER",unit});
    await assert.rejects(()=>cmd("coach","save_topic",{title:"เดิม",category:"COACH",unit}));
    const topics = (await cmd("hr", "snapshot")).topics;
    const topicId=topics.find((x:any)=>x.category==='PRACTICAL').id;
    for(const who of ['coach','safety','trainer','dispatch','admin','other'] as const) await assert.rejects(()=>mutate(who,"training",aId,{topic_id:topicId,training_date:day,result:"PASS"}));
    await mutate("peer","training",aId,{topic_id:topicId,training_date:day,result:"PASS"});
    await mutate("hr","training",aId,{topic_id:topicId,training_date:day,result:"FAIL"});
    assert.equal(
      (await cmd("coach", "detail", { id: aId })).applicant.data.national_id,
      undefined,
    );
    assert.equal((await cmd("hr", "dashboard")).retention.rate, 100);
    await mutate("hr", "employment", aId, {
      actual_start_date: day,
      resignation_date: day,
      note: "ลาออก",
    });
    assert.equal((await cmd("hr", "dashboard")).retention.rate, 0);
  });
  await t.test(
    "reserve recalls preserve submitted evaluation in a new draft round",
    async () => {
      const id = (
        await cmd("hr", "create_applicant", app("สำรอง ทดสอบ", "0899999999"))
      ).id;
      await assert.rejects(() =>
        mutate("hr", "screen", id, { result: "FORWARD" }),
      );
      await mutate("hr", "screen", id, {
        result: "FORWARD",
        duplicate_note: "ตรวจแล้วเป็นใบสมัครใหม่",
      });
      await mutate("mgr", "claim", id);
      await mutate("mgr", "interview", id, {
        score: 3,
        result: "PASS",
        submit: true,
      });
      await mutate("hr", "reserve", id, { note: "ยังไม่มีตำแหน่งว่าง" });
      await mutate("hr", "recall", id, {
        note: "มีอัตราว่างแล้ว",
        reuse: true,
      });
      const detail = await cmd("hr", "detail", { id });
      assert.equal(detail.applicant.status, "HR_REVIEW");
      assert.equal(detail.evaluations.length, 2);
      assert.equal(detail.evaluations[0].stage, "DRAFT");
    },
  );
  await t.test("HR-only scheduled start and no-show release the staffing slot",async()=>{
    const id=(await cmd("hr","create_applicant",app("ไม่มา เริ่มงาน","0833333333"))).id;
    const day=(await db.query<{as_of:string}>("select to_char((now() at time zone 'Asia/Bangkok')::date,'YYYY-MM-DD') as as_of")).rows[0]!.as_of;
    await assert.rejects(()=>mutate("hr","employment",id,{scheduled_start_date:day}));
    await mutate("hr","screen",id,{result:"FORWARD",duplicate_note:"ทดสอบรายใหม่"});
    await mutate("mgr","claim",id);
    await mutate("mgr","interview",id,{score:4,result:"PASS",road_result:"FAIL",fuel:"forged",submit:true});
    await assert.rejects(()=>mutate("coach","road_test",id,{result:"PASS",test_date:day}));
    await mutate("hr","match",id,{slot_id:slotId});
    const slot=req.slots.find((x:any)=>x.id===slotId);
    await mutate("hr","handover",id,{coach_id:ids.coach,supervisor_id:ids.mgr,plate:slot.plate,fleet_type:slot.fleet_type});
    await mutate("hr","employment",id,{scheduled_start_date:"2099-01-01"});
    await assert.rejects(()=>mutate("hr","no_show",id,{note:"ยังไม่ถึงวัน"}));
    await mutate("hr","employment",id,{scheduled_start_date:day});
    await assert.rejects(()=>mutate("admin","no_show",id,{note:"ไม่มา"}));
    await assert.rejects(()=>mutate("hr","close",id,{result:"NO_SHOW",note:"ข้ามโฟลว"}));
    await assert.rejects(()=>mutate("hr","no_show",id,{}));
    await mutate("hr","no_show",id,{note:"ติดต่อแล้วไม่มา"});
    assert.equal((await get(id)).status,"NO_SHOW");
    assert.equal((await cmd("hr","requests"))[0].slots.find((x:any)=>x.id===slotId).status,"OPEN");
    await assert.rejects(()=>mutate("hr","employment",id,{actual_start_date:day}));
  });
  await t.test("rich list columns, filters, sorting and pagination preserve private data boundaries",async()=>{
    const inserted=await db.query<{id:string}>(`insert into rm_private.applicants(full_name,phone,position,original_unit,hiring_unit,status,coach_id,data)values
    ('List47 Alpha','0800004701','DRIVER',$1,$1,'HIRED',$2,jsonb_build_object('birth_date',((now() at time zone 'Asia/Bangkok')::date-interval '30 years')::date::text,'vehicle_type','10W','national_id','private-id','driver_license_no','private-license')),
    ('List47 Beta','0800004702','DRIVER',$1,$1,'HIRED',$2,jsonb_build_object('birth_date',((now() at time zone 'Asia/Bangkok')::date-interval '20 years')::date::text,'vehicle_type','4W')) returning id`,[unit,ids.coach]);
    const list=await cmd('hr','applicants',{search:'List47',sort:'age',order:'asc',size:10});
    assert.equal(list.total,2);assert.equal(list.rows[0].age_years,20);assert.equal(list.rows[0].age_eligible,false);assert.equal(list.rows[1].age_years,30);assert.equal(list.rows[1].age_eligible,true);
    assert.ok(list.rows[0].applicant_code.startsWith('DRV-'));assert.equal(list.rows[1].vehicle_type,'10W');
    assert.ok(!JSON.stringify(list).includes('birth_date'));assert.ok(!JSON.stringify(list).includes('national_id'));assert.ok(!JSON.stringify(list).includes('private-id'));
    assert.equal((await cmd('hr','applicants',{search:'List47',age_min:25,vehicle:'10W',position:'DRIVER'})).total,1);
    assert.equal((await cmd('hr','applicants',{search:list.rows[0].applicant_code})).total,1);
    assert.equal((await cmd('hr','applicants',{search:'List47',offset:1,sort:'full_name',order:'asc'})).rows[0].full_name,'List47 Beta');
    assert.equal((await cmd('other','applicants',{search:'List47'})).total,0);
    const coach=await cmd('coach','applicants',{search:'List47'});assert.equal(coach.rows[0].age_years,null);assert.equal(coach.rows[0].age_eligible,null);
    await assert.rejects(()=>cmd('coach','applicants',{age_min:25}));await assert.rejects(()=>cmd('coach','applicants',{sort:'age'}));
    await assert.rejects(()=>cmd('hr','applicants',{age_min:40,age_max:20}));await assert.rejects(()=>cmd('hr','applicants',{size:100000}));await assert.rejects(()=>cmd('hr','applicants',{sort:'id; delete from rm_private.profiles'}));
    await assert.rejects(()=>as('hr',"select rm_private.applicant_age('2000-01-01',current_date)"));
    await db.query('delete from rm_private.applicants where id=any($1::uuid[])',[inserted.rows.map(r=>r.id)]);
  });
  await t.test('workflow queues filter full result before pagination, respect ownership and preserve privacy',async()=>{
    const day=(new Date()).toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'});
    const shift=(n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
    const cases=[
      ['review','HR_REVIEW',null,null,null,'PENDING','HR_REVIEW'],
      ['info','WAITING_INFO',null,null,null,'PENDING','WAITING_INFO'],
      ['unclaimed','INTERVIEW',null,null,null,'PENDING','INTERVIEW_UNCLAIMED'],
      ['interview','INTERVIEW',ids.mgr,null,null,'PENDING','INTERVIEW_IN_PROGRESS'],
      ['handover','HIRED',ids.mgr,null,null,'PENDING','HANDOVER_PENDING'],
      ['schedule','HIRED',ids.mgr,ids.coach,null,'PENDING','START_DATE_PENDING'],
      ['today','HIRED',ids.mgr,ids.coach,day,'PENDING','START_TODAY'],
      ['overdue','HIRED',ids.mgr,ids.coach,shift(-1),'PENDING','START_OVERDUE'],
      ['future','HIRED',ids.mgr,ids.coach,shift(2),'PENDING','START_SCHEDULED'],
      ['active','STARTED',ids.mgr,ids.coach,shift(-2),'ACTIVE','ACTIVE'],
      ['resigned','STARTED',ids.mgr,ids.coach,shift(-2),'RESIGNED','RESIGNED'],
      ['no-show','NO_SHOW',ids.mgr,ids.coach,shift(-2),'PENDING','NO_SHOW'],
    ];
    const fixtureIds:string[]=[];
    for(const [name,status,owner,coach,scheduled,employment] of cases){
      const row=await db.query<{id:string}>(`insert into rm_private.applicants(full_name,phone,position,original_unit,hiring_unit,status,owner_id,coach_id,supervisor_id,scheduled_start_date,employment_status,data)
        values($1,'0894900000','DRIVER',$2,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,['Flow49 '+name,unit,status,owner,coach,ids.mgr,scheduled,employment,JSON.stringify({plate:'TEST-49',fleet_type:'COMPANY',followup_date:shift(-1),national_id:'private-workflow-id',birth_date:'1990-01-01'})]);
      fixtureIds.push(row.rows[0]!.id);
    }
    const list=await cmd('hr','applicants',{search:'Flow49',size:20});
    for(const c of cases)assert.equal(list.rows.find((r:any)=>r.full_name==='Flow49 '+c[0]).workflow_stage,c[6]);
    const overdue=await cmd('hr','applicants',{search:'Flow49',workflow_stage:'START_OVERDUE'});
    assert.equal(overdue.total,1);assert.equal(overdue.rows[0].next_date,shift(-1));assert.equal(overdue.rows[0].status,'HIRED');
    const info=await cmd('hr','applicants',{search:'Flow49',status:'WAITING_INFO',sort:'next_date',order:'asc'});assert.equal(info.rows[0].next_date,shift(-1));
    assert.equal((await cmd('other','applicants',{search:'Flow49',workflow_stage:'START_TODAY'})).total,0);
    const pending=await cmd('coach','applicants',{search:'Flow49',queue:'coach_pending'});
    assert.equal(pending.total,5);assert.ok(pending.rows.every((r:any)=>r.coach_id===ids.coach&&r.road_test_pending&&r.workflow_stage!=='RESIGNED'));
    assert.ok(!JSON.stringify(pending).includes('private-workflow-id'));assert.ok(!JSON.stringify(pending).includes('birth_date'));
    await db.query("update rm_private.applicants set data=data||'{\"road_test_result\":\"PASS\"}'::jsonb where full_name='Flow49 today'");
    assert.equal((await cmd('coach','applicants',{search:'Flow49',queue:'coach_pending'})).total,4);
    await assert.rejects(()=>cmd('hr','applicants',{queue:'coach_pending'}));await assert.rejects(()=>cmd('hr','applicants',{workflow_stage:'INVALID'}));
    // More than one page of owned pending work plus an unassigned record, no page-local filtering.
    await db.query(`insert into rm_private.applicants(full_name,phone,position,original_unit,hiring_unit,status,coach_id)
       select 'Flow49 page '||n,'0894900001','DRIVER',$1,$1,'HIRED',$2 from generate_series(1,12) n`,[unit,ids.coach]);
    const page=await cmd('coach','applicants',{search:'Flow49 page',queue:'coach_pending',size:10,offset:10});assert.equal(page.total,12);assert.equal(page.rows.length,2);
    await assert.rejects(()=>as('hr',"select rm_private.workflow_date('2026-10-25')"));
    assert.equal((await db.query<{d:string|null}>("select rm_private.workflow_date('2026-02-30') as d")).rows[0]!.d,null);
    await db.query("delete from rm_private.applicants where full_name like 'Flow49 %'");
  });
  await t.test('private Drive documents: public upload capability, live role scope, idempotency and reset protection',async()=>{
    const bridgeKey='integration-test-only-key-'.repeat(5),hash='a'.repeat(64);
    const call=async(user:keyof typeof ids|null,name:string,payload:any)=>((await as(user,`select public.${name}($1) data`,[typeof payload==='string'?payload:JSON.stringify(payload)])).rows[0] as any).data;
    const authorize=(user:keyof typeof ids|null,d:any)=>call(user,'recruitment_drive_authorize',d);
    const commit=(d:any)=>call(null,'recruitment_drive_commit',{bridge_key:bridgeKey,...d});
    assert.equal(((await as(null,'select public.recruitment_drive_status() data')).rows[0] as any).data.enabled,false);
    await db.query("update rm_private.drive_config set enabled=true,bridge_url='https://script.google.com/macros/s/test_bridge/exec',bridge_key_hash=rm_private.drive_hash($1)",[bridgeKey]);
    await cmd('admin','settings',{public_apply:true});
    const pin=((await as('hr','select public.recruitment_application_pin() data')).rows[0] as any).data.pin;
    const ticket=((await as(null,'select public.recruitment_unlock_application($1) data',[pin])).rows[0] as any).data.token;
    const payload={...app('Drive test public','0894100000'),access_token:ticket,document_count:2};
    const submitted=await call(null,'recruitment_apply_with_documents',payload),i=submitted.id;
    assert.ok(submitted.reference_code.startsWith('DRV-'));assert.ok(submitted.upload_token.length>=60);
    const retry=await call(null,'recruitment_apply_with_documents',payload);assert.equal(retry.id,submitted.id);assert.equal(retry.upload_token,submitted.upload_token); // Lost response can be retried without another application.
    await assert.rejects(()=>call(null,'recruitment_apply',payload)); // Original PIN ticket is still consumed once.
    const id1='41000000-0000-4000-8000-000000000001',id2='41000000-0000-4000-8000-000000000002',id3='41000000-0000-4000-8000-000000000003';
    const d={action:'upload',applicant_id:i,document_id:id1,filename:'ทดสอบ.png',mime_type:'image/png',byte_size:8,sha256:hash,upload_token:submitted.upload_token};
    const reserved=await authorize(null,d);assert.equal(reserved.folder_code,submitted.reference_code);
    assert.equal((await authorize(null,d)).id,id1); // Retry uses the same reservation, not another quota slot.
    await assert.rejects(()=>authorize(null,{...d,document_id:id2,byte_size:10485761}));
    await assert.rejects(()=>authorize(null,{...d,document_id:id2,mime_type:'image/svg+xml'}));
    await assert.rejects(()=>authorize(null,{...d,document_id:id2,filename:'../other.png'}));
    await assert.rejects(()=>authorize(null,{...d,action:'read'}));
    await assert.rejects(()=>authorize(null,{...d,applicant_id:aId}));
    await authorize(null,{...d,document_id:id2,filename:'other.png'});
    await assert.rejects(()=>authorize(null,{...d,document_id:id3})); // Count across requests, not just UI selection.
    await assert.rejects(()=>call(null,'recruitment_drive_commit',{document_id:id1,file_id:'drive_file_410_001',sha256:hash,bridge_key:'wrong-key'}));
    await commit({document_id:id1,file_id:'drive_file_410_001',sha256:hash});
    await commit({document_id:id1,file_id:'drive_file_410_001',sha256:hash});
    await assert.rejects(()=>commit({document_id:id1,file_id:'drive_file_410_other',sha256:hash}));
    assert.equal(Number((await db.query<{n:string}>('select count(*) n from rm_private.activities where applicant_id=$1 and action=$2',[i,'DRIVE_DOCUMENT_ADDED'])).rows[0]!.n),1);
    const list=await call('hr','recruitment_drive_documents',i);assert.equal(list.length,2);assert.ok(!JSON.stringify(list).includes('drive_file_'));assert.ok(!JSON.stringify(list).includes('sha256'));assert.ok(!JSON.stringify(list).includes('grant_id'));
    await assert.rejects(()=>call(null,'recruitment_drive_documents',i));
    await assert.rejects(()=>call('other','recruitment_drive_documents',i));
    await assert.rejects(()=>call('coach','recruitment_drive_documents',i)); // Still respects hired/started-only Coach scope.
    await assert.rejects(()=>authorize('mgr',{...d,document_id:id3})); // Supervisor is view-only.
    await db.query("update rm_private.applicants set status='HIRED',position='HELPER' where id=$1",[i]);
    assert.equal((await cmd('hr','applicants',{search:'Drive test public'})).rows[0].applicant_code,submitted.reference_code);
    assert.equal((await call('mgr','recruitment_drive_documents',i)).length,1); // Pending records visible only to HR/Admin.
    assert.equal((await call('coach','recruitment_drive_documents',i)).length,1);
    await authorize('coach',{action:'read',applicant_id:i,document_id:id1});
    await assert.rejects(()=>authorize('coach',{action:'recover',applicant_id:i,document_id:id2}));
    await db.query('update rm_private.profiles set active=false where id=$1',[ids.coach]);
    await assert.rejects(()=>authorize('coach',{action:'read',applicant_id:i,document_id:id1}));
    await db.query('update rm_private.profiles set active=true where id=$1',[ids.coach]);
    await db.query("update rm_private.drive_upload_grants set expires_at=now()-interval '1 second' where applicant_id=$1",[i]);
    await assert.rejects(()=>authorize(null,d));
    await authorize('hr',{action:'recover',applicant_id:i,document_id:id2}); // HR can reconcile after applicant capability expired.
    await commit({document_id:id2,file_id:'drive_file_410_002',sha256:hash});
    const backup=await cmd('admin','backup');assert.equal(backup.drive_attachments.length,2);assert.ok(!JSON.stringify(backup).includes(bridgeKey));
    const plan=await cmd('admin','reset_preview');assert.ok(plan.documents>=2);
    await assert.rejects(()=>cmd('admin','reset_transactions',{confirmation:'RESET RECRUITMENT',fingerprint:plan.fingerprint}));
    for(const user of [null,'hr','coach'] as const){await assert.rejects(()=>as(user,'select * from rm_private.drive_upload_grants'));await assert.rejects(()=>as(user,'select * from rm_private.drive_config'));await assert.rejects(()=>as(user,'select * from rm_private.drive_attachments'));}
    await db.query('delete from rm_private.drive_attachments where applicant_id=$1',[i]);
    await db.query('delete from rm_private.activities where applicant_id=$1',[i]);
    await db.query('delete from rm_private.drive_upload_grants where applicant_id=$1',[i]);
    await db.query('delete from rm_private.applicants where id=$1',[i]);
    await db.query('update rm_private.drive_config set enabled=false');
  });
  await t.test(
    "live profile deactivation, self-demotion guard and public submission gating",
    async () => {
      await assert.rejects(() =>
        cmd("admin", "save_profile", {
          email: "admin@test.invalid",
          display_name: "admin",
          role: "HR",
          units: [],
          active: true,
          version: 1,
        }),
      );
      await cmd("admin", "settings", {
        public_apply: true,
        form_url: "",
        sheet_url: "",
        drive_url: "",
      });
      const pin=(await as("hr","select public.recruitment_application_pin() data")).rows[0] as any;
      const ticket=(await as(null,"select public.recruitment_unlock_application($1) data",[pin.data.pin])).rows[0] as any;
      const payload = {...app("ออนไลน์ ทดสอบ", "0822222222"),access_token:ticket.data.token};
      const r = await as(null, "select public.recruitment_apply($1) data", [
        JSON.stringify(payload),
      ]);
      assert.ok((r.rows[0] as any).data.id);
      await assert.rejects(() =>
        as(null, "select public.recruitment_apply($1)", [
          JSON.stringify(payload),
        ]),
      );
      await db.query(
        "update rm_private.profiles set active=false where id=$1",
        [ids.coach],
      );
      await assert.rejects(() => cmd("coach", "snapshot"));
    },
  );

  await t.test(
    "document policies deny cross-user upload paths and redact sensitive profile data",
    async () => {
      await assert.rejects(() =>
        as(
          "safety",
          "insert into storage.objects(id,bucket_id,name)values(gen_random_uuid(),'recruitment-documents',$1)",
          [ids.safety + "/" + aId + "/test.pdf"],
        ),
      );
      await assert.rejects(() =>
        as(
          "mgr",
          "insert into storage.objects(id,bucket_id,name)values(gen_random_uuid(),'recruitment-documents',$1)",
          [ids.hr + "/" + aId + "/test.pdf"],
        ),
      );
      await as(
        "hr",
        "insert into storage.objects(id,bucket_id,name)values(gen_random_uuid(),'recruitment-documents',$1)",
        [ids.hr + "/" + aId + "/test.pdf"],
      );
      assert.equal(
        (await as("safety", "select * from storage.objects")).rows.length,
        0,
      );
      assert.equal(
        (await as("hr", "select * from storage.objects")).rows.length,
        1,
      );
    },
  );
  await t.test(
    "reset requires admin, explicit confirmation, unchanged plan, and preserves accounts/topics",
    async () => {
      await assert.rejects(() => cmd("hr", "reset_preview"));
      const blockedPlan = await cmd("admin", "reset_preview");
      await assert.rejects(() =>
        cmd("admin", "reset_transactions", {
          confirmation: "RESET RECRUITMENT",
          fingerprint: blockedPlan.fingerprint,
        }),
      );
      await db.exec("delete from storage.objects");
      const plan = await cmd("admin", "reset_preview");
      const profiles = (await cmd("admin", "profiles")).length;
      await assert.rejects(() =>
        cmd("admin", "reset_transactions", {
          confirmation: "RESET RECRUITMENT",
          fingerprint: "stale",
        }),
      );
      await assert.rejects(() =>
        cmd("admin", "reset_transactions", {
          confirmation: "wrong",
          fingerprint: plan.fingerprint,
        }),
      );
      await assert.rejects(() =>
        cmd("admin", "reset_transactions", { fingerprint: plan.fingerprint }),
      );
      const backup = await cmd("admin", "backup");
      assert.ok(backup.applicants.length > 0);
      assert.ok(!JSON.stringify(backup).includes("password"));
      await cmd("admin", "reset_transactions", {
        confirmation: "RESET RECRUITMENT",
        fingerprint: plan.fingerprint,
      });
      assert.equal((await cmd("hr", "applicants")).total, 0);
      assert.equal((await cmd("admin", "profiles")).length, profiles);
      assert.ok((await cmd("admin", "snapshot")).topics.length > 0);
    },
  );
  await db.close();
});
