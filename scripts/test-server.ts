/** Isolated test harness: fake Auth + real local PostgreSQL. Never deploy this file. */
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
const db = new PGlite();
await db.exec(
  `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;`,
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
await db.exec(await readFile(new URL("../supabase/migrations/20261020105230_application_pin.sql",import.meta.url),"utf8"));
await db.exec(await readFile(new URL("../supabase/migrations/20261020111221_required_application_fields.sql",import.meta.url),"utf8"));
await db.exec(await readFile(new URL("../supabase/migrations/20261020113344_hiring_workflow_v43.sql",import.meta.url),"utf8"));
await db.exec(await readFile(new URL("../supabase/migrations/20261020120123_four_roles_and_request_types.sql",import.meta.url),"utf8"));
const users = [
  "admin",
  "hr",
  "manager",
  "coach",
].map((name, index) => ({
  id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  name,
  email: name + "@example.test",
  role: [
    "ADMIN",
    "HR",
    "MANAGER",
    "COACH",
  ][index]!,
}));
for (const u of users) {
  await db.query("insert into auth.users values($1,$2)", [u.id, u.email]);
  await db.query(
    "insert into rm_private.profiles(id,email,display_name,role,units)values($1,$2,$3,$4,$5)",
    [
      u.id,
      u.email,
      (
        {
          admin: "ผู้ดูแลระบบ",
          hr: "HR ทดลอง",
          manager: "หัวหน้างาน ทดลอง",
          coach: "Coach ทดลอง",
          safety: "Safety ทดลอง",
          trainer: "Trainer ทดลอง",
          dispatch: "ผู้จัดส่ง ทดลอง",
        } as Record<string, string>
      )[u.name],
      u.role,
      ["TL-ขอนแก่น"],
    ],
  );
}
await db.exec(
  `update rm_private.settings set data='{"public_apply":true}';insert into rm_private.topics(title,category,position)values('พื้นฐานการทำงาน','CUSTOMER','DRIVER'),('ขับขี่ปลอดภัย','PRACTICAL','DRIVER'),('ความปลอดภัยก่อนเริ่มงาน','LEGAL','DRIVER');`,
);
// Synthetic fixtures only, scoped to this in-memory harness.
for (const [index,status] of ["INTERVIEW","HIRED","HIRED","STARTED"].entries()) {
  const assigned=index>=2;
  const seed={birth_date:"1990-01-01",national_id:"1234567890123",fuel_type:"รถไฟฟ้า",vehicle_type:"10W",license_type:"ท.3",driver_license_no:"TEST",forwarded_at:new Date().toISOString(),...(assigned?{plate:"ทดสอบ-001",fleet_type:"COMPANY"}:{})};
  await db.query(`insert into rm_private.applicants(full_name,phone,position,original_unit,hiring_unit,status,owner_id,coach_id,supervisor_id,scheduled_start_date,actual_start_date,employment_status,data)values($1,$2,'DRIVER','TL-ขอนแก่น','TL-ขอนแก่น',$3,$4,$5,$6,case when $7 then current_date else null end,case when $8 then current_date else null end,case when $8 then 'ACTIVE' else 'PENDING' end,$9)`,["ทดสอบ "+["สัมภาษณ์","ส่งมอบ","นัดเริ่มงาน","อบรม"][index],"081111111"+index,status,users[2]!.id,assigned?users[3]!.id:null,assigned?users[2]!.id:null,index===3,index===3,JSON.stringify(seed)]);
}
let serial = Promise.resolve();
const server = await createServer({
  configFile: false,
  root: "web",
  server: { host: "127.0.0.1", port: 3100, strictPort: true },
  plugins: [
    {
      name: "test-api",
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (
            !req.url?.startsWith("/api/config") &&
            !req.url?.startsWith("/mock/")
          ) {
            next();
            return;
          }
          const execute = async () => {
            res.setHeader("Content-Type", "application/json");
            if (req.url === "/api/config") {
              res.end(
                JSON.stringify({
                  url: "http://127.0.0.1:3100/mock",
                  key: "test-only-key",
                }),
              );
              return;
            }
            let body = "";
            for await (const part of req) body += part;
            const d = body ? JSON.parse(body) : {};
            const bearer =
              req.headers.authorization?.replace("Bearer ", "") || "";
            let uid = "";
            try {
              uid = JSON.parse(
                Buffer.from(bearer.split(".")[1] || "", "base64url").toString(),
              ).sub;
            } catch {}
            if (req.url?.startsWith("/mock/auth/v1/token")) {
              const u = users.find((x) => x.email === d.email);
              if (!u || d.password !== "test-password-123") {
                res.statusCode = 400;
                res.end(
                  JSON.stringify({ message: "Invalid login credentials" }),
                );
                return;
              }
              const token = [
                { alg: "HS256", typ: "JWT" },
                {
                  sub: u.id,
                  aud: "authenticated",
                  role: "authenticated",
                  exp: Math.floor(Date.now() / 1000) + 3600,
                },
                "fixture",
              ]
                .map((x, i) =>
                  i < 2
                    ? Buffer.from(JSON.stringify(x)).toString("base64url")
                    : x,
                )
                .join(".");
              res.end(
                JSON.stringify({
                  access_token: token,
                  refresh_token: "fixture",
                  token_type: "bearer",
                  expires_in: 3600,
                  user: {
                    id: u.id,
                    email: u.email,
                    aud: "authenticated",
                    role: "authenticated",
                    app_metadata: {},
                    user_metadata: {},
                    created_at: new Date().toISOString(),
                  },
                }),
              );
              return;
            }
            if (req.url?.startsWith("/mock/auth/v1/user")) {
              const u = users.find((x) => x.id === uid);
              res.statusCode = u ? 200 : 401;
              res.end(
                JSON.stringify(
                  u
                    ? {
                        id: u.id,
                        email: u.email,
                        aud: "authenticated",
                        role: "authenticated",
                        app_metadata: {},
                        user_metadata: {},
                      }
                    : { message: "Unauthorized" },
                ),
              );
              return;
            }
            if (req.url?.startsWith("/mock/auth/v1/logout")) {
              res.end("{}");
              return;
            }
            if (req.url?.startsWith("/mock/rest/v1/rpc/")) {
              const name = req.url.split("/").pop();
              await db.exec("reset role");
              await db.query(
                "select set_config('request.jwt.claim.sub',$1,false)",
                [uid],
              );
              await db.exec("set role " + (uid ? "authenticated" : "anon"));
              try {
                const gateQuery = name === "recruitment_application_pin" ? "select public.recruitment_application_pin() data" : name === "recruitment_unlock_application" ? "select public.recruitment_unlock_application($1) data" : "";
                const query = gateQuery || (name === "recruitment_command"
                    ? "select public.recruitment_command($1,$2) data"
                    : name === "recruitment_apply"
                      ? "select public.recruitment_apply($1) data"
                      : name === "recruitment_public_info"
                        ? "select public.recruitment_public_info() data"
                        : "");
                if (!query) throw Error("Unknown RPC");
                const params = name === "recruitment_unlock_application" ? [d.p_pin] : name === "recruitment_command"
                    ? [d.p_action, JSON.stringify(d.p_payload)]
                    : name === "recruitment_apply"
                      ? [JSON.stringify(d.p_payload)]
                      : [];
                const r = await db.query(query, params);
                res.end(JSON.stringify((r.rows[0] as any).data));
              } catch (error) {
                res.statusCode = 400;
                res.end(
                  JSON.stringify({
                    message: (error as Error).message,
                    code: "TEST_ERROR",
                  }),
                );
              } finally {
                await db.exec("reset role");
              }
              return;
            }
            res.statusCode = 404;
            res.end("{}");
          };
          serial = serial.then(execute).catch((e) => {
            res.statusCode = 500;
            res.end(JSON.stringify({ message: String(e) }));
          });
        });
      },
    },
  ],
});
await server.listen();
console.log(
  "Isolated UI test: http://127.0.0.1:3100 — hr@example.test / test-password-123",
);
