import { appAddress, configAddress, attachmentsEnabled } from "./runtime";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  roles,
  statuses,
  categories,
  esc,
  date,
  isoDate,
  today,
  retention,
  canTrain,
  requiresAgeApproval,
  type Applicant,
  type Profile,
  type Role,
} from "./domain";
import "./style.css";
type Row = Record<string, any>;
const root = document.querySelector<HTMLDivElement>("#app")!;
const modal = document.querySelector<HTMLDialogElement>("#modal")!;
let db: SupabaseClient;
let profile: Profile;
let units: string[] = [];
let people: Row[] = [];
let topics: Row[] = [];
let settings: Row = {};
let screen = "dashboard";
let filters = { search: "", status: "", unit: "", offset: 0 };
let detail: Row | null = null;
let recovery = false;
let generation = 0;
const is = (...r: Role[]) => !!profile && r.includes(profile.role);
const person = (id: unknown) =>
  people.find((x) => x.id === id)?.display_name || "—";
const position = (p: unknown) =>
  p === "DRIVER" ? "พนักงานขับรถ" : "เด็กติดรถ";
const fleet = (p: unknown) =>
  p === "COMPANY" ? "รถบริษัท" : p === "PARTNER" ? "รถร่วม" : "—";
const button = (text: string, act: string, cls = "") =>
  `<button type="button" data-action="${act}" class="${cls}">${text}</button>`;
const opts = (
  rows: { value: string; label: string }[],
  selected: unknown = "",
  empty = "เลือก…",
) =>
  `<option value="">${empty}</option>` +
  rows
    .map(
      (x) =>
        `<option value="${esc(x.value)}" ${x.value === selected ? "selected" : ""}>${esc(x.label)}</option>`,
    )
    .join("");
const unitOpts = (selected: unknown = "", list = units) =>
  opts(
    list.map((x) => ({ value: x, label: x })),
    selected,
  );
const peopleOpts = (role: string, selected: unknown = "", unit?: string) =>
  opts(
    people
      .filter((x) => x.role === role && (!unit || x.units.includes(unit)))
      .map((x) => ({ value: x.id, label: x.display_name })),
    selected,
    "ยังไม่กำหนด",
  );
const badge = (s: unknown) =>
  `<span class="badge ${["WAITING_INFO", "RESERVE", "INTERVIEW"].includes(String(s)) ? "warn" : ["REJECTED", "WITHDRAWN", "NO_SHOW", "CANCELLED"].includes(String(s)) ? "bad" : ""}">${esc(statuses[String(s)] || s)}</span>`;
function toast(message: string, error = false) {
  const el = document.querySelector("#toast")!;
  el.textContent = message;
  el.className = "toast" + (error ? " error" : "");
  setTimeout(() => {
    el.textContent = "";
    el.className = "";
  }, 6000);
}
function fail(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  toast(message, true);
  return message;
}
async function rpc(action: string, payload: Row = {}): Promise<any> {
  const { data, error } = await db.rpc("recruitment_command", {
    p_action: action,
    p_payload: payload,
  });
  if (error)
    throw Error(
      error.message.includes("recruitment_command")
        ? "ยังไม่ได้ติดตั้งฐานข้อมูล V4 กรุณาให้เจ้าของรัน SQL ตาม INSTALL.md"
        : error.message,
    );
  return data;
}
function field(
  name: string,
  label: string,
  value: unknown = "",
  required = false,
  type = "text",
  extra = "",
) {
  return `<label>${label}${required ? '<span class="req">*</span>' : ""}<input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} ${extra}></label>`;
}
function select(
  name: string,
  label: string,
  options: string,
  required = false,
) {
  return `<label>${label}${required ? '<span class="req">*</span>' : ""}<select name="${name}" ${required ? "required" : ""}>${options}</select></label>`;
}
const dates = (
  name: string,
  label: string,
  value: unknown = "",
  required = false,
) =>
  field(
    name,
    label,
    value ? (date(value) === "—" ? "" : date(value)) : "",
    required,
    "text",
    'placeholder="dd/mm/yyyy" inputmode="numeric" data-date maxlength="10"',
  );
const note = (
  value: unknown = "",
  required = false,
  label = "บันทึก / เหตุผล",
) =>
  `<label class="full">${label}${required ? '<span class="req">*</span>' : ""}<textarea name="note" maxlength="5000" ${required ? "required" : ""}>${esc(value)}</textarea></label>`;
function dataOf(form: HTMLFormElement): Row {
  const d = Object.fromEntries(new FormData(form));
  for (const input of form.querySelectorAll<HTMLInputElement>("[data-date]"))
    d[input.name] = isoDate(String(d[input.name] || ""));
  return d;
}
function openModal(title: string, body: string, formId?: string) {
  modal.innerHTML = `${button("✕", "close-modal", "close")}<h2>${title}</h2>${formId ? `<form id="${formId}">${body}<div class="actions"><button class="primary" type="submit">บันทึก</button>${button("ยกเลิก", "close-modal")}</div><p class="error" data-error></p></form>` : body}`;
  modal.showModal();
}
function formError(form: HTMLFormElement, e: unknown) {
  const el = form.querySelector("[data-error]");
  if (el) el.textContent = fail(e);
  else fail(e);
}
function busy(form: HTMLFormElement, on: boolean) {
  form
    .querySelectorAll<HTMLButtonElement>("button[type=submit]")
    .forEach((b) => (b.disabled = on));
}
async function init() {
  try {
    const response = await fetch(
      configAddress(
        location.origin,
        import.meta.env.BASE_URL,
        import.meta.env.DEV,
      ),
    );
    const config = await response.json();
    if (!response.ok || !config.url || !config.key)
      throw Error(config.error || "ไม่พบการตั้งค่า Supabase");
    db = createClient(config.url, config.key, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    db.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        recovery = true;
        setTimeout(() => passwordPage(), 0);
      }
      if (event === "SIGNED_OUT") {
        generation++;
        profile = undefined as unknown as Profile;
        detail = null;
        screen = "dashboard";
        filters = { search: "", status: "", unit: "", offset: 0 };
        login();
      }
    });
    const {
      data: { session },
    } = await db.auth.getSession();
    if (location.hash === "#apply") {
      await publicPage();
      return;
    }
    if (location.hash.includes("type=recovery")) {
      recovery = true;
      passwordPage();
      return;
    }
    if (session) {
      await load();
    } else login();
  } catch (e) {
    root.innerHTML = `<main class="login card"><h1>ยังเปิดระบบไม่ได้</h1><p class="error">${esc(e instanceof Error ? e.message : e)}</p><p>ตรวจ Environment Variables และการติดตั้งฐานข้อมูล</p>${button("ลองใหม่", "reload")}</main>`;
  }
}
function login() {
  root.innerHTML = `<main class="login card"><div class="brand">Recruitment System<small>รับสมัคร • สัมภาษณ์ • ดูแลพนักงาน</small></div><h2>เข้าสู่ระบบ</h2><p class="muted">ใช้อีเมลที่ Admin เปิดสิทธิ์ให้แล้ว</p><form id="login">${field("email", "อีเมล", "", true, "email", 'autocomplete="username"')}${field("password", "รหัสผ่าน", "", true, "password", 'autocomplete="current-password"')}<button type="submit" class="primary">เข้าสู่ระบบ</button><p data-error class="error"></p></form><div class="actions">${button("ลืมรหัสผ่าน", "forgot")}${button("สมัครงานออนไลน์", "apply")}</div></main>`;
}
async function load() {
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) {
    login();
    return;
  }
  const snapshot = await rpc("snapshot");
  profile = snapshot.profile;
  units = snapshot.units;
  people = snapshot.people;
  topics = snapshot.topics;
  settings = snapshot.settings;
  await render();
}
function shell(body: string) {
  const nav = [
    ["dashboard", "ภาพรวม / งานที่ต้องทำ"],
    ["applicants", is("ADMIN", "HR", "MANAGER") ? "ผู้สมัคร" : "พนักงาน"],
    ...(is("ADMIN", "HR", "MANAGER") ? [["requests", "คำขอคน"]] : []),
    ["training", "การอบรม"],
    ["guide", "วิธีใช้งาน"],
    ...(is("ADMIN") ? [["admin", "ตั้งค่าระบบ"]] : []),
  ];
  root.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand">Recruitment<small>PEOPLE OPERATIONS · V4.1</small></div>${nav.map(([key, label]) => `<button type="button" data-nav="${key}" class="${screen === key ? "active" : ""}">${label}</button>`).join("")}<div class="bottom">${button("แบบฟอร์มสมัครงาน ↗", "apply")}<div class="profile">${esc(profile.display_name)}<small>${roles[profile.role]}</small></div><div class="actions">${button("รหัสผ่าน", "password")}${button("ออกจากระบบ", "logout")}</div></div></aside><main class="content">${body}</main></div>`;
}
function head(title: string, sub: string, actions = "") {
  return `<header class="topbar"><div><p class="section-label">Recruitment System</p><h1>${title}</h1><p class="muted" style="margin:8px 0 0">${sub}</p></div><div class="actions">${actions}${button("รีเฟรช", "refresh")}</div></header>`;
}
async function render() {
  const token = ++generation;
  detail = null;
  shell(head("กำลังโหลด", "") + '<div class="skeleton"></div>');
  try {
    let body = "";
    if (screen === "dashboard") body = await dashboard();
    if (screen === "applicants" || screen === "training")
      body = await applicantList();
    if (screen === "requests") body = await requestsPage();
    if (screen === "admin") body = await adminPage();
    if (screen === "guide") body = guide();
    if (token === generation) shell(body);
  } catch (e) {
    if (token === generation)
      shell(
        head("ไม่สามารถโหลดข้อมูล", "") +
          `<div class="card error">${esc(e instanceof Error ? e.message : e)}</div>`,
      );
  }
}
async function dashboard() {
  const d = await rpc("dashboard", { unit: filters.unit });
  const c = d.counts;
  const k = d.kpi14;
  const r = d.retention;
  return (
    head(
      "วันนี้ต้องทำอะไร",
      "เลือกงานจากรายการด้านล่าง ไม่จำเป็นต้องมีคำขอคนก่อนเริ่มรับสมัคร",
      is("ADMIN", "HR")
        ? button("+ เพิ่มผู้สมัคร", "new-applicant", "primary")
        : "",
    ) +
    `<div class="grid">${[
      ["รอ HR ตรวจ", (c.HR_REVIEW || 0) + (c.WAITING_INFO || 0), "HR_REVIEW"],
      ["รอสัมภาษณ์", c.INTERVIEW || 0, "INTERVIEW"],
      ["รอเริ่มงาน", c.HIRED || 0, "HIRED"],
      ["พนักงานเริ่มงานแล้ว", c.STARTED || 0, "STARTED"],
    ]
      .map(
        ([label, n, status]) =>
          `<div class="card stat"><small>${label}</small><strong>${n}</strong><button data-filter="${status}">เปิดรายการ →</button></div>`,
      )
      .join(
        "",
      )}</div><div class="split"><section class="card"><h2>เส้นทางรับคน</h2><div class="flow"><span>สมัครงาน</span>→<span>HR คัดกรอง</span>→<span>สัมภาษณ์</span>→<span>เริ่มงาน</span></div><p class="muted">หัวหน้างานยืนยันผล “ผ่าน” ถือว่ารับเข้าทำงานทันที ผลทดลองขับไม่บังคับ และ HR ผูกคำขอคนภายหลังได้</p>${is("ADMIN", "HR", "MANAGER") ? button("ดูผู้สมัครสำรอง", "reserves") : ""}</section><section class="card"><h2>ผู้เริ่มงานใน 90 วันล่าสุด</h2><small>นับวันเริ่มงานจริงตั้งแต่ ${date(retention([], today()).from)} ถึง ${date(today())}</small><strong style="display:block;font-size:32px;margin-top:12px">${r.rate === null ? "—" : r.rate + "%"}</strong><div class="progress"><i style="width:${Math.min(100, r.rate || 0)}%"></i></div><p>ยังทำงาน ${r.active} / เริ่มงาน ${r.total} คน · เป้าหมาย 90%</p><small>ผลอบรมเก็บแยก ไม่นำมาตัดสิน KPI นี้</small></section></div>${
      is("ADMIN", "HR", "MANAGER")
        ? `<section class="card"><h2>จัดหาคนขับภายใน 14 วัน</h2><div class="grid">${[
            ["อัตราคนขับ", k.total],
            ["รับผ่านแล้ว", k.filled],
            ["ทัน 14 วัน", k.on_time],
            ["ยังไม่ครบ / เกินกำหนด", k.overdue],
          ]
            .map(
              ([l, n]) =>
                `<div class="stat"><small>${l}</small><strong>${n}</strong></div>`,
            )
            .join(
              "",
            )}</div><p class="muted">เริ่มนับเมื่อ HR รับเรื่อง จบเมื่อหัวหน้างานยืนยันผ่าน นับคนขับ 1 คน = 1 อัตรา เด็กติดรถแยกติดตามและไม่นับ KPI นี้</p>${button("ดูคำขอคน", "requests")}</section>`
        : ""
    }`
  );
}
async function applicantList() {
  const training = screen === "training";
  const f = { ...filters, ...(training ? { status: "STARTED" } : {}) };
  const list = await rpc("applicants", f);
  return (
    head(
      training ? "การอบรมพนักงาน" : "รายการผู้สมัคร",
      training
        ? "เปิดพนักงานเพื่อดูหรือบันทึกผลอบรมตามสิทธิ์"
        : "ค้นหา → เปิดรายการ → ทำขั้นตอนถัดไป",
      is("ADMIN", "HR") && !training
        ? button("+ เพิ่มผู้สมัคร", "new-applicant", "primary")
        : "",
    ) +
    `<section class="card"><form id="filters" class="toolbar">${field("search", "ชื่อหรือโทรศัพท์", filters.search)}${select("unit", "หน่วยงาน", unitOpts(filters.unit).replace("เลือก…", "ทุกหน่วยงาน"))}${
      !training
        ? select(
            "status",
            "สถานะ",
            opts(
              Object.entries(statuses).map(([value, label]) => ({
                value,
                label,
              })),
              filters.status,
              "ทุกสถานะ",
            ),
          )
        : ""
    }<button type="submit">ค้นหา</button></form><div class="table-wrap"><table><thead><tr><th>ชื่อผู้สมัคร</th><th>ตำแหน่ง / หน่วยงาน</th><th>สถานะ</th><th>วันที่สมัคร</th><th>ผู้สัมภาษณ์</th><th></th></tr></thead><tbody>${list.rows.map((a: Applicant) => `<tr><td><b>${esc(a.full_name)}</b><br><small>${esc(a.phone)}</small></td><td>${position(a.position)}<br><small>${esc(a.hiring_unit)}</small></td><td>${badge(a.status)}</td><td>${date(a.created_at)}</td><td>${esc(person(a.owner_id))}</td><td><button data-open="${a.id}">เปิดรายการ →</button></td></tr>`).join("")}</tbody></table>${!list.rows.length ? '<div class="empty">ยังไม่มีรายการในเงื่อนไขนี้</div>' : ""}</div><div class="pagination"><small>ทั้งหมด ${list.total} รายการ · หน้า ${Math.floor(filters.offset / 30) + 1}</small><div class="actions"><button data-page="-1" ${filters.offset === 0 ? "disabled" : ""}>ก่อนหน้า</button><button data-page="1" ${filters.offset + 30 >= list.total ? "disabled" : ""}>ถัดไป</button></div></div></section>`
  );
}
function profileFields(a?: Applicant) {
  const d = a?.data || {};
  return `<div class="fields">${field("full_name", "ชื่อ – สกุล", a?.full_name || "", true, "text", 'maxlength="120"')}${select(
    "position",
    "ตำแหน่ง",
    opts(
      [
        { value: "DRIVER", label: "พนักงานขับรถ" },
        { value: "HELPER", label: "เด็กติดรถ" },
      ],
      a?.position || "DRIVER",
    ),
    true,
  )}${select("unit", a ? "หน่วยงานที่รับจริง" : "หน่วยงานที่สมัคร", unitOpts(a?.hiring_unit), true)}${field("phone", "เบอร์โทร", a?.phone || "", true, "tel", 'maxlength="20" pattern="[0-9+ \\-]{8,20}"')}${dates("birth_date", "วันเกิด (ค.ศ.)", d.birth_date, true)}${field("national_id", "เลขบัตรประชาชน", d.national_id, true, "text", 'inputmode="numeric" pattern="[0-9]{13}" maxlength="13"')}${field("prefix", "คำนำหน้า", d.prefix)}${select(
    "gender",
    "เพศ",
    opts(
      ["ชาย", "หญิง", "ไม่ประสงค์ระบุ", "อื่นๆ"].map((x) => ({
        value: x,
        label: x,
      })),
      d.gender,
    ),
  )}${field("line_id", "LINE ID", d.line_id)}${select(
    "current_job_status",
    "สถานะงานปัจจุบัน",
    opts(
      ["ว่างงาน", "ทำงานอยู่", "อื่นๆ"].map((x) => ({ value: x, label: x })),
      d.current_job_status,
    ),
  )}${dates("available_start_date", "วันที่พร้อมเริ่มงาน", d.available_start_date)}${field("availability_note", "หมายเหตุความพร้อม", d.availability_note)}${dates("id_issued_at", "วันออกบัตรประชาชน", d.id_issued_at)}${dates("id_expires_at", "วันหมดอายุบัตรประชาชน", d.id_expires_at)}<div class="full notice">ข้อมูลรถและใบขับขี่บังคับเฉพาะพนักงานขับรถ · ระบบเชื้อเพลิงกรอกตอนสัมภาษณ์</div>${select(
    "vehicle_type",
    "ประเภทรถ",
    opts(
      ["เทรเลอร์", "4W", "6W", "10W"].map((x) => ({ value: x, label: x })),
      d.vehicle_type,
    ),
  )}${select(
    "license_type",
    "ประเภทใบขับขี่",
    opts(
      ["ท.1", "ท.2", "ท.3", "ท.4", "ส่วนบุคคล"].map((x) => ({
        value: x,
        label: x,
      })),
      d.license_type,
    ),
  )}${field("driver_license_no", "เลขใบขับขี่", d.driver_license_no)}${dates("license_issued_at", "วันออกใบขับขี่", d.license_issued_at)}${dates("license_expires_at", "วันหมดอายุใบขับขี่", d.license_expires_at)}${field("cargo_types", "สินค้าที่เคยขน", d.cargo_types)}${field("construction_brands", "วัสดุก่อสร้าง: สินค้า / ยี่ห้อ", d.construction_brands)}${field("beverage_brands", "น้ำ / โซดา / เบียร์: สินค้า / ยี่ห้อ", d.beverage_brands)}${field("other_cargo_note", "งานขนส่งอื่น", d.other_cargo_note)}${a ? note("", false, "เหตุผลแก้ไข (บังคับเมื่อเปลี่ยนหน่วยงาน)") : ""}</div>`;
}
function applicantPayload(form: HTMLFormElement) {
  const raw = dataOf(form);
  const { full_name, phone, unit, position, note, ...data } = raw;
  return { full_name, phone, unit, position, note, data };
}
function applyDriverRequirements() {
  const form =
    document.querySelector<HTMLFormElement>("#new-applicant,#public-apply") ||
    modal.querySelector<HTMLFormElement>("#edit-applicant");
  if (!form) return;
  const driver =
    (form.elements.namedItem("position") as HTMLSelectElement).value ===
    "DRIVER";
  for (const name of ["vehicle_type", "license_type", "driver_license_no"]) {
    const input = form.elements.namedItem(name) as HTMLInputElement;
    input.required = driver;
    const label = input.closest("label")!;
    label.querySelector(".req")?.remove();
    if (driver) {
      const mark = document.createElement("span");
      mark.className = "req";
      mark.textContent = "*";
      label.insertBefore(mark, input);
    }
  }
  if (form.id === "edit-applicant")
    (form.elements.namedItem("position") as HTMLSelectElement).disabled = true;
}
async function publicPage() {
  const { data: info, error } = await db.rpc("recruitment_public_info");
  if (error) throw Error("ยังไม่ได้ติดตั้งฐานข้อมูลการสมัคร");
  units = info.units;
  root.innerHTML = `<main class="public-form">${button("← กลับเข้าสู่ระบบ", "login")}<section class="card" style="margin-top:20px"><p class="section-label">Join our team</p><h1>สมัครงานกับเรา</h1>${info.open ? `<p class="muted">กรอกข้อมูลเพื่อให้ HR ติดต่อกลับ ช่อง * จำเป็นต้องกรอก · วันที่ใช้ ค.ศ.</p><form id="public-apply">${profileFields()}<label class="check"><input type="checkbox" name="consent" required> ยินยอมให้ใช้ข้อมูลนี้เพื่อการสรรหาและติดต่อกลับ</label><p class="muted">เฟสนี้รับเฉพาะข้อมูลใบสมัคร ยังไม่ต้องแนบไฟล์หรือเอกสาร ระบบไม่เปิดเผยใบสมัครต่อสาธารณะ</p><button class="primary" type="submit">ส่งใบสมัคร</button><p class="error" data-error></p></form>` : '<div class="notice">ขณะนี้ยังไม่เปิดรับสมัครออนไลน์ กรุณาติดต่อ HR</div>'}</section></main>`;
  applyDriverRequirements();
}
async function openApplicant(id: string) {
  const token = ++generation;
  const d = await rpc("detail", { id });
  if (token !== generation) return;
  detail = d;
  const a = d.applicant as Applicant;
  const manage = is("ADMIN", "HR");
  const ownManager = is("MANAGER") && profile.units.includes(a.hiring_unit);
  const owner = ownManager && a.owner_id === profile.id;
  const hired = ["HIRED", "STARTED"].includes(a.status);
  const evals = d.evaluations as Row[];
  const current = evals.find((e) => e.round === a.round);
  const canHandover = (manage || ownManager || is("DISPATCH_MANAGER")) && hired;
  const actions = [
    manage ? button("แก้ข้อมูล / หน่วยงาน", "edit-applicant") : "",
    manage ? button("บันทึกติดต่อ", "contact") : "",
    manage &&
    !["STARTED", "RESERVE", "WITHDRAWN", "CANCELLED", "NO_SHOW"].includes(
      a.status,
    )
      ? button("สำรอง", "reserve")
      : "",
    manage && a.status === "RESERVE"
      ? button("เรียกกลับ", "recall", "primary")
      : "",
    manage && a.status !== "STARTED"
      ? button("ปิดเคส", "close-case", "danger")
      : "",
  ].join("");
  const values: Record<string, string> = {
    prefix: "คำนำหน้า",
    gender: "เพศ",
    birth_date: "วันเกิด",
    national_id: "เลขบัตรประชาชน",
    id_issued_at: "วันออกบัตร",
    id_expires_at: "บัตรหมดอายุ",
    line_id: "LINE ID",
    vehicle_type: "ประเภทรถ",
    license_type: "ประเภทใบขับขี่",
    driver_license_no: "เลขใบขับขี่",
    license_issued_at: "วันออกใบขับขี่",
    license_expires_at: "ใบขับขี่หมดอายุ",
    cargo_types: "สินค้าที่เคยขน",
    construction_brands: "วัสดุก่อสร้าง / ยี่ห้อ",
    beverage_brands: "เครื่องดื่ม / ยี่ห้อ",
    other_cargo_note: "ขนส่งอื่น",
    current_job_status: "งานปัจจุบัน",
    available_start_date: "พร้อมเริ่มงาน",
    availability_note: "ความพร้อม",
  };
  let body =
    head(
      a.full_name,
      `${position(a.position)} · ${a.hiring_unit}`,
      button("← กลับรายการ", "back"),
    ) +
    `<section class="card"><div class="detail-head"><div>${badge(a.status)}<p class="muted" style="margin-top:10px">สมัคร ${date(a.created_at)} · รอบสัมภาษณ์ ${a.round + 1}</p></div><div class="actions">${actions}</div></div><div class="keyvals"><div><small>หน่วยงานที่สมัครเดิม</small>${esc(a.original_unit)}</div><div><small>เบอร์โทร</small>${esc(a.phone)}</div><div><small>ผู้สัมภาษณ์</small>${esc(person(a.owner_id))}</div><div><small>คำขอที่ผูก</small>${a.slot_id ? "ผูกคำขอแล้ว" : "ยังไม่ผูก — ดำเนินการรับสมัครได้ตามปกติ"}</div></div>${manage ? `<div class="actions" style="margin-top:18px">${button("ผูก / ปลดคำขอคน", "match")}</div>` : ""}</section>`;
  if (d.duplicates.length)
    body += `<div class="notice warn">พบใบสมัครที่อาจซ้ำ ${d.duplicates.map((x: Row) => esc(x.full_name) + " (" + esc(statuses[x.status]) + ")").join(", ")} กรุณาตรวจสอบและบันทึกเหตุผลก่อนส่งสัมภาษณ์</div>`;
  body += `<div class="split"><div>${
    manage &&
    ["HR_REVIEW", "WAITING_INFO", "INTERVIEW"].includes(a.status) &&
    !a.owner_id
      ? `<section class="card"><h2>ขั้นตอนถัดไป: HR คัดกรอง</h2><form id="screen"><div class="fields">${select(
          "result",
          "ผลคัดกรอง",
          opts(
            [
              { value: "FORWARD", label: "ส่งสัมภาษณ์" },
              { value: "MORE_INFO", label: "ขอข้อมูลเพิ่ม" },
              { value: "REJECT", label: "ไม่ผ่าน" },
            ],
            "FORWARD",
          ),
          true,
        )}${dates("followup_date", "วันติดตาม (บังคับเมื่อขอข้อมูลเพิ่ม)", a.data.followup_date)}${note(a.data.screen_note)}${field("age_note", "เหตุผลยกเว้นอายุ (คนขับต่ำกว่า 25 / เด็กติดรถต่ำกว่า 18 ปี)", a.data.age_note)}${field("duplicate_note", "เหตุผลยืนยันใบสมัครซ้ำ", a.data.duplicate_note, !!d.duplicates.length)}</div><button type="submit" class="primary">บันทึกผลคัดกรอง</button><p class="error" data-error></p></form></section>`
      : ""
  }`;
  if (a.status === "INTERVIEW")
    body += `<section class="card"><h2>สัมภาษณ์และรับเข้าทำงาน</h2>${ownManager && !a.owner_id ? button("รับงานสัมภาษณ์", "claim", "primary") : ""}${(owner || manage) && a.owner_id ? button("คืนงานสัมภาษณ์", "release-interview") : ""}${
      owner
        ? `<form id="interview" style="margin-top:20px"><div class="fields">${select(
            "score",
            "คะแนน",
            opts(
              [1, 2, 3, 4, 5].map((x) => ({
                value: String(x),
                label: String(x),
              })),
              String(current?.score || ""),
            ),
            true,
          )}${select(
            "result",
            "ผลสัมภาษณ์",
            opts(
              [
                { value: "PASS", label: "ผ่าน — ยืนยันรับเข้าทำงาน" },
                { value: "FAIL", label: "ไม่ผ่าน" },
              ],
              current?.result,
            ),
            true,
          )}${
            a.position === "DRIVER"
              ? select(
                  "road_result",
                  "ผลทดลองขับ (ไม่บังคับ)",
                  opts(
                    [
                      { value: "PASS", label: "ผ่าน" },
                      { value: "FAIL", label: "ไม่ผ่าน" },
                    ],
                    current?.road_result,
                    "ไม่ได้ทดสอบ",
                  ),
                )
              : ""
          }${
            a.position === "DRIVER"
              ? select(
                  "fuel",
                  "ระบบเชื้อเพลิงที่ถนัด",
                  opts(
                    ["น้ำมัน", "แก๊ส", "น้ำมันและแก๊ส"].map((x) => ({
                      value: x,
                      label: x,
                    })),
                    current?.fuel,
                  ),
                )
              : ""
          }${note(current?.note)}</div><div class="actions"><button type="submit" name="mode" value="draft" formnovalidate>เก็บแบบร่าง</button><button type="submit" name="mode" value="submit" class="primary">ยืนยันผลสัมภาษณ์</button></div><p class="hint">ยืนยันผ่านแล้วรับเข้าทำงานทันที ไม่ต้องรอ HR ยืนยันซ้ำ</p><p class="error" data-error></p></form>`
        : `<p class="muted" style="margin-top:15px">${a.owner_id ? "ผู้รับงาน: " + esc(person(a.owner_id)) : "รอหัวหน้างานในหน่วยงานนี้รับงาน"}</p>`
    }</section>`;
  if (canHandover)
    body += `<section class="card"><h2>ส่งมอบพนักงาน</h2><form id="handover"><div class="fields">${select("coach_id", "Driver Coach", peopleOpts("COACH", a.coach_id))}${select("supervisor_id", "หัวหน้างานผู้ดูแล", peopleOpts("MANAGER", a.supervisor_id, a.hiring_unit))}${field("plate", "ทะเบียนรถ", a.data.plate)}${select(
      "fleet_type",
      "ประเภทรถ",
      opts(
        [
          { value: "COMPANY", label: "รถบริษัท" },
          { value: "PARTNER", label: "รถร่วม" },
        ],
        a.data.fleet_type,
      ),
    )}${note()}</div><button type="submit" class="primary">บันทึกผู้ดูแล</button><p class="error" data-error></p></form></section><section class="card"><h2>เริ่มงาน / สถานะพนักงาน</h2><form id="employment"><div class="fields">${dates("scheduled_start_date", "กำหนดเริ่มงาน", a.scheduled_start_date)}${dates("actual_start_date", "วันเริ่มงานจริง", a.actual_start_date)}${dates("resignation_date", "วันลาออก", a.resignation_date)}${note("", false, "หมายเหตุ (บังคับเมื่อลาออก)")}</div><button type="submit" class="primary">บันทึกการทำงาน</button><p class="error" data-error></p></form></section>`;
  if (a.status === "STARTED") {
    const allowed = topics.filter(
      (t) =>
        (!t.unit || t.unit === a.hiring_unit) &&
        (!t.position || t.position === a.position) &&
        canTrain(profile.role, profile.units, a, profile.id, t.category),
    );
    body += `<section class="card"><h2>การอบรม</h2>${
      allowed.length
        ? `<form id="training"><div class="fields">${select("topic_id", "หัวข้อ", opts(allowed.map((t) => ({ value: t.id, label: categories[t.category] + " · " + t.title }))), true)}${dates("training_date", "วันที่อบรม", today(), true)}${select(
            "result",
            "ผล",
            opts([
              { value: "PASS", label: "ผ่าน" },
              { value: "FAIL", label: "ไม่ผ่าน" },
            ]),
            true,
          )}${note()}</div><button type="submit" class="primary">บันทึกอบรม</button><p class="error" data-error></p></form>`
        : '<p class="muted">ยังไม่มีหัวข้อที่คุณบันทึกได้ หรือคุณไม่ได้รับมอบหมายให้ดูแลพนักงานนี้</p>'
    }${button("+ เพิ่มหัวข้ออบรม", "new-topic")}<div class="table-wrap"><table><thead><tr><th>หัวข้อ</th><th>วันที่</th><th>ผล</th><th></th></tr></thead><tbody>${d.training.map((tr: Row) => `<tr><td>${esc(tr.title)}<br><small>${categories[tr.category]} · ${esc(tr.note)}</small></td><td>${date(tr.training_date)}</td><td>${tr.result === "PASS" ? "ผ่าน" : "ไม่ผ่าน"}</td><td>${canTrain(profile.role, profile.units, a, profile.id, tr.category) ? `<button data-training="${tr.id}">แก้ไข</button>` : ""}</td></tr>`).join("")}</tbody></table></div></section>`;
  }
  body += `<section class="card"><h2>ประวัติการดำเนินการ</h2>${d.activities.map((e: Row) => `<div class="timeline"><small>${date(e.created_at)} · ${esc(e.display_name || "ผู้สมัคร")}</small><p><b>${esc(actionLabel(e.action))}</b></p><p>${esc(e.note)}</p></div>`).join("")}</section></div><div><section class="card"><h2>ข้อมูลผู้สมัคร</h2><div class="keyvals">${Object.entries(
    values,
  )
    .filter(([key]) => a.data[key])
    .map(
      ([key, label]) =>
        `<div><small>${label}</small>${key.includes("date") || key.endsWith("_at") ? date(a.data[key]) : esc(a.data[key])}</div>`,
    )
    .join(
      "",
    )}</div></section>${hired ? `<section class="card"><h2>ข้อมูลดูแลพนักงาน</h2><div class="keyvals"><div><small>Coach</small>${esc(person(a.coach_id))}</div><div><small>หัวหน้างาน</small>${esc(person(a.supervisor_id))}</div><div><small>ทะเบียน / รถ</small>${esc(a.data.plate || "—")} / ${fleet(a.data.fleet_type)}</div><div><small>เริ่มงานจริง</small>${date(a.actual_start_date)}</div><div><small>สถานะงาน</small>${a.employment_status === "RESIGNED" ? "ลาออก" : a.employment_status === "ACTIVE" ? "ทำงานอยู่" : "รอเริ่มงาน"}</div><div><small>ลาออก</small>${date(a.resignation_date)}</div></div></section>` : ""}${evals.length ? `<section class="card"><h2>ประวัติสัมภาษณ์</h2>${evals.map((e) => `<div class="slot"><b>รอบ ${e.round + 1} · ${e.stage === "DRAFT" ? "แบบร่าง" : e.result === "PASS" ? "ผ่าน" : "ไม่ผ่าน"}</b><p>คะแนน ${e.score || "—"} · ทดลองขับ ${e.road_result || "ไม่ได้ทดสอบ"}</p><p>เชื้อเพลิง ${esc(e.fuel || "—")}</p><p>${esc(e.note)}</p><small>${esc(person(e.evaluator_id))} · ${date(e.updated_at)}</small></div>`).join("")}</section>` : ""}${attachmentsEnabled && is("ADMIN", "HR", "MANAGER") ? `<section class="card"><h2>เอกสารประกอบ</h2><p class="muted">PDF / JPG / PNG ไม่เกิน 5 MB ต่อไฟล์ เก็บในพื้นที่ส่วนตัว</p>${manage || ownManager ? '<form id="upload"><label>เลือกเอกสาร<span class="req">*</span><input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required></label><button type="submit" style="margin-top:12px">อัปโหลดเอกสาร</button><p class="error" data-error></p></form>' : ""}${d.documents.map((doc: Row) => `<p><button data-document="${doc.id}">${esc(doc.title)} ↗</button></p>`).join("")}</section>` : ""}</div></div>`;
  shell(body);
  dynamicRequirements();
}
function actionLabel(a: string) {
  return (
    (
      {
        APPLIED: "รับใบสมัคร",
        SCREEN: "คัดกรอง HR",
        CLAIM: "รับงานสัมภาษณ์",
        RELEASE_INTERVIEW: "คืนคิวสัมภาษณ์",
        INTERVIEW: "บันทึกผลสัมภาษณ์",
        MATCH: "เปลี่ยนการผูกคำขอ",
        EDIT_APPLICANT: "แก้ไขข้อมูล / หน่วยงาน",
        RESERVE: "เก็บเป็นผู้สมัครสำรอง",
        RECALL: "เรียกผู้สมัครกลับ",
        HANDOVER: "ส่งมอบผู้ดูแล",
        EMPLOYMENT: "ปรับสถานะการทำงาน",
        TRAINING: "บันทึกอบรม",
        CONTACT: "บันทึกการติดต่อ",
        CLOSE: "ปิดเคส",
        DOCUMENT: "แนบเอกสาร",
      } as Record<string, string>
    )[a] || a
  );
}
function dynamicRequirements() {
  const form = document.querySelector<HTMLFormElement>("#screen");
  if (form) {
    const value = (form.elements.namedItem("result") as HTMLSelectElement)
      .value;
    for (const name of ["followup_date", "note", "age_note"]) {
      const input = form.elements.namedItem(name) as HTMLInputElement;
      const required =
        name === "followup_date"
          ? value === "MORE_INFO"
          : name === "age_note"
            ? value === "FORWARD" &&
              requiresAgeApproval(
                detail!.applicant.position,
                detail!.applicant.data.birth_date,
              )
            : value !== "FORWARD";
      input.required = required;
      const label = input.closest("label")!;
      label.querySelector(".req")?.remove();
      if (required) {
        const star = document.createElement("span");
        star.className = "req";
        star.textContent = "*";
        label.insertBefore(star, input);
      }
    }
  }
}
async function requestsPage() {
  const rows = (await rpc("requests")) as Row[];
  return (
    head(
      "คำขอคน",
      "ขอได้หลายทะเบียนพร้อมกัน · HR รับเรื่องแล้วเริ่มจับเวลา 14 วัน",
      button("+ แจ้งขอคน", "new-request", "primary"),
    ) +
    rows
      .map(
        (r) =>
          `<section class="card"><div class="detail-head"><div><h2>${esc(r.title)}</h2><p class="muted">${esc(r.unit)} · ขอ ${date(r.created_at)} โดย ${esc(person(r.created_by))}</p></div><div>${r.received_at ? `<span class="badge">HR รับ ${date(r.received_at)}</span>` : is("ADMIN", "HR") ? `<button data-receive="${r.id}" data-version="${r.version}" class="primary">รับเรื่อง</button>` : '<span class="badge warn">รอ HR รับเรื่อง</span>'}</div></div><p>${esc(r.notes)}</p><div class="table-wrap"><table><thead><tr><th>ทะเบียน</th><th>รถ</th><th>ตำแหน่ง</th><th>สถานะ</th><th>ยืนยันรับคน</th><th></th></tr></thead><tbody>${r.slots.map((s: Row) => `<tr><td>${esc(s.plate)}</td><td>${fleet(s.fleet_type)}</td><td>${position(s.position)}</td><td>${({ OPEN: "ว่าง", MATCHED: "ผูกผู้สมัคร", FILLED: "รับผ่านแล้ว", CANCELLED: "ยกเลิก" } as Record<string, string>)[s.status]}</td><td>${date(s.filled_at)}</td><td>${s.applicant_id ? `<button data-open="${s.applicant_id}">ดูผู้สมัคร</button>` : is("ADMIN", "HR") && s.status === "OPEN" ? `<button data-cancel-slot="${s.id}" data-version="${s.version}" class="danger">ยกเลิกอัตรา</button>` : ""}</td></tr>`).join("")}</tbody></table></div></section>`,
      )
      .join("") +
    (!rows.length
      ? '<div class="card empty">ยังไม่มีคำขอคน · รับผู้สมัครได้โดยไม่ต้องรอคำขอ</div>'
      : "")
  );
}
async function adminPage() {
  if (!is("ADMIN")) throw Error("ไม่มีสิทธิ์");
  const profiles = (await rpc("profiles")) as Profile[];
  const events = (await rpc("activities")) as Row[];
  const links = Object.entries({
    sheet_url: "Google Sheet เดิม",
    drive_url: "Google Drive เดิม",
    form_url: "Google Form เดิม",
  })
    .map(([key, label]) => {
      const href = settings[key];
      return typeof href === "string" && href.startsWith("https://")
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="button">${label} ↗</a>`
        : "";
    })
    .join("");
  return (
    head(
      "ตั้งค่าระบบ",
      "สิทธิ์จะตรวจจากฐานข้อมูลทุกครั้ง การเปลี่ยนบทบาทมีผลกับคำสั่งถัดไปทันที",
    ) +
    `<section class="card"><h2>ผู้ใช้งาน</h2><p class="muted">สร้างบัญชีที่ Supabase → Authentication → Users ก่อน แล้วเพิ่มสิทธิ์ที่นี่ ไม่มีการเก็บรหัสผ่านในตารางระบบ</p>${button("+ เพิ่มสิทธิ์ผู้ใช้", "new-profile", "primary")}<div class="table-wrap"><table><thead><tr><th>ชื่อ / อีเมล</th><th>บทบาท</th><th>หน่วยงาน</th><th>สถานะ</th><th></th></tr></thead><tbody>${profiles.map((p) => `<tr><td>${esc(p.display_name)}<br><small>${esc(p.email)}</small></td><td>${roles[p.role]}</td><td>${esc(p.units.join(", ") || "ทุกหน่วยงานตามบทบาท")}</td><td>${p.active ? "เปิด" : "ปิด"}</td><td><button data-profile="${p.id}">แก้ไข</button><script type="application/json" id="profile-${p.id}">${JSON.stringify(p).replace(/</g, "\\u003c")}</script></td></tr>`).join("")}</tbody></table></div></section><div class="split"><section class="card"><h2>การรับสมัครและลิงก์หลังบ้าน</h2><div class="actions" style="margin-bottom:18px">${links}</div><form id="settings"><div class="fields full">${select(
      "public_apply",
      "เปิดสมัครออนไลน์",
      opts(
        [
          { value: "false", label: "ปิดรับสมัคร" },
          { value: "true", label: "เปิดรับสมัคร" },
        ],
        String(settings.public_apply || false),
      ),
      true,
    )}${field("form_url", "Google Form เดิม", settings.form_url, false, "url")}${field("sheet_url", "Google Sheet เดิม", settings.sheet_url, false, "url")}${field("drive_url", "Google Drive เดิม", settings.drive_url, false, "url")}</div><div class="notice">แบบสมัครใหม่บันทึกเข้า Supabase โดยตรง ส่วนลิงก์ Google เดิมใช้เปิดตรวจข้อมูล ไม่ได้ซิงก์เข้าระบบใหม่อัตโนมัติ</div><button type="submit" class="primary">บันทึกตั้งค่า</button><p class="error" data-error></p></form></section><section class="card"><h2>หน่วยงาน</h2><div class="actions">${units.map((x) => `<span class="badge">${esc(x)}</span>`).join("")}</div><form id="unit" style="margin-top:20px">${field("name", "ชื่อหน่วยงานใหม่", "", true, "text", 'maxlength="120"')}<button type="submit" style="margin-top:12px">เพิ่มหน่วยงาน</button><p class="error" data-error></p></form><h2 style="margin-top:30px">หัวข้ออบรม</h2>${button("+ เพิ่มหัวข้ออบรม", "new-topic")}<p class="muted">หัวข้อแยกตำแหน่ง หน่วยงาน และประเภทผู้สอน</p><hr><h2>รีเซ็ตข้อมูลทดลอง</h2><p class="muted">ล้างใบสมัคร คำขอ ผลสัมภาษณ์ ผลอบรมและประวัติ คงบัญชี หน่วยงาน หัวข้ออบรมและตั้งค่าไว้ ต้องไม่มีเอกสารแนบ</p><div class="actions">${button("ดาวน์โหลดสำรองข้อมูล", "backup")}${button("ตรวจรายการก่อนรีเซ็ต", "reset-preview", "danger")}</div></section></div><section class="card"><h2>ประวัติระบบล่าสุด</h2><div class="table-wrap"><table><thead><tr><th>วันที่</th><th>ผู้ดำเนินการ</th><th>รายการ</th><th>บันทึก</th></tr></thead><tbody>${events.map((e) => `<tr><td>${date(e.created_at)}</td><td>${esc(e.display_name || "ผู้สมัคร")}</td><td>${esc(actionLabel(e.action))}</td><td>${esc(e.note)}</td></tr>`).join("")}</tbody></table></div></section>`
  );
}
function guide() {
  return (
    head(
      "วิธีใช้งาน",
      "เริ่มจากงานที่ต้องทำในภาพรวม แล้วเปิดรายการเพียงครั้งเดียว",
    ) +
    `<section class="card"><h2>โฟลวหลัก</h2><div class="flow"><span>กรอกใบสมัคร</span>→<span>HR ตรวจ</span>→<span>หัวหน้างานรับสัมภาษณ์</span>→<span>ยืนยันผ่าน = รับงาน</span>→<span>ส่งมอบ / เริ่มงานจริง</span>→<span>ติดตามอบรม</span></div><p>ถ้ายังไม่มีคำขอคน HR ดำเนินการได้ตามปกติ หากมีคำขอสามารถผูกอัตราที่หน่วยงานและตำแหน่งตรงกันได้</p><p>หากยังไม่พร้อมรับ ให้ HR เก็บเป็นผู้สมัครสำรอง เมื่อเรียกกลับเลือกใช้ผลเดิมเป็นแบบร่างหรือสัมภาษณ์ใหม่ได้ โดยหัวหน้างานยืนยันรอบใหม่</p></section><section class="card"><h2>ใครทำอะไร</h2><div class="table-wrap"><table><thead><tr><th>บทบาท</th><th>งานหลัก</th><th>ขอบเขตแก้ไข</th></tr></thead><tbody><tr><td>Admin</td><td>ตั้งค่าและจัดสิทธิ์ / ดูแลข้อมูล</td><td>ทุกหน่วยงาน ยกเว้นยืนยันสัมภาษณ์แทนหัวหน้างาน</td></tr><tr><td>HR</td><td>ตรวจใบสมัคร ติดต่อ ผูกคำขอ สำรอง เรียกกลับ</td><td>ทุกหน่วยงาน</td></tr><tr><td>หัวหน้างาน</td><td>ขอคน รับสัมภาษณ์ ยืนยันรับ ส่งมอบ / อบรม</td><td>เฉพาะหน่วยงานที่รับผิดชอบ</td></tr><tr><td>Driver Coach</td><td>บันทึกอบรมประเภท Coach</td><td>เฉพาะพนักงานที่มอบหมายให้ตนเอง</td></tr><tr><td>Safety / Driver Trainer</td><td>บันทึกอบรมประเภทตนเอง</td><td>ทุกหน่วยงาน</td></tr><tr><td>ผู้จัดการจัดส่ง</td><td>ส่งมอบและบันทึกอบรม</td><td>ทุกหน่วยงาน</td></tr></tbody></table></div><p class="muted">Coach, Safety, Trainer และผู้จัดการจัดส่งเห็นพนักงานที่รับแล้วทุกคน แต่แก้ได้ตามสิทธิ์ข้างต้น</p></section><section class="card"><h2>สิ่งที่ควรทราบ</h2><p>วันที่กรอกและแสดงใช้ dd/mm/yyyy (ค.ศ.) · * สีแดงคือช่องบังคับ · ผลทดลองขับไม่บังคับ · ระบบเชื้อเพลิงกรอกตอนสัมภาษณ์</p><p>เปลี่ยนหน่วยงาน: เก็บหน่วยงานสมัครเดิมไว้ ปลดคำขอเดิมอัตโนมัติ และให้หน่วยงานใหม่รับสัมภาษณ์ใหม่ถ้ายังไม่ยืนยันรับงาน</p><p>KPI 14 วันนับเฉพาะอัตราคนขับ ตั้งแต่ HR รับคำขอถึงยืนยันผ่าน · KPI 90 วันนับผู้เริ่มงานใน 90 วันล่าสุดที่ยังทำงาน เป้าหมาย 90% ไม่รวมผลอบรม</p><p>หากขึ้น “ข้อมูลเปลี่ยนแล้ว” ให้เปิดรายการใหม่ ข้อมูลจากผู้ใช้อื่นจะไม่ถูกเขียนทับ</p></section>`
  );
}
function passwordPage() {
  root.innerHTML = `<main class="login card"><h1>ตั้งรหัสผ่านใหม่</h1><form id="password">${field("password", "รหัสผ่านใหม่ (อย่างน้อย 12 ตัว)", "", true, "password", 'minlength="12" autocomplete="new-password"')}${field("confirm", "ยืนยันรหัสผ่าน", "", true, "password", 'minlength="12" autocomplete="new-password"')}<button type="submit" class="primary">บันทึกรหัสผ่าน</button><p class="error" data-error></p></form></main>`;
}
function profileModal(p?: Profile) {
  openModal(
    p ? "แก้ไขสิทธิ์ผู้ใช้" : "เพิ่มสิทธิ์ผู้ใช้",
    `<div class="fields">${field("email", "อีเมล Supabase Auth", p?.email || "", true, "email", p ? "readonly" : "")}${field("display_name", "ชื่อแสดง", p?.display_name || "", true)}${select(
      "role",
      "บทบาท",
      opts(
        Object.entries(roles).map(([value, label]) => ({ value, label })),
        p?.role || "HR",
      ),
      true,
    )}${select(
      "active",
      "สถานะ",
      opts(
        [
          { value: "true", label: "เปิด" },
          { value: "false", label: "ปิด" },
        ],
        String(p?.active ?? true),
      ),
      true,
    )}<label class="full">หน่วยงานที่รับผิดชอบ (บังคับสำหรับหัวหน้างาน)<select name="units" multiple size="4">${units.map((x) => `<option value="${esc(x)}" ${p?.units.includes(x) ? "selected" : ""}>${esc(x)}</option>`).join("")}</select><small>เลือกหลายรายการด้วย Cmd / Ctrl</small></label><input type="hidden" name="version" value="${p?.version || 0}"></div>`,
    "profile",
  );
}
function topicModal() {
  const cat =
    profile.role === "COACH"
      ? "COACH"
      : ["SAFETY", "DRIVER_TRAINER"].includes(profile.role)
        ? profile.role
        : "GENERAL";
  openModal(
    "เพิ่มหัวข้ออบรม",
    `<div class="fields">${field("title", "หัวข้อ", "", true, "text", 'maxlength="200"')}${select(
      "category",
      "ประเภท",
      opts(
        Object.entries(categories)
          .filter(
            ([key]) => !is("COACH", "SAFETY", "DRIVER_TRAINER") || key === cat,
          )
          .map(([value, label]) => ({ value, label })),
        cat,
      ),
      true,
    )}${select(
      "position",
      "ตำแหน่ง",
      opts(
        [
          { value: "DRIVER", label: "พนักงานขับรถ" },
          { value: "HELPER", label: "เด็กติดรถ" },
        ],
        "",
        "ทุกตำแหน่ง",
      ),
    )}${select("unit", "หน่วยงาน", unitOpts("", is("MANAGER") ? profile.units : units), is("MANAGER"))}</div>`,
    "topic",
  );
}
async function runAction(act: string, d: Row = {}) {
  if (!detail) throw Error("เปิดผู้สมัครก่อน");
  await rpc(act, {
    id: detail.applicant.id,
    version: detail.applicant.version,
    ...d,
  });
  modal.close();
  toast("บันทึกแล้ว");
  await openApplicant(detail.applicant.id);
}
async function clickAction(action: string) {
  if (action === "reload") {
    location.reload();
    return;
  }
  if (action === "close-modal") {
    modal.close();
    return;
  }
  if (action === "login") {
    location.hash = "";
    await init();
    return;
  }
  if (action === "apply") {
    window.open(
      appAddress(location.origin, import.meta.env.BASE_URL, "#apply"),
      "_blank",
      "noopener,noreferrer",
    );
    return;
  }
  if (action === "logout") {
    await db.auth.signOut();
    return;
  }
  if (action === "password") {
    recovery = false;
    passwordPage();
    return;
  }
  if (action === "forgot") {
    openModal(
      "ขอลิงก์ตั้งรหัสผ่าน",
      `<div class="fields">${field("email", "อีเมล", "", true, "email")}</div><p class="hint">ลิงก์ส่งผ่าน Supabase Auth ต้องตั้ง Site URL และ SMTP ก่อน</p>`,
      "forgot",
    );
    return;
  }
  if (action === "refresh") {
    if (detail) await openApplicant(detail.applicant.id);
    else await load();
    return;
  }
  if (action === "back") {
    await render();
    return;
  }
  if (action === "requests") {
    screen = "requests";
    await render();
    return;
  }
  if (action === "reserves") {
    screen = "applicants";
    filters = { ...filters, status: "RESERVE", offset: 0 };
    await render();
    return;
  }
  if (action === "new-applicant") {
    openModal("เพิ่มผู้สมัคร", profileFields(), "new-applicant");
    applyDriverRequirements();
    return;
  }
  if (action === "backup") {
    const backup = await rpc("backup");
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "Recruitment-Backup-" + today() + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("ดาวน์โหลดข้อมูลแล้ว (เอกสารเป็นรายการอ้างอิง ไม่รวมไฟล์จริง)");
    return;
  }
  if (action === "reset-preview") {
    const plan = await rpc("reset_preview");
    openModal(
      "ตรวจสอบก่อนล้างข้อมูล",
      `<div class="notice warn">การล้างนี้ย้อนกลับผ่านหน้าเว็บไม่ได้ โปรดสำรองข้อมูลก่อน</div><p>ผู้สมัคร ${plan.applicants} · คำขอ ${plan.requests} · อัตรา ${plan.slots} · สัมภาษณ์ ${plan.evaluations} · อบรม ${plan.training} · เอกสาร ${plan.documents} (ไฟล์ใน Storage ${plan.storage_files}) · ประวัติ ${plan.activities}</p><input type="hidden" name="fingerprint" value="${esc(plan.fingerprint)}"><div class="fields">${field("confirmation", "พิมพ์ RESET RECRUITMENT เพื่อยืนยัน", "", true)}</div>`,
      "reset",
    );
    return;
  }
  if (action === "new-profile") {
    profileModal();
    return;
  }
  if (action === "new-topic") {
    topicModal();
    return;
  }
  if (action === "new-request") {
    openModal(
      "แจ้งขอคน",
      `<div class="fields">${field("title", "หัวข้อคำขอ", "", true)}${select("unit", "หน่วยงาน", unitOpts("", is("MANAGER") ? profile.units : units), true)}${note()}</div><h3>ทะเบียนและอัตราที่ต้องการ</h3><div id="request-lines"></div>${button("+ เพิ่มทะเบียน / อัตรา", "add-line")}<p class="hint">คนขับและเด็กติดรถแยกคนละรายการ (KPI นับเฉพาะคนขับ)</p>`,
      "request",
    );
    addLine();
    return;
  }
  if (action === "add-line") {
    addLine();
    return;
  }
  if (!detail) return;
  const a = detail.applicant as Applicant;
  if (action === "edit-applicant") {
    openModal(
      "แก้ข้อมูลผู้สมัคร",
      `<div class="notice">หน่วยงานสมัครเดิม ${esc(a.original_unit)} จะคงอยู่ หากเปลี่ยนหน่วยงานรับจริง ระบบปลดคำขอและผู้สัมภาษณ์เดิมอัตโนมัติ</div>${profileFields(a)}`,
      "edit-applicant",
    );
    applyDriverRequirements();
    return;
  }
  if (action === "claim" || action === "release-interview") {
    await runAction(action === "claim" ? "claim" : "release_interview");
    return;
  }
  if (action === "match") {
    const requests = (await rpc("requests")) as Row[];
    const slots = requests
      .filter((r) => r.received_at && r.unit === a.hiring_unit)
      .flatMap((r) =>
        r.slots
          .filter(
            (s: Row) =>
              s.position === a.position &&
              (s.status === "OPEN" || s.id === a.slot_id),
          )
          .map((s: Row) => ({
            value: s.id,
            label: r.title + " · " + s.plate + " · " + fleet(s.fleet_type),
          })),
      );
    openModal(
      "ผูกคำขอคน",
      `<div class="fields">${select("slot_id", "เลือกอัตราว่าง", opts(slots, a.slot_id, "ไม่ผูกคำขอ"))}${note()}</div>`,
      "match",
    );
    return;
  }
  if (action === "contact") {
    openModal(
      "บันทึกการติดต่อ",
      `<div class="fields">${note(a.data.contact_note, true)}${dates("next_contact_date", "นัดติดต่อครั้งถัดไป", a.data.next_contact_date)}</div>`,
      "contact",
    );
    return;
  }
  if (action === "reserve") {
    openModal(
      "เก็บเป็นผู้สมัครสำรอง",
      `<p class="notice">ระบบปลดอัตราที่ผูกและเก็บประวัติสัมภาษณ์ไว้</p><div class="fields">${note("", true)}</div>`,
      "reserve",
    );
    return;
  }
  if (action === "recall") {
    openModal(
      "เรียกผู้สมัครสำรองกลับ",
      `<div class="fields">${select(
        "reuse",
        "ผลสัมภาษณ์",
        opts(
          [
            { value: "false", label: "สัมภาษณ์ใหม่" },
            { value: "true", label: "ใช้ผลเดิมเป็นแบบร่างเพื่อทบทวน" },
          ],
          "false",
        ),
        true,
      )}${note("", true)}</div><p class="hint">กลับเข้า HR ตรวจ และให้หัวหน้างานยืนยันผลรอบใหม่</p>`,
      "recall",
    );
    return;
  }
  if (action === "close-case") {
    openModal(
      "ปิดเคส",
      `<div class="fields">${select(
        "result",
        "สถานะ",
        opts([
          { value: "WITHDRAWN", label: "ถอนตัว" },
          { value: "NO_SHOW", label: "ไม่มาเริ่มงาน" },
          { value: "CANCELLED", label: "ยกเลิกรับ" },
        ]),
        true,
      )}${note("", true)}</div>`,
      "close-case",
    );
  }
}
function addLine() {
  const parent = modal.querySelector("#request-lines");
  if (!parent) return;
  const index = parent.children.length;
  const div = document.createElement("div");
  div.className = "slot request-line";
  div.innerHTML = `<div class="fields">${field("plate-" + index, "ทะเบียนรถ", "", true)}${select(
    "fleet-" + index,
    "รถ",
    opts(
      [
        { value: "COMPANY", label: "รถบริษัท" },
        { value: "PARTNER", label: "รถร่วม" },
      ],
      "COMPANY",
    ),
    true,
  )}${select(
    "position-" + index,
    "ตำแหน่ง",
    opts(
      [
        { value: "DRIVER", label: "พนักงานขับรถ" },
        { value: "HELPER", label: "เด็กติดรถ" },
      ],
      "DRIVER",
    ),
    true,
  )}</div><button type="button" data-remove-line>ลบรายการนี้</button>`;
  parent.appendChild(div);
}
document.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.name === "position") applyDriverRequirements();
  if (el.closest("#screen")) dynamicRequirements();
  if (el.closest("#employment")) {
    const form = el.closest("form")!;
    const input = form.elements.namedItem("note") as HTMLTextAreaElement;
    input.required = !!(
      form.elements.namedItem("resignation_date") as HTMLInputElement
    ).value;
    const label = input.closest("label")!;
    label.querySelector(".req")?.remove();
    if (input.required) {
      const star = document.createElement("span");
      star.className = "req";
      star.textContent = "*";
      label.insertBefore(star, input);
    }
  }
});
document.addEventListener("click", (e) => {
  const el = (e.target as Element).closest<HTMLElement>("button,a");
  if (!el) return;
  void (async () => {
    try {
      if (el.dataset.action) await clickAction(el.dataset.action);
      if (el.dataset.nav) {
        screen = el.dataset.nav;
        filters = { search: "", status: "", unit: "", offset: 0 };
        await render();
      }
      if (el.dataset.filter) {
        screen = "applicants";
        filters = {
          search: "",
          status: el.dataset.filter,
          unit: "",
          offset: 0,
        };
        await render();
      }
      if (el.dataset.open) await openApplicant(el.dataset.open);
      if (el.dataset.page) {
        filters.offset = Math.max(
          0,
          filters.offset + Number(el.dataset.page) * 30,
        );
        await render();
      }
      if (el.hasAttribute("data-remove-line"))
        el.closest(".request-line")?.remove();
      if (el.dataset.receive) {
        await rpc("receive_request", {
          id: el.dataset.receive,
          version: Number(el.dataset.version),
        });
        toast("รับเรื่องแล้ว เริ่มนับ KPI");
        await render();
      }
      if (el.dataset.cancelSlot) {
        openModal(
          "ยกเลิกอัตราว่าง",
          `<input type="hidden" name="id" value="${el.dataset.cancelSlot}"><input type="hidden" name="version" value="${el.dataset.version}"><div class="fields">${note("", true)}</div>`,
          "cancel-slot",
        );
      }
      if (el.dataset.profile) {
        const p = JSON.parse(
          document.getElementById("profile-" + el.dataset.profile)!
            .textContent || "{}",
        );
        profileModal(p);
      }
      if (el.dataset.training && detail) {
        const t = detail.training.find(
          (x: Row) => x.id === el.dataset.training,
        );
        const allowed = topics.filter(
          (x) =>
            x.category === t.category &&
            (!x.unit || x.unit === detail!.applicant.hiring_unit) &&
            (!x.position || x.position === detail!.applicant.position),
        );
        openModal(
          "แก้ผลอบรม",
          `<input type="hidden" name="training_id" value="${t.id}"><input type="hidden" name="training_version" value="${t.version}"><div class="fields">${select(
            "topic_id",
            "หัวข้อ",
            opts(
              allowed.map((x) => ({ value: x.id, label: x.title })),
              t.topic_id,
            ),
            true,
          )}${dates("training_date", "วันที่อบรม", t.training_date, true)}${select(
            "result",
            "ผล",
            opts(
              [
                { value: "PASS", label: "ผ่าน" },
                { value: "FAIL", label: "ไม่ผ่าน" },
              ],
              t.result,
            ),
            true,
          )}${note(t.note, true, "เหตุผล / รายละเอียดแก้ไข")}</div>`,
          "training-edit",
        );
      }
      if (el.dataset.document && detail && attachmentsEnabled) {
        const doc = detail.documents.find(
          (x: Row) => x.id === el.dataset.document,
        );
        const { data, error } = await db.storage
          .from("recruitment-documents")
          .createSignedUrl(doc.path, 60);
        if (error) throw error;
        const a = document.createElement("a");
        a.href = data.signedUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.click();
      }
    } catch (err) {
      fail(err);
    }
  })();
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const draft = (e as SubmitEvent).submitter?.getAttribute("value") === "draft";
  if (!draft && !form.reportValidity()) return;
  void (async () => {
    busy(form, true);
    try {
      const d = dataOf(form);
      switch (form.id) {
        case "login": {
          const { error } = await db.auth.signInWithPassword({
            email: String(d.email),
            password: String(d.password),
          });
          if (error)
            throw Error("อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือบัญชียังไม่ยืนยัน");
          await load();
          break;
        }
        case "forgot": {
          const { error } = await db.auth.resetPasswordForEmail(
            String(d.email),
            {
              redirectTo: appAddress(location.origin, import.meta.env.BASE_URL),
            },
          );
          if (error) throw error;
          modal.close();
          toast("หากอีเมลมีในระบบ จะได้รับลิงก์ตั้งรหัสผ่าน");
          break;
        }
        case "password": {
          if (d.password !== d.confirm) throw Error("รหัสผ่านไม่ตรงกัน");
          const { error } = await db.auth.updateUser({
            password: String(d.password),
          });
          if (error) throw error;
          recovery = false;
          toast("เปลี่ยนรหัสผ่านแล้ว");
          await load();
          break;
        }
        case "public-apply": {
          const payload = applicantPayload(form);
          delete payload.data.consent;
          const { data, error } = await db.rpc("recruitment_apply", {
            p_payload: payload,
          });
          if (error) throw error;
          root.innerHTML = `<main class="login card"><h1>ได้รับใบสมัครแล้ว</h1><p>HR จะติดต่อกลับตามเบอร์ที่ระบุ</p><small>เลขอ้างอิง ${esc(data.id)}</small></main>`;
          break;
        }
        case "new-applicant": {
          await rpc("create_applicant", applicantPayload(form));
          modal.close();
          toast("เพิ่มผู้สมัครแล้ว");
          await render();
          break;
        }
        case "edit-applicant":
          await runAction("edit_applicant", applicantPayload(form));
          break;
        case "filters":
          filters = {
            search: String(d.search || ""),
            unit: String(d.unit || ""),
            status: String(d.status || ""),
            offset: 0,
          };
          await render();
          break;
        case "screen":
          await runAction("screen", d);
          break;
        case "interview": {
          const submit =
            (e as SubmitEvent).submitter?.getAttribute("value") === "submit";
          await runAction("interview", { ...d, submit });
          break;
        }
        case "handover":
        case "employment":
        case "contact":
        case "reserve":
        case "match":
        case "training":
          await runAction(form.id, d);
          break;
        case "training-edit":
          await runAction("training", d);
          break;
        case "recall":
          await runAction("recall", { ...d, reuse: d.reuse === "true" });
          break;
        case "close-case":
          await runAction("close", d);
          break;
        case "request": {
          const lines = Array.from(form.querySelectorAll(".request-line")).map(
            (line) => {
              const fields = line.querySelectorAll<
                HTMLInputElement | HTMLSelectElement
              >("input,select");
              return {
                plate: fields[0]!.value,
                fleet_type: fields[1]!.value,
                position: fields[2]!.value,
              };
            },
          );
          await rpc("create_request", {
            title: d.title,
            unit: d.unit,
            note: d.note,
            lines,
          });
          modal.close();
          toast("ส่งคำขอแล้ว");
          await render();
          break;
        }
        case "cancel-slot":
          await rpc("cancel_slot", d);
          modal.close();
          toast("ยกเลิกอัตราแล้ว");
          await render();
          break;
        case "reset":
          await rpc("reset_transactions", d);
          modal.close();
          toast("รีเซ็ตข้อมูลทดลองแล้ว");
          await render();
          break;
        case "settings":
          await rpc("settings", {
            ...d,
            public_apply: d.public_apply === "true",
          });
          toast("บันทึกแล้ว");
          await load();
          break;
        case "unit":
          await rpc("unit", d);
          toast("เพิ่มหน่วยงานแล้ว");
          await load();
          break;
        case "profile":
          await rpc("save_profile", {
            ...d,
            active: d.active === "true",
            version: Number(d.version),
            units: new FormData(form).getAll("units"),
          });
          modal.close();
          toast("บันทึกสิทธิ์แล้ว");
          await load();
          break;
        case "topic":
          await rpc("save_topic", d);
          modal.close();
          toast("เพิ่มหัวข้อแล้ว");
          topics = (await rpc("snapshot")).topics;
          if (detail) await openApplicant(detail.applicant.id);
          else await render();
          break;
        case "upload": {
          if (!attachmentsEnabled) throw Error("พักการแนบเอกสารไว้เฟสถัดไป");
          if (!detail) break;
          const file = (form.elements.namedItem("file") as HTMLInputElement)
            .files?.[0];
          if (!file) throw Error("เลือกไฟล์");
          if (
            file.size > 5 * 1024 * 1024 ||
            !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
          )
            throw Error("รองรับ PDF / JPG / PNG ไม่เกิน 5 MB");
          const extension =
            file.type === "application/pdf"
              ? "pdf"
              : file.type === "image/png"
                ? "png"
                : "jpg";
          const path =
            profile.id +
            "/" +
            detail.applicant.id +
            "/" +
            crypto.randomUUID() +
            "." +
            extension;
          const { error } = await db.storage
            .from("recruitment-documents")
            .upload(path, file, { upsert: false, contentType: file.type });
          if (error) throw error;
          try {
            await runAction("document", {
              path,
              title: file.name.slice(0, 200),
            });
          } catch (error) {
            throw Error(
              "อัปโหลดไฟล์แล้ว แต่บันทึกแนบไม่สำเร็จ กรุณาเปิดรายการใหม่และลองอีกครั้ง: " +
                (error instanceof Error ? error.message : error),
            );
          }
          break;
        }
      }
    } catch (err) {
      formError(form, err);
    } finally {
      busy(form, false);
    }
  })();
});
window.addEventListener("hashchange", () => {
  if (location.hash === "#apply") void publicPage().catch(fail);
});
void init();
