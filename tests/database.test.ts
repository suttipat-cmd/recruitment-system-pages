import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
const ids = {
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
  for (const [key, id] of Object.entries(ids)) {
    await db.query("insert into auth.users values($1,$2)", [
      id,
      key + "@test.invalid",
    ]);
    await db.query(
      "insert into rm_private.profiles(id,email,display_name,role,units) values($1,$2,$3,$4,$5)",
      [
        id,
        key + "@test.invalid",
        key,
        (
          {
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
          title: "รถเพิ่ม",
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
      req = (await cmd("hr", "requests"))[0];
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
        (await cmd("hr", "requests"))[0].slots.find((s: any) => s.id === slotId)
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
    "screen, claim and optional road test: confirmed PASS hires immediately and fills slot",
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
      assert.equal(
        (await cmd("hr", "requests"))[0].slots.find((s: any) => s.id === slotId)
          .status,
        "FILLED",
      );
      const k = (await cmd("hr", "dashboard")).kpi14;
      assert.equal(k.total, 2);
      assert.equal(k.on_time, 1);
    },
  );
  await t.test("handover, employment and role-scoped training", async () => {
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
    await mutate("hr", "employment", aId, {
      actual_start_date: day,
      scheduled_start_date: day,
    });
    await cmd("coach", "save_topic", {
      title: "สอนขับ",
      category: "COACH",
      position: "DRIVER",
      unit,
    });
    await cmd("safety", "save_topic", {
      title: "ความปลอดภัย",
      category: "SAFETY",
      position: "DRIVER",
      unit,
    });
    const topics = (await cmd("hr", "snapshot")).topics;
    const coachTopic = topics.find((x: any) => x.category === "COACH").id;
    const safetyTopic = topics.find((x: any) => x.category === "SAFETY").id;
    await mutate("coach", "training", aId, {
      topic_id: coachTopic,
      training_date: day,
      result: "PASS",
    });
    await assert.rejects(() =>
      mutate("coach", "training", aId, {
        topic_id: safetyTopic,
        training_date: day,
        result: "PASS",
      }),
    );
    await assert.rejects(() =>
      mutate("other", "training", aId, {
        topic_id: safetyTopic,
        training_date: day,
        result: "PASS",
      }),
    );
    await mutate("safety", "training", aId, {
      topic_id: safetyTopic,
      training_date: day,
      result: "FAIL",
    });
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
      const payload = app("ออนไลน์ ทดสอบ", "0822222222");
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
