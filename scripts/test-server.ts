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
await db.exec(await readFile(new URL("../supabase/migrations/20261020130620_applicant_list_workspace_v47.sql",import.meta.url),"utf8"));
await db.exec(await readFile(new URL("../supabase/migrations/20261025142241_workflow_visibility_v49.sql",import.meta.url),"utf8"));
await db.exec(await readFile(new URL("../supabase/migrations/20261025152924_google_drive_attachments_v410.sql",import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/20261027025639_applicant_corrections_v411.sql",import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/20261028102456_request_editing_v412.sql",import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/20261028173123_applicant_reference_v413.sql",import.meta.url),"utf8"));
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
// Screening fixtures for the role work queue and next-action UI.
for(const [index,status] of ["HR_REVIEW","WAITING_INFO"].entries()) {
 await db.query(`insert into rm_private.applicants(full_name,phone,position,original_unit,hiring_unit,status,data)values($1,$2,'DRIVER','TL-ขอนแก่น','TL-ขอนแก่น',$3,$4)`,["ทดสอบ "+(index?"รอข้อมูล":"คัดกรอง"),"082222222"+index,status,JSON.stringify({birth_date:"1990-01-01",national_id:"123456789012"+(4+index),fuel_type:"รถน้ำมัน",vehicle_type:"10W",license_type:"ท.3",followup_date:"2026-10-20"})]);
}
const driveMedia=new Map<string,{base64:string;mime_type:string;byte_size:number;file_id:string}>();
const mockBridgeKey='test-bridge-never-use-in-production-'.repeat(4);
await db.query("update rm_private.drive_config set enabled=true,bridge_url='https://script.google.com/macros/s/local_test/exec',bridge_key_hash=rm_private.drive_hash($1)",[mockBridgeKey]);
const mockAttachmentApp=(await db.query<{id:string;created_at:string}>("select id,created_at from rm_private.applicants where full_name='ทดสอบ อบรม'")).rows[0]!;
for(const [index,fixture] of [{"name": "TEST-ONLY.png", "mime": "image/png", "data": "iVBORw0KGgoAAAANSUhEUgAAAZAAAADwCAIAAAChXqV1AAAE1ElEQVR4nO3YMc5aZxBAUZfeqfeQ3aZ26Q2kTRFF8MG8eReOdAqEhuExv3wL//j7z2+AhB/rTwDwIMECMgQLyBAsIEOwgAzBAjIEC8gQLCBDsIAMwQIyBAvIECwgQ7CADMECMgQLyBAsIEOwgAzBAjIEC8gQLCBDsIAMwQIyBAvIeFuwfv71C+A/CRaQIVhAhmABGbcO1rt2Al2CBWQIFpAhWECGYAEZggVkCBaQIVhAhmABGYIFZAgWkCFYQIZgARmCBWQIFpAhWECGYAEZggVkCBaQIVhAhmABGYIFZAgWkCFYQIZgARmCBWQIFpAhWECGYAEZggVkCBaQIVhAhmABGYIFZAgWkCFYQIZgARmCBWQIFpAhWECGYAEZggVkCBaQIVhAhmABGYIFZAgWkCFYQIZgARmCBWQIFpAhWECGYAEZggVkCBaQIVhAhmABGYIFZAgWkCFYQIZgARmCBWQIFpAhWECGYAEZggVkCBaQIVhAhmABGYIFZAgWkCFYQIZgARmCBWQIFpAhWECGYF105ePX37Bn6+aPfPbZ73plz/TzfADBuujKx6+/Yc/WzR/57LPf9cqe6ef5AIJ10ZWPX3/Dnq2bP/LZZ7/rlT3Tz/MBBOuiKx+//oY9Wzd/5LPPftcre6af5wMI1vL1R+en92ztn77nuwInWG8nWMvXH52f3rO1f/qegnVbgrV8/dH56T1b+6fvKVi3JVjL1x+dn96ztX/6noJ1W4K1fP3R+ek9W/un73m3YG191w0J1vL1R+en92ztn76nYN2WYC1ff3R+es/W/ul7CtZtCdby9Ufnp/ds7Z++p2DdlmAtX/94/pHX79pT+U/fiWBNvL/1ez+AYC1f/3hesN57zyvf3/q9H0Cwlq9/PC9Y773nle9v/d4PIFjL1z+eF6z33vPK97d+7wcQrOXrj857zrP5V6J/5R0+9d/F//9kwdq8/ui85zybF6zbEqzl64/Oe86zecG6LcFavv7ovOc8mxes2xKs5euPznvOs3nBui3BWr7+6LznPJsXrNsSrOXrj857zrN5wbotwVq+/ui85zybF6zbEqzl6x/PP/t6Ys+7ftf0bZ/9LRPh+9Q7X0ywlq9/PC9Yr99q4u/ybXe+mGAtX/94XrBev9XE3+Xb7nwxwVq+/vG8YL1+q4m/y7fd+WKCBWQIFpAhWECGYAEZggVkCBaQIVhAhmABGYIFZAgWkCFYQIZgARmCBWQIFpAhWECGYAEZggVkCBaQIVhAhmABGYIFZAgWkCFYQIZgARmCBWQIFpAhWECGYAEZggVkCBaQIVhAhmABGYIFZAgWkCFYQIZgARmCBWQIFpAhWECGYAEZggVkCBaQIVhAhmABGYIFZAgWkCFYQIZgARmCBWQIFpAhWECGYAEZggVkCBaQIVhAhmABGYIFZAgWkCFYQIZgARmCBWQIFpAhWECGYAEZggVkCBaQIVhAhmABGYIFZAgWkCFYQIZgARmCBWQIFpAhWECGYAEZggVkCBaQIVhAhmABGZlgAfybYAEZggVkCBaQcbtgAUwTLCBDsIAMwQIyBAvIECwgQ7CADMECMgQLyBAsIEOwgAzBAjIEC8gQLCBDsIAMwQIyBAvIECwgQ7CADMECMgQLyBAsIEOwgAzBAjL+AeW09kbnotRLAAAAAElFTkSuQmCC"}, {"name": "TEST-ONLY.pdf", "mime": "application/pdf", "data": "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNTYgPj4Kc3RyZWFtCkJUIC9GMSAxOCBUZiA1MCAxMDAgVGQgKFRFU1QgT05MWSAtIExPQ0FMIEZJWFRVUkUpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzMTEgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MTcKJSVFT0Y="}].entries()){
 const bytes=Buffer.from(fixture.data,'base64'),id='41000000-0000-4000-8000-'+String(index+1).padStart(12,'0');
 const code='DRV-'+new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(mockAttachmentApp.created_at)).replaceAll('-','')+'-'+mockAttachmentApp.id.replaceAll('-','').slice(0,8).toUpperCase();
 await db.query("update rm_private.applicants set document_code=$1 where id=$2",[code,mockAttachmentApp.id]);
 await db.query("insert into rm_private.drive_attachments(id,applicant_id,folder_code,filename,mime_type,byte_size,sha256,drive_file_id,state,created_by,authorized_by,authorized_until)values($1,$2,$3,$4,$5,$6,rm_private.drive_hash('mock'),$7,'READY',$8,$8,now()+interval '1 hour')",[id,mockAttachmentApp.id,code,fixture.name,fixture.mime,bytes.length,'mock_drive_'+id.replaceAll('-',''),users[1]!.id]);
 driveMedia.set(id,{base64:fixture.data,mime_type:fixture.mime,byte_size:bytes.length,file_id:'mock_drive_'+id.replaceAll('-','')});
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
            const d = body ? req.url==='/mock/drive'?JSON.parse(new URLSearchParams(body).get('payload')||'{}'):JSON.parse(body) : {};
            const bearer =
              req.headers.authorization?.replace("Bearer ", "") || d.access_token || "";
            let uid = "";
            try {
              uid = JSON.parse(
                Buffer.from(bearer.split(".")[1] || "", "base64url").toString(),
              ).sub;
            } catch {}
            if(req.url==='/mock/drive'){
              let result:any;
              await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role '+(uid?'authenticated':'anon'));
              try{
                const f=(await db.query<any>('select public.recruitment_drive_authorize($1) data',[JSON.stringify(d)])).rows[0]!.data;
                if(d.action==='read'){
                  const media=driveMedia.get(f.id);if(!media)throw Error('Mock file missing');result={ok:true,data:{id:f.id,filename:f.filename,mime_type:f.mime_type,base64:media.base64}};
                }else{
                  if(d.action==='upload'&&!driveMedia.has(f.id))driveMedia.set(f.id,{base64:d.base64,mime_type:d.mime_type,byte_size:d.byte_size,file_id:'mock_drive_'+f.id.replaceAll('-','')});
                  const media=driveMedia.get(f.id);if(!media)throw Error('Mock file missing');
                  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");await db.exec('set role anon');
                  await db.query('select public.recruitment_drive_commit($1)',[JSON.stringify({bridge_key:mockBridgeKey,document_id:f.id,file_id:media.file_id,sha256:f.sha256})]);result={ok:true,data:{id:f.id,state:'READY'}};
                }
              }catch(e){result={ok:false,message:(e as Error).message};}finally{await db.exec('reset role');}
              const envelope=JSON.stringify({kind:'recruitment-drive-v1',request_id:d.request_id,nonce:d.nonce,...result}).replaceAll('<','\\u003c');
              res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<script>var m='+envelope+';var w=window;for(var i=0;i<8;i++){var p=w.parent;if(p===w)break;p.postMessage(m,"http://127.0.0.1:3100");w=p;}</script>');return;
            }
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
                const driveQueries:Record<string,[string,unknown[]]>={recruitment_drive_status:['select public.recruitment_drive_status() data',[]],recruitment_drive_documents:['select public.recruitment_drive_documents($1) data',[d.p_applicant_id]],recruitment_apply_with_documents:['select public.recruitment_apply_with_documents($1) data',[JSON.stringify(d.p_payload)]]};
                const driveQuery=driveQueries[name||''];
                const gateQuery = name === "recruitment_application_pin" ? "select public.recruitment_application_pin() data" : name === "recruitment_unlock_application" ? "select public.recruitment_unlock_application($1) data" : "";
                const query = driveQuery?.[0] || gateQuery || (name === "recruitment_command"
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
                const r = await db.query(query, driveQuery?.[1] || params);
                const value=(r.rows[0] as any).data;
                if(name==='recruitment_drive_status'&&value.enabled)value.url='http://127.0.0.1:3100/mock/drive';
                res.end(JSON.stringify(value));
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
