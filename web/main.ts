import {correctionSections,correctionLabels,correctionValue,correctionAudit} from "./corrections";
import {cancelDriveRequests,formatFileSize,initDrive,prepareUploads,uploadBatch,listDocuments,readDocument,recoverDocument,type UploadItem,type DriveDocument} from "./drive";
import {workflowSummary,workflowLabels} from "./workflow";
import {detailTabs,queueDefinitions,progressState,nextTask,type DetailTab} from "./workspace";
import {installDatePickers} from "./date-picker";
import { appAddress, configAddress, attachmentsEnabled } from "./runtime";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { button, field, select, note } from "./components";
import {
  roles,
  statuses,
  categories,
  esc,
  date,
  isoDate,
  today,
  retention,
  ageOnDate,
  canTrain,
  requiresAgeApproval,
  type Applicant,
  type Profile,
  type Role,
} from "./domain";
import "./style.css";
import "./design-system.css";
type Row = Record<string, any>;
const root = document.querySelector<HTMLDivElement>("#app")!;
const modal = document.querySelector<HTMLDialogElement>("#modal")!;
let db: SupabaseClient;
let profile: Profile;
let units: string[] = [];
let people: Row[] = [];
let topics: Row[] = [];
let settings: Row = {};
let requestEditPending: {action:string;payload:Row}|null=null;
let screen = "dashboard";
const blankFilters = () => ({search:"",status:"",unit:"",offset:0,size:20,sort:"created_at",order:"desc",position:"",vehicle:"",age_min:"",age_max:"",from:"",to:"",workflow_stage:"",queue:""});
let filters = blankFilters();
let detail: Row | null = null;
let selectedDetailTab: DetailTab = "general";
let tabApplicantId = "";
let recovery = false;
let generation = 0;
let destroyGrid: (() => void) | undefined;
const is = (...r: Role[]) => !!profile && r.includes(profile.role);
const person = (id: unknown) =>
  people.find((x) => x.id === id)?.display_name || "—";
const position = (p: unknown) =>
  p === "DRIVER" ? "พนักงานขับรถ" : "เด็กติดรถ";
const fleet = (p: unknown) =>
  p === "COMPANY" ? "รถบริษัท" : p === "PARTNER" ? "รถร่วม" : "—";
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
      .filter((x) => x.role === role && (!unit || x.all_units || x.units.includes(unit)))
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
function dataOf(form: HTMLFormElement): Row {
  const d = Object.fromEntries(new FormData(form));
  for (const input of form.querySelectorAll<HTMLInputElement>("[data-date]")) {
    if (!input.matches(":disabled")) d[input.name] = isoDate(String(d[input.name] || ""));
  }
  return d;
}
function numberTableRows(container: ParentNode) {
  for (const table of container.querySelectorAll<HTMLTableElement>("table")) {
    if (table.dataset.numbered) continue;
    table.dataset.numbered = "true";
    const header = table.tHead?.rows[0];
    if (!header) continue;
    const th = document.createElement("th");
    th.scope = "col"; th.className = "row-number"; th.textContent = "ลำดับ";
    header.prepend(th);
    let index = Number(table.dataset.rowOffset || 0);
    for (const body of table.tBodies) for (const row of body.rows) {
      if (row.cells.length === 1 && row.cells[0]!.colSpan > 1) {
        row.cells[0]!.colSpan += 1; continue;
      }
      const cell = row.insertCell(0);
      cell.className = "row-number"; cell.textContent = String(++index);
    }
  }
}
function openModal(title: string, body: string, formId?: string) {
  delete modal.dataset.pdfRequest;
  modal.innerHTML = `${button("✕", "close-modal", "close")}<h2 id="dialog-title">${title}</h2>${formId ? `<form id="${formId}">${body}<div class="actions form-footer"><button class="primary" type="submit">บันทึก</button>${button("ยกเลิก", "close-modal")}</div><p class="error" data-error></p></form>` : body}`;
  modal.setAttribute("aria-labelledby","dialog-title");
  numberTableRows(modal);
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
    await initDrive(db);
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
        filters = blankFilters();
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
  modal.close();modal.replaceChildren();cancelDriveRequests();clearAttachmentViews(); uploadJobs.clear();publicReceipt=null;
  root.innerHTML = `<main class="login card"><div class="brand">Recruitment System<small>รับสมัคร • สัมภาษณ์ • ดูแลพนักงาน</small></div><h2>เข้าสู่ระบบ</h2><p class="muted">ใช้อีเมลที่ Admin เปิดสิทธิ์ให้แล้ว</p><form id="login">${field("email", "อีเมล", "", true, "email", 'autocomplete="username"')}${field("password", "รหัสผ่าน", "", true, "password", 'autocomplete="current-password"')}<button type="submit" class="primary">เข้าสู่ระบบ</button><p data-error class="error"></p></form></main>`;
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
modal.addEventListener('close',()=>{delete modal.dataset.pdfRequest;for(const frame of modal.querySelectorAll<HTMLIFrameElement>('[data-private-pdf]')){const url=frame.dataset.privatePdf!;URL.revokeObjectURL(url);previewUrls.delete(url);frame.src='about:blank';}});
const selectedBatches=new WeakMap<HTMLInputElement,Promise<UploadItem[]>>();
const visibleDocuments=new Map<string,DriveDocument>();
const previewUrls=new Set<string>();
const uploadJobs=new Map<string,UploadItem[]>();
let publicReceipt:{id:string;code:string;token:string;items:UploadItem[];busy:boolean}|null=null;
function revokeInside(holder:Element){for(const img of holder.querySelectorAll<HTMLImageElement>('img'))if(img.src.startsWith('blob:')){URL.revokeObjectURL(img.src);previewUrls.delete(img.src);}}
function clearAttachmentViews(){for(const url of previewUrls)URL.revokeObjectURL(url);previewUrls.clear();visibleDocuments.clear();}
function attachmentFields(){return `<div class="attachment-fields full"><p class="hint">เลือกได้สูงสุด 10 ไฟล์ต่อครั้ง · JPG, PNG, PDF · ไม่เกิน 10 MB/ไฟล์</p>${!attachmentsEnabled?'<p class="notice">ขณะนี้ยังไม่เปิดรับไฟล์แนบ สามารถส่งใบสมัครโดยไม่แนบไฟล์ได้</p>':''}<label>เลือกภาพหรือไฟล์ (ไม่บังคับ)<input type="file" name="attachments" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf" multiple ${attachmentsEnabled?'':'disabled'}></label><div data-selected-files class="selected-files" aria-live="polite"></div><button type="button" data-action="clear-attachments">ล้างไฟล์ที่เลือก</button></div>`;}
async function selectedUploads(form:HTMLFormElement){const input=form.querySelector<HTMLInputElement>('[name="attachments"]');if(!input||input.disabled)return [];if(!selectedBatches.has(input)){const promise=prepareUploads(Array.from(input.files||[]));void promise.catch(()=>{});selectedBatches.set(input,promise);}return await selectedBatches.get(input)!;}
async function previewSelection(input:HTMLInputElement){const holder=input.closest('form')?.querySelector<HTMLElement>('[data-selected-files]');if(!holder)return;revokeInside(holder);holder.innerHTML='<p>กำลังตรวจไฟล์…</p>';const promise=prepareUploads(Array.from(input.files||[]));selectedBatches.set(input,promise);try{const items=await promise;if(selectedBatches.get(input)!==promise||!holder.isConnected)return;holder.innerHTML=items.map(item=>`<div class="selected-file" data-selected-id="${item.id}"><b>${esc(item.file.name)}</b><small>${formatFileSize(item.file.size)}</small>${item.mime.startsWith('image/')?'<img alt="ภาพที่เลือก" loading="lazy">':'<span class="pdf-mark">PDF</span>'}</div>`).join('');for(const item of items){if(item.mime.startsWith('image/')){const img=holder.querySelector<HTMLImageElement>(`[data-selected-id="${item.id}"] img`);if(img){const url=URL.createObjectURL(item.file);previewUrls.add(url);img.src=url;}}}}catch(e){if(selectedBatches.get(input)===promise)holder.innerHTML=`<p class="error">${esc(e instanceof Error?e.message:e)}</p>`;}}
function jobMarkup(items:UploadItem[]){return `<ul class="upload-status">${items.map(x=>`<li><b>${esc(x.file.name)}</b><span>${({waiting:'รอส่ง',uploading:'กำลังส่ง…',done:'ส่งสำเร็จ',failed:'ยังไม่สำเร็จ'})[x.state]}</span>${x.error?`<small class="error">${esc(x.error)}</small>`:''}</li>`).join('')}</ul>`;}
function renderUploadJob(id:string){const holder=root.querySelector<HTMLElement>(`[data-upload-job="${id}"]`);const items=uploadJobs.get(id);if(!holder||!items)return;const busy=items.some(x=>x.state==='uploading');if(items.every(x=>x.state==='done')){holder.innerHTML=`<p class="notice">แนบไฟล์สำเร็จ ${items.length} รายการ</p>`;return;}holder.innerHTML=jobMarkup(items)+(items.some(x=>x.state==='failed')?`<button type="button" data-retry-upload="${id}" ${busy?'disabled':''}>ลองส่งรายการที่ยังไม่สำเร็จ</button>`:'');}
async function runStaffUpload(id:string){const items=uploadJobs.get(id);if(!items||items.some(x=>x.state==='uploading'))return;renderUploadJob(id);root.querySelector(`[data-upload-job="${id}"]`)?.scrollIntoView({block:'center',behavior:'smooth'});await uploadBatch(id,items,()=>renderUploadJob(id));await refreshDocuments(id);if(items.every(x=>x.state==='done'))toast('แนบไฟล์ครบแล้ว');else toast('ใบสมัครยังอยู่ครบ มีไฟล์บางรายการที่ต้องลองส่งใหม่');}
function receiptView(){if(!publicReceipt)return;clearAttachmentViews();const r=publicReceipt;root.innerHTML=`${publicHeader()}<main class="submission-receipt card"><h1>ได้รับใบสมัครแล้ว</h1><p>HR จะติดต่อกลับตามเบอร์ที่ระบุ</p><p>เลขอ้างอิง <b>${esc(r.code)}</b></p>${r.items.length?`<h2>ผลการส่งไฟล์แนบ</h2><p>ใบสมัครถูกบันทึกแล้ว ไม่ต้องกรอกหรือส่งใบสมัครซ้ำ</p>${jobMarkup(r.items)}${r.items.some(x=>x.state==='failed')?`<p class="notice">กดส่งเฉพาะไฟล์ที่ยังไม่สำเร็จได้ในหน้านี้ หากปิดหน้าไปแล้ว กรุณาติดต่อ HR เพื่อแนบเพิ่ม</p><button type="button" class="primary" data-action="retry-public-files" ${r.busy?'disabled':''}>ลองส่งไฟล์ที่เหลือ</button>`:''}${r.busy?'<p role="status">กำลังส่งไฟล์ กรุณาเปิดหน้านี้ไว้…</p>':''}`:''}</main>`;}
async function continuePublicUploads(){if(!publicReceipt||publicReceipt.busy)return;publicReceipt.busy=true;receiptView();await uploadBatch(publicReceipt.id,publicReceipt.items,receiptView,publicReceipt.token);if(publicReceipt){publicReceipt.busy=false;receiptView();}}
async function refreshDocuments(id:string){const holder=root.querySelector<HTMLElement>(`[data-drive-panel="${id}"]`);if(!holder)return;try{const docs=await listDocuments(id);if(!holder.isConnected)return;for(const doc of docs)visibleDocuments.set(doc.id,doc);revokeInside(holder);holder.innerHTML=docs.length?`<div class="document-grid">${docs.map(doc=>`<article class="document-card"><h3>${esc(doc.filename)}</h3><small>${formatFileSize(doc.byte_size)} · ${date(doc.created_at)}</small>${doc.state==='PENDING'?`<p class="notice warn">การอัปโหลดอาจยังไม่สมบูรณ์</p><button type="button" data-drive-recover="${doc.id}">ตรวจไฟล์ที่ส่งค้าง</button>`:doc.mime_type.startsWith('image/')?`<div data-image-holder="${doc.id}"><p role="status">กำลังโหลดภาพ…</p><img alt="${esc(doc.filename)}" loading="lazy" hidden></div><button type="button" data-drive-download="${doc.id}">ดาวน์โหลดภาพ</button>`:`<div class="pdf-mark">PDF</div><div class="actions"><button type="button" data-drive-open="${doc.id}">เปิดดู PDF</button><button type="button" data-drive-download="${doc.id}">ดาวน์โหลด PDF</button></div>`}</article>`).join('')}</div>`:'<p class="muted">ยังไม่มีไฟล์แนบ</p>';let cursor=0;const images=docs.filter(x=>x.state==='READY'&&x.mime_type.startsWith('image/'));const worker=async()=>{while(cursor<images.length&&holder.isConnected){const doc=images[cursor++]!;await showImage(doc);}};await Promise.all([worker(),worker()]);}catch(e){if(holder.isConnected)holder.innerHTML=`<p class="error">${esc(e instanceof Error?e.message:e)}</p><button type="button" data-action="refresh">ลองโหลดเอกสารใหม่</button>`;}}
async function showImage(doc:DriveDocument){const holder=root.querySelector<HTMLElement>(`[data-image-holder="${doc.id}"]`);if(!holder)return;const img=holder.querySelector<HTMLImageElement>('img')!;try{const blob=await readDocument(doc);if(!img.isConnected)return;const url=URL.createObjectURL(blob);previewUrls.add(url);img.onerror=()=>{if(holder.isConnected){const p=document.createElement('p');p.className='error';p.textContent='ภาพอาจเสียหาย สามารถดาวน์โหลดไฟล์เดิมไปตรวจสอบได้';holder.prepend(p);}};img.src=url;img.hidden=false;holder.querySelector('p')?.remove();holder.querySelector('button')?.remove();}catch(e){if(holder.isConnected){holder.querySelector('p')!.textContent=e instanceof Error?e.message:'โหลดภาพไม่สำเร็จ';if(!holder.querySelector('button'))holder.insertAdjacentHTML('beforeend',`<button type="button" data-drive-preview="${doc.id}">ลองโหลดภาพใหม่</button>`);}}}

const icon = (paths:string) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const navIcons: Record<string,string> = {
 dashboard:icon('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
 applicants:icon('<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0112 0v2m1-16a3 3 0 010 6m2 4a5 5 0 013 4v2"/>'),
 requests:icon('<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2h6v2M9 10h6m-6 4h6m-6 4h3"/>'),
 training:icon('<path d="M3 4h6a4 4 0 013 2 4 4 0 013-2h6v16h-6a4 4 0 00-3 2 4 4 0 00-3-2H3zM12 6v16"/>'),
 guide:icon('<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 116 0c0 2-3 2-3 4m0 4h.01"/>'),
 admin:icon('<circle cx="12" cy="12" r="4"/><path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/>')
};
const workflowForms: Record<string,[string,string]> = {
  screen:["คัดกรองผู้สมัคร","บันทึกผลคัดกรอง"], interview:["สัมภาษณ์และรับเข้าทำงาน","บันทึกผลสัมภาษณ์"],
  handover:["ส่งมอบพนักงาน","กำหนดผู้ดูแล / ส่งมอบ"], "road-test":["ผลทดลองขับ","บันทึกผลทดลองขับ"],
  employment:["เริ่มงาน / สถานะพนักงาน","จัดการการเริ่มงาน"], training:["บันทึกการอบรม","+ บันทึกผลอบรม"],
  settings:["การรับสมัครออนไลน์","แก้ไขการตั้งค่า"],unit:["เพิ่มหน่วยงาน","+ เพิ่มหน่วยงาน"],upload:["เอกสารประกอบ","แนบเอกสาร"]
};
function compactForms() {
  for (const [id,[title,label]] of Object.entries(workflowForms)) {
    const form = root.querySelector<HTMLFormElement>(`form#${id}`);
    if (!form) continue;
    const template = document.createElement("template");
    template.id = `workflow-${id}`;
    template.content.append(form.cloneNode(true));
    const action = document.createElement("button");
    action.type = "button"; action.className = "primary";
    action.textContent = label; action.dataset.workflow = id; action.dataset.title = title;
    action.setAttribute("aria-haspopup","dialog");
    if (form.querySelector("fieldset:disabled")) {action.disabled=true;action.title="กรอกข้อมูลส่งมอบให้ครบก่อน";}
    form.replaceWith(action, template);
  }
}
function shell(body: string) {
  destroyGrid?.();
  destroyGrid = undefined;
  clearAttachmentViews();
  const nav = [
    ["dashboard", "ภาพรวม / งานที่ต้องทำ"],
    ["applicants", is("ADMIN", "HR", "MANAGER") ? "ผู้สมัคร" : "พนักงาน"],
    ...(is("ADMIN", "HR", "MANAGER") ? [["requests", "คำขอคน"]] : []),
    ["training", "การอบรม"],
    ["guide", "วิธีใช้งาน"],
    ...(is("ADMIN") ? [["admin", "ตั้งค่าระบบ"]] : []),
  ];
  const navButton = (key:string,label:string) => `<button type="button" data-nav="${key}" title="${label}" aria-label="${label}" ${screen === key ? 'aria-current="page"' : ''} class="${screen === key ? "active" : ""}"><span class="nav-icon" aria-hidden="true">${navIcons[key]}</span><span class="nav-label">${label}</span></button>`;
  root.innerHTML = `<div class="shell" data-role="${profile.role}"><aside class="sidebar" aria-label="เมนูหลัก"><div class="brand"><span class="brand-mark">${navIcons.applicants}</span><span class="nav-label">Recruitment<small>MANAGEMENT · V4.12</small></span></div><button class="mobile-menu" type="button" data-action="toggle-menu" aria-expanded="false" aria-label="เปิดหรือปิดเมนู">☰ เมนู</button><nav>${nav.map(([key,label]) => navButton(key!,label!)).join("")}</nav><div class="bottom"><div class="profile"><span class="avatar" aria-hidden="true">${esc(profile.display_name.slice(0,1))}</span><span class="nav-label">${esc(profile.display_name)}<small>${roles[profile.role]}</small></span></div><button type="button" data-action="logout" title="ออกจากระบบ" aria-label="ออกจากระบบ"><span class="nav-icon" aria-hidden="true">⇥</span><span class="nav-label">ออกจากระบบ</span></button></div></aside><main class="content"><div class="workspace-context"><span>${roles[profile.role]} Workspace</span><span>${esc(is("MANAGER") ? profile.all_units ? "ทุกหน่วยงาน · สิทธิ์พิเศษ" : profile.units.join(" · ") : "Recruitment System")}</span></div>${body}</main></div>`;
  compactForms();
  numberTableRows(root);
  const table = root.querySelector('.applicant-desktop table.applicant-table');
  if (table) void import('./applicant-grid').then(module => {
    if (!table.isConnected || !root.contains(table)) return;
    module.mountApplicantGrid(root);
    destroyGrid = module.destroyApplicantGrid;
  }).catch(error => console.error('โหลดตารางไม่สำเร็จ ใช้ตารางสำรอง', error));
}
function head(title: string, sub: string, actions = "",kicker="Recruitment System") {
  return `<header class="topbar"><div><p class="section-label">${esc(kicker)}</p><h1>${title}</h1><p class="muted" style="margin:8px 0 0">${sub}</p></div><div class="actions">${actions.includes('data-action="apply"')?"":button("แบบฟอร์ม", "apply")}${actions}${button("รีเฟรช", "refresh")}</div></header>`;
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
          `<div class="card empty" role="alert"><h2>โหลดข้อมูลไม่สำเร็จ</h2><p>กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง หากยังพบปัญหาให้ติดต่อผู้ดูแลระบบ</p>${button("ลองอีกครั้ง", "refresh")}</div>`,
      );
  }
}
async function dashboard() {
  const d = await rpc("dashboard", { unit: filters.unit });
  const c = d.counts, k = d.kpi14, r = d.retention;
  const definitions = queueDefinitions(profile.role);
  const queues = await Promise.all(definitions.map(async q => {
    try {const list=await rpc("applicants",{status:q.status||"",workflow_stage:q.workflow_stage||"",queue:q.queue||"",sort:q.sort||"created_at",order:q.order||"desc",size:10,offset:0,search:"",unit:filters.unit});return {...q,...list,error:false};}
    catch {return {...q,rows:[],total:0,error:true};}
  }));
  const queueHtml = `<section class="task-board"><div class="section-heading"><div><p class="section-label">TODAY · ${roles[profile.role]}</p><h2>งานที่ต้องทำ</h2></div><span class="muted">เลือกชื่อเพื่อเปิดขั้นตอนที่เกี่ยวข้อง</span></div><div class="task-grid">${queues.filter(q=>q.total>0||q.error).map(q=>`<section class="card task-card"><div class="section-heading"><h3>${q.title}</h3><span class="task-count">${q.error?'—':q.total}</span></div><p class="hint">${q.hint}</p>${q.error?'<p class="error">โหลดรายการไม่สำเร็จ กรุณากดรีเฟรช</p>':q.rows.slice(0,5).map((a:Applicant)=>`<button class="task-row" data-open="${a.id}" data-open-tab="${q.tab}"><span><b>${esc(a.full_name)}</b><small>${esc(a.hiring_unit)} · ${position(a.position)}</small><small class="task-stage">${esc(workflowSummary(a,today(),person).label)}${workflowSummary(a,today(),person).nextDate?" · "+date(workflowSummary(a,today(),person).nextDate):""}</small></span><span>${is("COACH") ? (a.coach_id===profile.id ? '<span class="badge">งานของฉัน</span>' : '<small>ดูข้อมูล</small>') : is("MANAGER")&&q.status==='INTERVIEW' ? (a.owner_id===profile.id ? '<span class="badge">งานของฉัน</span>' : a.owner_id ? '<small>มีผู้รับงานแล้ว</small>' : '<span class="badge warn">คิวร่วม</span>') : '→'}</span></button>`).join('')}<button class="queue-more" data-work-queue="${q.id}">ดูรายการทั้งหมด →</button></section>`).join('')}</div>${queues.every(q=>!q.error&&!q.total)?'<section class="card empty"><h3>ไม่มีงานในกลุ่มนี้ขณะนี้</h3><p>ค้นหารายการหรือเริ่มงานใหม่จากเมนูด้านข้างได้</p></section>':''}<details class="zero-queues"><summary>กลุ่มงานที่ไม่มีรายการ (${queues.filter(q=>!q.error&&!q.total).length})</summary>${queues.filter(q=>!q.error&&!q.total).map(q=>`<p>${q.title} · 0</p>`).join('')}</details></section>`;
  const work = {
    ADMIN:{title:"ศูนย์ดูแลระบบ",sub:"จัดการผู้ใช้งาน สิทธิ์ และการตั้งค่า ให้ทีมพร้อมทำงาน",label:"SYSTEM ADMINISTRATION",action:button("จัดการผู้ใช้และตั้งค่า", "admin-workspace", "primary")},
    HR:{title:"งานสรรหาของคุณ",sub:"ตรวจใบสมัคร ส่งสัมภาษณ์ และติดตามวันเริ่มงานในที่เดียว",label:"RECRUITMENT OPERATIONS",action:button("+ เพิ่มผู้สมัคร","new-applicant","primary")},
    MANAGER:{title:"งานของหน่วยงาน",sub:"แจ้งขอคน รับงานสัมภาษณ์ และส่งมอบพนักงานให้ผู้ดูแล",label:"SUPERVISOR WORKSPACE",action:button("+ แจ้งขอคน","new-request","primary")},
    COACH:{title:"งานดูแลพนักงานของคุณ",sub:"ตรวจรายชื่อพนักงาน และบันทึกผลทดลองขับเฉพาะคนที่ได้รับมอบหมาย",label:"DRIVER COACH WORKSPACE",action:button("เปิดรายชื่อพนักงาน","coach-workspace","primary")}
  }[profile.role];
  const stats = is("COACH") ? [["รอเริ่มงาน",c.HIRED||0,"HIRED"],["เริ่มงานแล้ว",c.STARTED||0,"STARTED"]] : is("MANAGER") ? [["รอสัมภาษณ์",c.INTERVIEW||0,"INTERVIEW"],["รอเริ่มงาน",c.HIRED||0,"HIRED"],["เริ่มงานแล้ว",c.STARTED||0,"STARTED"]] : [["รอ HR ตรวจ",c.HR_REVIEW||0,"HR_REVIEW"],["รอสัมภาษณ์",c.INTERVIEW||0,"INTERVIEW"],["รอเริ่มงาน",c.HIRED||0,"HIRED"],["เริ่มงานแล้ว",c.STARTED||0,"STARTED"]];
  return head(work.title,work.sub,work.action) +
  `${is("ADMIN","HR") ? '<section class="card hr-pin-card" id="hr-application-pin" aria-live="polite">กำลังโหลด PIN สำหรับผู้สมัคร…</section>' : ''}${queueHtml}<details class="metrics-fold"><summary>ภาพรวมและตัวชี้วัด</summary><div class="metrics-body"><div class="grid role-stats">${stats.map(([label,n,status])=>`<section class="card stat"><small>${label}</small><strong>${n}</strong><button data-filter="${status}">เปิดรายการ →</button></section>`).join("")}</div>` +
  `${is("ADMIN") ? `<section class="card"><h2>เครื่องมือผู้ดูแลระบบ</h2><p class="muted">จัดการบัญชี บทบาท หน่วยงาน และตรวจสอบประวัติ</p>${button("เปิดการตั้งค่าระบบ","admin-workspace")}</section>` : ''}` +
  `${is("HR","MANAGER") ? `<div class="split"><section class="card"><div class="section-heading"><h2>จัดหาคนขับภายใน 14 วัน</h2>${button("ดูคำขอคน","requests")}</div><div class="grid">${[["อัตราคนขับ",k.total],["รับผ่านแล้ว",k.filled],["ทัน 14 วัน",k.on_time],["ยังไม่ครบ / เกินกำหนด",k.overdue]].map(([label,n])=>`<div class="stat"><small>${label}</small><strong>${n}</strong></div>`).join('')}</div><p class="hint">เริ่มเมื่อ HR รับเรื่อง จบเมื่อ Supervisor ยืนยันผ่าน</p></section><section class="card"><h2>ผู้เริ่มงานใน 90 วันล่าสุด</h2><strong class="metric-value">${r.rate === null ? "—" : r.rate+"%"}</strong><div class="progress"><i style="width:${Math.min(100,r.rate||0)}%"></i></div><p>ยังทำงาน ${r.active} / เริ่มงาน ${r.total} คน · เป้าหมาย 90%</p><small>นับวันเริ่มงานจริง ${date(retention([],today()).from)} – ${date(today())}</small></section></div>${button("ดูผู้สมัครสำรอง","reserves")}` : ''}` +
  `${is("COACH") ? `<section class="card"><h2>ขั้นตอนบันทึกผลทดลองขับ</h2><div class="flow"><span>1. เลือกพนักงาน</span>→<span>2. เปิดผลทดลองขับ</span>→<span>3. ระบุผลและวันที่</span></div><p class="muted">บันทึกได้เฉพาะพนักงานที่ได้รับมอบหมายให้คุณดูแล</p>${button("ดูรายชื่อพนักงาน","coach-workspace")}</section>` : ''}</div></details>`;
}
function workflowBadge(a:Applicant) {
 const w=workflowSummary(a,today(),person);
 return `<span class="badge workflow-badge ${w.late?'bad':w.closed?'neutral':w.stage==='ACTIVE'?'':'warn'}">${esc(w.label)}</span>`;
}
function workflowDate(a:Applicant) {
 const w=workflowSummary(a,today(),person);
 return `<span class="${w.late?'text-danger':''}">${date(w.nextDate)}</span>${w.nextDate?`<small class="cell-secondary">${w.dateLabel}${w.late?' · เลยกำหนด':''}</small>`:''}`;
}
function applicantCode(a:Applicant) {
 if(a.document_code)return a.document_code;
 if(a.applicant_code)return a.applicant_code;
 const stamp=new Date(a.created_at);
 const day=Number.isNaN(stamp.getTime())?"":new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(stamp).replaceAll("-","");
 return `${a.position==='DRIVER'?'DRV':'AST'}-${day}-${a.id.replaceAll('-','').slice(0,8).toUpperCase()}`;
}
function ageBadge(years:number|null|undefined, pos:string) {
 if(years===null||years===undefined)return '<span class="badge neutral">ยังไม่มีข้อมูลอายุ</span>';
 const eligible=years>=(pos==='DRIVER'?25:18);
 return `<span class="badge ${eligible?'':'bad'}">${years} ปี · ${eligible?'ผ่านเกณฑ์':'ต่ำกว่าเกณฑ์'}</span>`;
}
async function applicantList() {
 const training=screen==='training';
 const list=await rpc("applicants",{...filters,...(training?{status:"STARTED"}:{})});
 const rows=list.rows as Applicant[];
 const sorted=(key:string,label:string)=>`<button class="column-sort" type="button" data-sort="${key}">${label} <span aria-hidden="true">${filters.sort===key?(filters.order==='asc'?'↑':'↓'):'↕'}</span></button>`;
 const sortAria=(key:string)=>filters.sort===key?`aria-sort="${filters.order==='asc'?'ascending':'descending'}"`:'';
 const active=!!(filters.search||filters.unit||filters.status||filters.position||filters.vehicle||filters.age_min||filters.age_max||filters.from||filters.to||filters.workflow_stage||filters.queue);
 const selectedFilters=[filters.workflow_stage?workflowLabels[filters.workflow_stage]:'',filters.queue?'งานทดลองขับของฉัน':'',filters.status?statuses[filters.status]:'',filters.unit,filters.search?`ค้นหา: ${filters.search}`:'',filters.position?position(filters.position):'',filters.vehicle,filters.age_min?`อายุตั้งแต่ ${filters.age_min}`:'',filters.age_max?`อายุไม่เกิน ${filters.age_max}`:'',filters.from?`สมัครตั้งแต่ ${date(filters.from)}`:'',filters.to?`ถึง ${date(filters.to)}`:''].filter(Boolean).join(' · ');
 const total=Number(list.total),start=total?filters.offset+1:0,end=Math.min(filters.offset+rows.length,total),last=Math.max(0,Math.floor((total-1)/filters.size)*filters.size);
 return `<nav class="breadcrumb" aria-label="ตำแหน่งปัจจุบัน"><span>⌂</span><span>›</span><strong>${training?'พนักงาน / การอบรม':is('COACH')?'พนักงาน':'ผู้สมัครทั้งหมด'}</strong></nav>`+head(training?'พนักงาน / การอบรม':is('COACH')?'พนักงานและงานทดลองขับ':'ผู้สมัครทั้งหมด',training?'ค้นหาพนักงาน เปิดข้อมูล และบันทึกผลอบรมตามสิทธิ์':'ค้นหา คัดกรอง และติดตามกระบวนการรับสมัคร',button("แบบฟอร์ม", "apply")+(is('ADMIN','HR')&&!training?button('+ เพิ่มผู้สมัคร','new-applicant','primary'):''),training?'Employees':'Applicants')+
 `<details class="card filter-panel"><summary><span>☷ &nbsp;ค้นหาและตัวกรอง</span><span class="filter-status">${active?'มีตัวกรอง':''}⌄</span></summary><form id="filters"><div class="list-filter-grid">${field('search','ชื่อ เบอร์โทร หรือรหัสผู้สมัคร',filters.search)}${select('unit','หน่วยงาน',unitOpts(filters.unit).replace('เลือก…','ทุกหน่วยงาน'))}${!training?select('status','ผลการรับสมัคร',opts(Object.entries(statuses).filter(([v])=>!is('COACH')||['HIRED','STARTED'].includes(v)).map(([value,label])=>({value,label})),filters.status,'ทุกสถานะ')):''}${select('workflow_stage','ขั้นตอนปัจจุบัน',opts(Object.entries(workflowLabels).filter(([k])=>!is('COACH')||['HANDOVER_PENDING','START_DATE_PENDING','START_TODAY','START_OVERDUE','START_SCHEDULED','ACTIVE','RESIGNED'].includes(k)).map(([value,label])=>({value,label})),filters.workflow_stage,'ทุกขั้นตอน'))}${select('position','ตำแหน่ง',opts([{value:'DRIVER',label:'พนักงานขับรถ'},{value:'HELPER',label:'เด็กติดรถ'}],filters.position,'ทุกตำแหน่ง'))}${select('vehicle','ประเภทรถ',opts(['เทรเลอร์','4W','6W','10W'].map(x=>({value:x,label:x})),filters.vehicle,'ทุกประเภท'))}${!is('COACH')?field('age_min','อายุตั้งแต่ (ปี)',filters.age_min,false,'number','min="0" max="120"')+field('age_max','อายุไม่เกิน (ปี)',filters.age_max,false,'number','min="0" max="120"'):''}${dates('from','สมัครตั้งแต่วันที่',filters.from)}${dates('to','ถึงวันที่',filters.to)}</div><div class="filter-actions"><button class="primary" type="submit">ค้นหา</button>${button('ล้างตัวกรอง','clear-filters')}</div><p class="error" data-error></p></form></details>
 ${active?`<div class="notice queue-notice"><span>กำลังดู: ${esc(selectedFilters)}</span>${button('ล้างตัวกรอง','clear-filters')}</div>`:''}<section class="surface applicant-list-surface"><div class="list-table-heading"><h2>${training||is('COACH')?'รายชื่อพนักงาน':'รายการผู้สมัคร'}</h2><small>ทั้งหมด ${total} รายการ</small></div>
 <div class="applicant-mobile">${rows.map((a,i)=>`<article class="mobile-record"><small class="reference-code">ลำดับ ${filters.offset+i+1} · ${esc(applicantCode(a))}</small><div class="section-heading"><b>${esc(a.full_name)}</b>${workflowBadge(a)}</div><p>${position(a.position)} · ${esc(a.hiring_unit)}</p><div class="mobile-record-facts">${!is('COACH')?ageBadge(a.age_years,a.position):''}<span>${esc(a.vehicle_type||'—')}</span></div><div class="mobile-workflow"><p><b>รอ:</b> ${esc(workflowSummary(a,today(),person).waiting)}</p><p><b>วันนัด:</b> ${workflowDate(a)}</p></div><div class="record-meta"><span>สมัคร ${date(a.created_at)}</span><span>${is('COACH')&&a.coach_id===profile.id?'งานของฉัน':esc(person(is('COACH')?a.coach_id:a.owner_id))}</span></div><button data-open="${a.id}" ${training?'data-open-tab="training"':''}>รายละเอียด →</button></article>`).join('')}${!rows.length?`<div class="empty"><p>${active?'ไม่พบรายการที่ตรงกับเงื่อนไข':'ยังไม่มีรายการในระบบ'}</p>${active?button('ล้างตัวกรอง','clear-filters'):''}</div>`:''}</div>
 <div class="table-wrap applicant-desktop"><table class="applicant-table" data-row-offset="${filters.offset}"><thead><tr><th ${sortAria('full_name')}>${sorted('full_name','ชื่อผู้สมัคร')}</th><th>ขั้นตอนปัจจุบัน</th><th>รอผู้รับผิดชอบ</th><th ${sortAria('next_date')}>${sorted('next_date','วันนัดถัดไป')}</th><th ${sortAria('hiring_unit')}>${sorted('hiring_unit','หน่วยงาน')}</th><th>ตำแหน่ง</th>${!is('COACH')?`<th ${sortAria('age')}>${sorted('age','อายุ')}</th>`:''}<th>ประเภทรถ</th><th ${sortAria('created_at')}>${sorted('created_at','วันที่สมัคร')}</th>${is('COACH')?'<th>Driver Coach</th>':''}<th class="record-action"></th></tr></thead><tbody>${rows.map(a=>`<tr><td class="applicant-name-cell"><b>${esc(a.full_name)}</b><small class="cell-secondary">${esc(a.phone)}</small><small class="cell-secondary reference-code" title="${a.id}">${esc(applicantCode(a))}</small></td><td class="workflow-cell">${workflowBadge(a)}</td><td class="waiting-cell">${esc(workflowSummary(a,today(),person).waiting)}</td><td>${workflowDate(a)}</td><td>${esc(a.hiring_unit)}</td><td>${position(a.position)}</td>${!is('COACH')?`<td>${ageBadge(a.age_years,a.position)}</td>`:''}<td>${esc(a.vehicle_type||'—')}</td><td>${date(a.created_at)}</td>${is('COACH')?`<td>${a.coach_id===profile.id?'<span class="badge">งานของฉัน</span>':esc(person(a.coach_id))}</td>`:''}<td class="record-action"><button data-open="${a.id}" ${training?'data-open-tab="training"':''}>รายละเอียด ›</button></td></tr>`).join('')}</tbody></table>${!rows.length?`<div class="empty"><p>${active?'ไม่พบรายการที่ตรงกับเงื่อนไข':'ยังไม่มีรายการในระบบ'}</p>${active?button('ล้างตัวกรอง','clear-filters'):''}</div>`:''}</div>
 <div class="list-pagination"><small>ผลลัพธ์: ${start}–${end} จาก ${total}</small><div class="page-controls"><label>แสดงรายการ<select data-list-size aria-label="จำนวนรายการต่อหน้า">${[10,20,30,50,100].map(n=>`<option value="${n}" ${filters.size===n?'selected':''}>${n}</option>`).join('')}</select></label><button data-offset="0" aria-label="หน้าแรก" ${filters.offset===0?'disabled':''}>«</button><button data-page="-1" aria-label="หน้าก่อนหน้า" ${filters.offset===0?'disabled':''}>‹</button><span class="page-indicator">${Math.floor(filters.offset/filters.size)+1} / ${Math.max(1,Math.ceil(total/filters.size))}</span><button data-page="1" aria-label="หน้าถัดไป" ${filters.offset+filters.size>=total?'disabled':''}>›</button><button data-offset="${last}" aria-label="หน้าสุดท้าย" ${filters.offset>=last?'disabled':''}>»</button></div></div></section>`;
}
function personalSummary(a:Applicant) {
 const d=a.data;
 const row=(label:string,value:unknown)=>`<div class="summary-row"><span>${label}</span><div>${esc(value||'—')}</div></div>`;
 const datum=(key:string,label:string,isDate=false)=>row(label,isDate?date(d[key]):d[key]);
 const group=(title:string,content:string)=>`<section class="profile-group"><h3>${title}</h3>${content}</section>`;
 const identity=group('ข้อมูลส่วนบุคคล',datum('prefix','คำนำหน้า')+row('ชื่อ–สกุล',a.full_name)+datum('gender','เพศ')+datum('birth_date','วันเดือนปีเกิด',true)+(!is('COACH')?`<div class="summary-row"><span>อายุ</span><div>${ageBadge(ageOnDate(d.birth_date,today()),a.position)}</div></div>`:'')+row('ตำแหน่ง',position(a.position)));
 const contact=group('ข้อมูลติดต่อและการขับรถ',row('เบอร์โทรศัพท์',a.phone)+datum('line_id','LINE ID')+datum('vehicle_type','ประเภทรถ')+datum('cargo_types','สินค้าที่เคยขน')+datum('license_type','ประเภทใบขับขี่')+datum('fuel_type','ประเภทเชื้อเพลิง'));
 const government=!is('COACH')?group('ข้อมูลบัตรประชาชน',datum('national_id','เลขบัตรประชาชน')+datum('id_issued_at','วันออกบัตร',true)+datum('id_expires_at','วันหมดอายุบัตร',true)):'';
 const licence=group('ข้อมูลใบขับขี่',(!is('COACH')?datum('driver_license_no','เลขใบขับขี่'):'')+datum('license_type','ประเภทใบขับขี่')+datum('license_issued_at','วันออกใบขับขี่',true)+datum('license_expires_at','ใบขับขี่หมดอายุ',true));
 const unit=group('หน่วยงาน',row('หน่วยงานที่สมัครเดิม',a.original_unit)+row('หน่วยงานที่รับจริง',a.hiring_unit)+row('ผู้สัมภาษณ์',person(a.owner_id))+row('คำขอที่ผูก',a.slot_id?'ผูกคำขอแล้ว':'ไม่ผูกคำขอ'));
 const experience=group('ความพร้อมและประสบการณ์',datum('current_job_status','สถานะการทำงาน')+datum('available_start_date','วันที่พร้อมเริ่มงาน',true)+datum('availability_note','หมายเหตุความพร้อม')+datum('construction_brands','วัสดุก่อสร้าง / ยี่ห้อ')+datum('beverage_brands','เครื่องดื่ม / ยี่ห้อ')+datum('other_cargo_note','งานขนส่งอื่น'));
 return `<section class="card personal-summary" data-detail-group="general"><div class="profile-groups">${identity}${contact}${government}${licence}${unit}${experience}</div></section>`;
}
function profileFields(a?: Applicant) {
  const newApplication = !a;
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
    "สถานะการทำงาน",
    opts(
      ["ว่างงาน", "ทำงานอยู่", "อื่นๆ"].map((x) => ({ value: x, label: x })),
      d.current_job_status,
    ),
    newApplication,
  )}${dates("available_start_date", "วันที่พร้อมเริ่มงาน", d.available_start_date, newApplication)}${field("availability_note", "หมายเหตุความพร้อม", d.availability_note)}${dates("id_issued_at", "วันออกบัตรประชาชน", d.id_issued_at, newApplication)}${dates("id_expires_at", "วันหมดอายุบัตรประชาชน", d.id_expires_at, newApplication)}<div class="full notice">ข้อมูลรถและใบขับขี่จำเป็นเฉพาะผู้สมัครตำแหน่งพนักงานขับรถ</div>${select(
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
  )}${select("fuel_type", "ประเภทเชื้อเพลิง", opts(["รถก๊าซ", "รถน้ำมัน", "รถไฟฟ้า", "ได้ทั้งหมด"].map(value => ({value,label:value})), d.fuel_type))}${field("driver_license_no", "เลขใบขับขี่", d.driver_license_no)}${dates("license_issued_at", "วันออกใบขับขี่", d.license_issued_at)}${dates("license_expires_at", "วันหมดอายุใบขับขี่", d.license_expires_at)}${field("cargo_types", "สินค้าที่เคยขน", d.cargo_types, newApplication, "text", 'placeholder="หากไม่มี ให้ระบุ ไม่มี"')}${field("construction_brands", "วัสดุก่อสร้าง: สินค้า / ยี่ห้อ", d.construction_brands)}${field("beverage_brands", "น้ำ / โซดา / เบียร์: สินค้า / ยี่ห้อ", d.beverage_brands)}${field("other_cargo_note", "งานขนส่งอื่น", d.other_cargo_note, newApplication, "text", 'placeholder="หากไม่มี ให้ระบุ ไม่มี"')}${a ? note("", false, "เหตุผลแก้ไข (บังคับเมื่อเปลี่ยนหน่วยงาน)") : ""}</div>`;
}
function applicantPayload(form: HTMLFormElement) {
  const raw = dataOf(form);
  const { full_name, phone, unit, position, note, attachments: _attachments, ...data } = raw;
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
let applyTicket = "";
let applyTicketExpires = 0;
let pinDeadline = 0;
let pinRefreshing = false;
function publicHeader() {
  return `<header class="apply-header"><a href="#" data-action="login">Recruitment<span>ระบบรับสมัครพนักงาน</span></a><span class="apply-private">ข้อมูลส่งถึงฝ่าย HR</span></header>`;
}
function publicApplicationForm() {
  // Reuse the same fields and validation as HR; group them for a short, scannable form.
  const template = document.createElement("template");
  template.innerHTML = profileFields();
  const fields = template.content.querySelector(".fields")!;
  const groups = [
    {title:"ข้อมูลส่วนตัว", hint:"ระบุข้อมูลตามบัตรประชาชนและเบอร์ที่ติดต่อได้", names:["prefix","full_name","gender","birth_date","national_id","phone","line_id","id_issued_at","id_expires_at"]},
    {title:"ข้อมูลการสมัคร", hint:"เลือกตำแหน่ง หน่วยงาน และความพร้อมในการเริ่มงาน", names:["position","unit","current_job_status","available_start_date","availability_note"]},
    {title:"ประสบการณ์และใบขับขี่", hint:"ช่องที่มี * จำเป็นสำหรับตำแหน่งพนักงานขับรถ", names:["vehicle_type","license_type","driver_license_no","fuel_type","license_issued_at","license_expires_at","cargo_types","construction_brands","beverage_brands","other_cargo_note"]},
  ];
  const sections = groups.map((g,i) => `<section class="apply-section"><div class="apply-section-heading"><span>${i+1}</span><div><h2>${g.title}</h2><p>${g.hint}</p></div></div><div class="fields">${g.names.map(name => fields.querySelector(`[name="${name}"]`)?.closest("label")?.outerHTML || "").join("")}</div></section>`).join("");
  root.innerHTML = `${publicHeader()}<main class="apply-layout"><aside class="apply-intro"><p class="section-label">มาร่วมงานกับเรา</p><h1>เริ่มต้นงานใหม่ <br>ไปด้วยกัน</h1><p>กรอกข้อมูลสมัครงานให้ครบถ้วน<br>แล้วฝ่าย HR จะติดต่อกลับ</p><div class="apply-help"><b>เตรียมข้อมูลก่อนสมัคร</b><p>บัตรประชาชน · เบอร์โทรศัพท์<br>ข้อมูลใบขับขี่ สำหรับพนักงานขับรถ</p><small>แนบ JPG, PNG หรือ PDF ได้ตามต้องการ ไม่บังคับ</small></div></aside><div class="apply-body"><div class="apply-title"><p class="section-label">ใบสมัครออนไลน์</p><h1>สมัครงานกับเรา</h1><p>ช่อง <span class="req">*</span> จำเป็นต้องกรอก · วันที่ใช้ ค.ศ.</p></div><form id="public-apply">${sections}<section class="apply-section"><h2>ไฟล์แนบ (ไม่บังคับ)</h2>${attachmentFields()}</section><section class="apply-section apply-consent"><label class="check"><input type="checkbox" name="consent" required><span>ยินยอมให้ใช้ข้อมูลเพื่อการสรรหาและติดต่อกลับ <span class="req">*</span></span></label><p class="muted">ตรวจข้อมูลก่อนส่ง โดยเฉพาะเบอร์โทรศัพท์และหน่วยงานที่สมัคร</p><p class="error" data-error role="alert"></p><button class="primary apply-submit" type="submit">ส่งใบสมัคร →</button></section></form></div></main>`;
  applyDriverRequirements();
}
async function publicPage() {
  applyTicket = "";
  const { data: info, error } = await db.rpc("recruitment_public_info");
  if (error) throw Error("ยังไม่ได้ติดตั้งฐานข้อมูลการสมัคร");
  units = info.units;
  root.innerHTML = `${publicHeader()}<main class="apply-gate card"><div class="gate-icon" aria-hidden="true">↗</div><p class="section-label">สมัครงานออนไลน์</p><h1>สมัครงานกับเรา</h1>${info.open ? `<p class="muted">ขอ PIN 6 หลักจากฝ่าย HR<br>เพื่อเปิดแบบฟอร์มสมัครงาน</p><form id="apply-pin"><label>PIN จาก HR <span class="req">*</span><input class="pin-input" name="pin" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="••••••" required aria-describedby="pin-help"></label><p id="pin-help" class="muted">รหัสเปลี่ยนทุก 1 นาที หากรหัสหมดอายุให้ขอรหัสล่าสุดจาก HR</p><button class="primary apply-submit" type="submit">เปิดแบบฟอร์ม →</button><p class="error" data-error role="alert"></p></form><div class="gate-foot">ยืนยันแล้วกรอกต่อได้ 2 ชั่วโมง<br>รหัสที่เปลี่ยนจะไม่รบกวนใบสมัครที่กำลังกรอก</div>` : '<div class="notice">ขณะนี้ยังไม่เปิดรับสมัครออนไลน์ กรุณาติดต่อ HR</div>'}</main>`;
}
async function refreshApplicationPin() {
  const card = document.querySelector<HTMLElement>("#hr-application-pin");
  if (!card || !is("ADMIN","HR") || pinRefreshing) return;
  pinRefreshing = true;
  try {
    const {data,error} = await db.rpc("recruitment_application_pin");
    if (error) throw error;
    if (!card.isConnected) return;
    pinDeadline = Date.now() + Math.max(0, Date.parse(data.expires_at)-Date.parse(data.server_time));
    card.innerHTML = `<div><p class="section-label">PIN สำหรับผู้สมัคร</p><h2>แจ้งรหัสนี้ให้ผู้สมัครก่อนเปิดฟอร์ม</h2><p class="muted">ใช้เปิดฟอร์มเท่านั้น · เปลี่ยนอัตโนมัติทุกนาที</p></div><div class="hr-pin-value"><strong>${esc(data.pin)}</strong><small data-pin-countdown></small></div>`;
  } catch {
    card.innerHTML = `<p class="error">โหลด PIN ไม่สำเร็จ กำลังลองใหม่ กรุณารอรหัสล่าสุดก่อนแจ้งผู้สมัคร</p>`;
    pinDeadline = Date.now()+5000;
  } finally {pinRefreshing=false;}
}
setInterval(() => {
  const counter = document.querySelector("[data-pin-countdown]");
  if (counter) counter.textContent = `เปลี่ยนใน ${Math.max(0,Math.ceil((pinDeadline-Date.now())/1000))} วินาที`;
  if (document.querySelector("#hr-application-pin") && Date.now()>=pinDeadline) {
    const number = document.querySelector(".hr-pin-value strong");
    if(number) number.textContent = "••••••";
    void refreshApplicationPin();
  }
},1000);
async function openApplicant(id: string, requestedTab?: DetailTab) {
  const opening = !detail || detail.applicant.id !== id;
  const token = ++generation;
  const d = await rpc("detail", { id });
  if (token !== generation) return;
  detail = d;
  if (tabApplicantId !== id) selectedDetailTab = "general";
  tabApplicantId = id;
  if (requestedTab) selectedDetailTab = requestedTab;
  const a = d.applicant as Applicant;
  const manage = is("ADMIN", "HR");
  const ownManager = is("MANAGER") && (profile.all_units || profile.units.includes(a.hiring_unit));
  const owner = ownManager && a.owner_id === profile.id;
  const hired = ["HIRED", "STARTED"].includes(a.status);
  const evals = d.evaluations as Row[];
  const current = evals.find((e) => e.round === a.round);
  const canHandover = (manage || ownManager) && hired;
  const actions = [
    manage ? button("แก้ไขข้อมูลใบสมัคร", "edit-applicant")+button("เปลี่ยนหน่วยงาน", "change-unit") : "",
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
    current_job_status: "สถานะการทำงาน",
    fuel_type: "ประเภทเชื้อเพลิง",
    available_start_date: "พร้อมเริ่มงาน",
    availability_note: "ความพร้อม",
  };
  let body =
    head(
      is("COACH") ? "รายละเอียดพนักงาน" : "รายละเอียดผู้สมัคร",
      "ข้อมูลใบสมัครและการดำเนินการครบทุกขั้นตอน",
      button(screen === "dashboard" ? "← กลับงานที่ต้องทำ" : "← กลับรายการ", "back"),
      "Applicant Detail",
    ) +
    `<section class="card"><div class="detail-head"><div>${badge(a.status)}<p class="muted" style="margin-top:10px">สมัคร ${date(a.created_at)} · รอบสัมภาษณ์ ${a.round + 1}</p></div><div class="actions">${actions}</div></div><div class="keyvals"><div><small>หน่วยงานที่สมัครเดิม</small>${esc(a.original_unit)}</div><div><small>เบอร์โทร</small>${esc(a.phone)}</div><div><small>ผู้สัมภาษณ์</small>${esc(person(a.owner_id))}</div><div><small>คำขอที่ผูก</small>${a.slot_id ? "ผูกคำขอแล้ว" : "ยังไม่ผูก — ดำเนินการรับสมัครได้ตามปกติ"}</div></div>${manage ? `<div class="actions" style="margin-top:18px">${button("ผูก / ปลดคำขอคน", "match")}</div>` : ""}</section>`;
  if (d.duplicates.length && manage && ["HR_REVIEW","WAITING_INFO","INTERVIEW"].includes(a.status))
    body += `<div class="notice warn">พบใบสมัครที่อาจซ้ำ ${d.duplicates.map((x: Row) => esc(x.full_name) + " (" + esc(statuses[x.status]) + ")").join(", ")} กรุณาตรวจสอบและบันทึกเหตุผลก่อนส่งสัมภาษณ์</div>`;
  body += `<div class="split"><div>${
    manage &&
    ["HR_REVIEW", "WAITING_INFO", "INTERVIEW"].includes(a.status) &&
    !a.owner_id
      ? `<section class="card" data-detail-group="general"><h2>${a.status === "INTERVIEW" ? "ผลคัดกรอง / แก้ไขก่อนมีผู้รับงาน" : "HR คัดกรอง"}</h2><form id="screen"><div class="fields">${select(
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
    body += `<section class="card" data-detail-group="interview"><h2>สัมภาษณ์และรับเข้าทำงาน</h2>${ownManager && !a.owner_id ? button("รับงานสัมภาษณ์", "claim", "primary") : ""}${(owner || manage) && a.owner_id ? button("คืนงานสัมภาษณ์", "release-interview") : ""}${
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
          )}<div class="full notice"><small>ประเภทเชื้อเพลิง (จากใบสมัคร)</small><br><b>${esc(a.data.fuel_type || "ยังไม่ระบุในใบสมัคร")}</b></div>${note(current?.note)}</div><div class="actions"><button type="submit" name="mode" value="draft" formnovalidate>เก็บแบบร่าง</button><button type="submit" name="mode" value="submit" class="primary">ยืนยันผลสัมภาษณ์</button></div><p class="hint">ยืนยันผ่านแล้วรับเข้าทำงานทันที ไม่ต้องรอ HR ยืนยันซ้ำ</p><p class="error" data-error></p></form>`
        : `<p class="muted" style="margin-top:15px">${a.owner_id ? "ผู้รับงาน: " + esc(person(a.owner_id)) : "รอ Supervisor ในหน่วยงานนี้รับงาน"}</p>`
    }</section>`;
  const handoverComplete = !!(a.coach_id && a.supervisor_id && a.data.plate && a.data.fleet_type);
  if (canHandover)
    body += `<section class="card" data-detail-group="employment"><h2>ส่งมอบพนักงาน</h2><p class="${handoverComplete ? "muted" : "notice warn"}">${handoverComplete ? "บันทึกผู้ดูแลแล้ว" : "กรอกข้อมูลส่งมอบให้ครบก่อนให้ HR กำหนดเริ่มงาน"}</p><form id="handover"><div class="fields">${select("coach_id", "Driver Coach", peopleOpts("COACH", a.coach_id),true)}${select("supervisor_id", "Supervisor ผู้ดูแล", peopleOpts("MANAGER", a.supervisor_id, a.hiring_unit),true)}${field("plate", "ทะเบียนรถ", a.data.plate,true)}${select("fleet_type","ประเภทรถ",opts([{value:"COMPANY",label:"รถบริษัท"},{value:"PARTNER",label:"รถร่วม"}],a.data.fleet_type),true)}${note()}</div><button type="submit" class="primary">บันทึกผู้ดูแล</button><p class="error" data-error></p></form></section>`;
  if (hired && a.position === "DRIVER") {
    body += `<section class="card" data-detail-group="road"><h2>ผลทดลองขับโดย Driver Coach</h2><p class="muted">แยกจากผลสัมภาษณ์ บันทึกโดย Driver Coach ที่ได้รับมอบหมาย</p>${a.data.road_test_result ? `<p><b>${a.data.road_test_result === "PASS" ? "ผ่าน" : "ไม่ผ่าน"}</b> · ${date(a.data.road_test_date)} · ${esc(person(a.data.road_test_by))}</p><p>${esc(a.data.road_test_note)}</p>` : '<p class="muted">ยังไม่ได้บันทึกผลทดลองขับ</p>'}${is("COACH") && a.coach_id === profile.id ? `<form id="road-test"><div class="fields">${select("result","ผลทดลองขับ",opts([{value:"PASS",label:"ผ่าน"},{value:"FAIL",label:"ไม่ผ่าน"}],a.data.road_test_result),true)}${dates("test_date","วันที่ทดลองขับ",a.data.road_test_date || today(),true)}${note(a.data.road_test_note)}</div><button class="primary" type="submit">บันทึกผลทดลองขับ</button><p class="error" data-error></p></form>` : ""}</section>`;
  }
  if (hired) {
    body += `<section class="card" data-detail-group="employment"><h2>เริ่มงาน / สถานะพนักงาน</h2>${is("HR") ? `${!handoverComplete ? '<p class="notice warn">บันทึกส่งมอบพนักงานให้ครบก่อน</p>' : !a.scheduled_start_date ? '<p class="notice">บันทึกกำหนดเริ่มงานก่อน แล้วจึงกรอกวันเริ่มงานจริงได้</p>' : ''}<form id="employment"><fieldset class="workflow-fields" ${handoverComplete ? "" : "disabled"}><div class="fields">${dates("scheduled_start_date","กำหนดเริ่มงาน",a.scheduled_start_date,true)}${dates("actual_start_date","วันเริ่มงานจริง",a.actual_start_date).replace('data-date',`data-date ${a.scheduled_start_date || a.actual_start_date ? '' : 'disabled'}`)}${dates("resignation_date","วันลาออก",a.resignation_date).replace('data-date',`data-date ${a.actual_start_date ? '' : 'disabled'}`)}${note("",false,"หมายเหตุ (บังคับเมื่อลาออก)")}</div><div class="actions"><button type="submit" class="primary">บันทึกการทำงาน</button>${a.status === "HIRED" && a.scheduled_start_date && !a.actual_start_date ? `<button type="button" class="danger" data-action="no-show" ${a.scheduled_start_date > today() ? 'disabled title="บันทึกได้เมื่อถึงกำหนดเริ่มงาน"' : ''}>ไม่มาเริ่มงาน</button>` : ''}</div></fieldset><p class="error" data-error></p></form>` : `<p class="muted">ส่วนนี้บันทึกได้เฉพาะ HR</p><div class="keyvals"><div><small>กำหนดเริ่มงาน</small>${date(a.scheduled_start_date)}</div><div><small>วันเริ่มงานจริง</small>${date(a.actual_start_date)}</div></div>`}</section>`;
  }
  if (a.status === "STARTED") {
    const allowed = topics.filter(
      (t) =>
        (!t.unit || t.unit === a.hiring_unit) &&
        (!t.position || t.position === a.position) &&
        Object.hasOwn(categories,t.category) && canTrain(profile.role, profile.units, a, profile.id, t.category, !!profile.all_units),
    );
    body += `<section class="card" data-detail-group="training"><h2>การอบรม</h2>${
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
        : `<p class="muted">${is("HR","MANAGER") ? "ยังไม่มีหัวข้อประเภทใหม่ที่ตรงกับพนักงานนี้ กรุณาเพิ่มหัวข้ออบรม" : "บันทึกอบรมได้เฉพาะ HR และ Supervisor ในหน่วยงาน"}</p>`
    }${is("HR","MANAGER") ? button("+ เพิ่มหัวข้ออบรม", "new-topic") : ""}<div class="table-wrap"><table><thead><tr><th>หัวข้อ</th><th>วันที่</th><th>ผล</th><th></th></tr></thead><tbody>${d.training.map((tr: Row) => `<tr><td>${esc(tr.title)}<small class="table-secondary">${categories[tr.category] || "ประเภทเดิม"} · ${esc(tr.note)}</small></td><td>${date(tr.training_date)}</td><td>${tr.result === "PASS" ? "ผ่าน" : "ไม่ผ่าน"}</td><td>${Object.hasOwn(categories,tr.category) && canTrain(profile.role, profile.units, a, profile.id, tr.category, !!profile.all_units) ? `<button data-training="${tr.id}">แก้ไข</button>` : ""}</td></tr>`).join("")}</tbody></table></div></section>`;
  }
  body += `<section class="card" data-detail-group="history"><h2>ประวัติการดำเนินการ</h2>${d.activities.map((e: Row) => `<div class="timeline"><small>${date(e.created_at)} · ${esc(e.display_name || "ผู้สมัคร")}</small><p><b>${esc(actionLabel(e.action))}</b></p><div>${correctionHistory(e.note)}</div></div>`).join("")}</section></div><div>${personalSummary(a)}${hired ? `<section class="card" data-detail-group="employment"><h2>ข้อมูลดูแลพนักงาน</h2><div class="keyvals"><div><small>Coach</small>${esc(person(a.coach_id))}</div><div><small>Supervisor</small>${esc(person(a.supervisor_id))}</div><div><small>ทะเบียน / รถ</small>${esc(a.data.plate || "—")} / ${fleet(a.data.fleet_type)}</div><div><small>เริ่มงานจริง</small>${date(a.actual_start_date)}</div><div><small>สถานะงาน</small>${a.employment_status === "RESIGNED" ? "ลาออก" : a.employment_status === "ACTIVE" ? "ทำงานอยู่" : "รอเริ่มงาน"}</div><div><small>ลาออก</small>${date(a.resignation_date)}</div></div></section>` : ""}${evals.length ? `<section class="card" data-detail-group="history"><h2>ประวัติสัมภาษณ์</h2>${evals.map((e) => `<div class="slot"><b>รอบ ${e.round + 1} · ${e.stage === "DRAFT" ? "แบบร่าง" : e.result === "PASS" ? "ผ่าน" : "ไม่ผ่าน"}</b><p>คะแนน ${e.score || "—"}</p><p>ประเภทเชื้อเพลิง ${esc(e.fuel || "—")}</p><p>${esc(e.note)}</p><small>${esc(person(e.evaluator_id))} · ${date(e.updated_at)}</small></div>`).join("")}</section>` : ""}${attachmentsEnabled ? `<section class="card" data-detail-group="documents"><h2>เอกสารแนบ</h2><p class="muted">รูปภาพแสดงอัตโนมัติ · JPG, PNG และ PDF ไม่เกิน 10 MB/ไฟล์</p>${is('ADMIN','HR')?`<form id="upload">${attachmentFields()}<button type="submit" class="primary">แนบไฟล์เพิ่ม</button><p class="error" data-error></p></form>`:''}<div data-upload-job="${a.id}"></div><div data-drive-panel="${a.id}" aria-live="polite">กำลังโหลดเอกสาร…</div></section>`:''}</div></div>`;
  shell(body);
  organizeApplicant(a, handoverComplete);
  if(attachmentsEnabled){renderUploadJob(a.id);void refreshDocuments(a.id);}
  if(opening)window.scrollTo({top:0});
  dynamicRequirements();
}
function selectDetailTab(tab: DetailTab, focus = false) {
  const target=root.querySelector<HTMLButtonElement>(`[data-detail-tab="${tab}"]`);
  if(!target) return;
  selectedDetailTab=tab;
  root.querySelectorAll<HTMLElement>("[data-detail-panel]").forEach(p=>p.hidden=p.dataset.detailPanel!==tab);
  root.querySelectorAll<HTMLButtonElement>("[data-detail-tab]").forEach(b=>{const active=b===target;b.setAttribute("aria-selected",String(active));b.tabIndex=active?0:-1;});
  if(focus)target.focus();
}
function organizeApplicant(a: Applicant, handoverComplete: boolean) {
  const content=root.querySelector("main.content")!;
  const sections=Array.from(content.querySelectorAll<HTMLElement>("[data-detail-group]"));
  const holder=document.createElement("section");holder.className="detail-workspace surface";
  const groups=new Set(sections.map(s=>s.dataset.detailGroup));
  const visibleTabs=detailTabs.filter(t=>groups.has(t.id));
  holder.innerHTML=`<div class="detail-tabs" role="tablist" aria-label="ข้อมูลผู้สมัคร">${visibleTabs.map(t=>`<button type="button" role="tab" id="detail-tab-${t.id}" aria-controls="detail-panel-${t.id}" data-detail-tab="${t.id}" aria-selected="false" tabindex="-1">${t.label}</button>`).join('')}</div>${visibleTabs.map(t=>`<div role="tabpanel" id="detail-panel-${t.id}" aria-labelledby="detail-tab-${t.id}" data-detail-panel="${t.id}" tabindex="0" hidden></div>`).join('')}`;
  for(const section of sections) holder.querySelector(`[data-detail-panel="${section.dataset.detailGroup}"]`)!.append(section);
  const summary=holder.querySelector(".personal-summary");
  if(summary)holder.querySelector('[data-detail-panel="general"]')?.prepend(summary);
  content.querySelectorAll(":scope > .split").forEach(s=>s.remove());
  content.append(holder);
  const employmentPanel=holder.querySelector('[data-detail-panel="employment"]');
  if(employmentPanel)employmentPanel.insertAdjacentHTML("afterbegin",`<section class="card"><h2>สรุปการเริ่มงาน</h2><div class="keyvals"><div><small>กำหนดเริ่มงาน</small>${date(a.scheduled_start_date)}</div><div><small>วันเริ่มงานจริง</small>${date(a.actual_start_date)}</div><div><small>สถานะการทำงาน</small>${a.employment_status==='ACTIVE'?'ทำงานอยู่':a.employment_status==='RESIGNED'?'ลาออก':'รอเริ่มงาน'}</div><div><small>การส่งมอบ</small>${handoverComplete?'ข้อมูลครบแล้ว':'ยังไม่ครบ'}</div></div></section>`);
  const header=content.querySelector('.topbar');
  header?.insertAdjacentHTML("beforebegin",`<nav class="breadcrumb" aria-label="ตำแหน่งปัจจุบัน"><button type="button" data-action="back">${screen==='dashboard'?'งานที่ต้องทำ':screen==='training'?'การอบรม':is("COACH")?'พนักงาน':'รายการผู้สมัคร'}</button><span aria-hidden="true">›</span><span>${esc(a.full_name)}</span></nav>`);
  const available=Array.from(content.querySelectorAll<HTMLButtonElement>("[data-workflow],[data-action]")).filter(b=>!b.disabled).map(b=>b.dataset.workflow||b.dataset.action||"");
  if(!handoverComplete)available.push("handover-incomplete");
  const next=nextTask(a,available);
  const progress=progressState(a);
  const overview=content.querySelector<HTMLElement>(":scope > .card");
  overview?.classList.add("applicant-overview");
  if(overview){
    const controls=overview.querySelector('.detail-head .actions')?.innerHTML||"";
    const matching=overview.querySelector('[data-action="match"]')?.outerHTML||"";
    overview.innerHTML=`<div class="detail-head"><div class="identity-hero"><div class="identity-avatar">${navIcons.applicants}</div><div><h2>${esc(a.full_name)}</h2><div class="identity-badges"><span class="reference-code">${esc(applicantCode(a))}</span>${workflowBadge(a)}${!is('COACH')?ageBadge(ageOnDate(a.data.birth_date,today()),a.position):''}</div></div></div><div class="identity-side"><small>สมัครเมื่อ ${date(a.created_at)}</small><div class="actions">${controls}${matching}</div></div></div><div class="identity-meta"><span>${navIcons.applicants} ${position(a.position)}</span><span>${navIcons.requests} ${esc(a.hiring_unit)}</span><span>${icon('<path d="M2 6h12v11H2zM14 10h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>')} ${esc(a.data.vehicle_type||'—')}</span><span>${esc(a.phone)}</span></div>`;
  }
  const secondaryActions=overview?.querySelector<HTMLElement>(".detail-head .actions");
  if(secondaryActions?.children.length) {
    const fold=document.createElement("details");fold.className="case-actions";
    fold.innerHTML='<summary>จัดการใบสมัคร</summary>';
    const danger=secondaryActions.querySelector<HTMLButtonElement>('button.danger');
    if(danger)secondaryActions.append(danger);
    secondaryActions.before(fold);fold.append(secondaryActions);
  }
  overview?.insertAdjacentHTML("beforeend",`<ol class="recruitment-steps" aria-label="ความคืบหน้าการสมัคร">${progress.labels.map((label,i)=>`<li class="${progress.paused?(i===0?'done':'') : i<progress.current?'done':i===progress.current?'current':''}" ${i===progress.current?'aria-current="step"':''}><span>${!progress.paused&&i<progress.current?'✓':i+1}</span><small>${label}</small></li>`).join('')}</ol>${progress.paused?`<p class="hint">สถานะปัจจุบัน: ${esc(statuses[a.status])} · แถบขั้นตอนไม่ใช่ผลการรับเข้าทำงาน</p>`:''}`);
  const w=workflowSummary(a,today(),person);
  const latest=(detail?.activities as Row[]|undefined)?.slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||Number(b.id)-Number(a.id))[0];
  const nextCard=document.createElement("section");nextCard.className="case-summary card";
  nextCard.innerHTML=`<div class="case-summary-heading"><div><p class="section-label">${esc(a.full_name)} · ขั้นตอนปัจจุบัน</p><h2>${esc(w.label)}</h2></div></div><div class="case-summary-grid"><div><small>รอผู้รับผิดชอบ</small><b>${esc(w.waiting)}</b></div><div><small>${w.dateLabel}</small><b class="${w.late?'text-danger':''}">${date(w.nextDate)}${w.late?' · เลยกำหนด':''}</b></div><div><small>สิ่งที่รอ / เหตุผล</small><span>${esc(w.reason)}</span></div></div><div class="case-summary-footer"><p class="muted">ล่าสุด: ${latest?`${esc(actionLabel(latest.action))} · ${esc(latest.display_name||'ผู้สมัคร')} · ${date(latest.created_at)}`:`รับใบสมัคร · ${date(a.created_at)}`}</p><div class="case-next-action"><p>${esc(next.hint)}</p>${next.label?`<button class="primary" type="button" data-next-target="${next.target}" data-next-tab="${next.tab}">${next.label} →</button>`:`<button type="button" data-detail-tab="${w.tab}">ดู${w.tab==='history'?'ประวัติ':'รายละเอียด'} →</button>`}</div></div>`;
  if(overview)overview.before(nextCard);else holder.before(nextCard);
  selectDetailTab(visibleTabs.some(t=>t.id===selectedDetailTab)?selectedDetailTab:visibleTabs[0]!.id);
}

function actionLabel(a: string) {
  if(a === "DRIVE_DOCUMENT_ADDED")return "แนบเอกสารใน Google Drive";
  return (
    (
      {
        APPLIED: "รับใบสมัคร",
        SCREEN: "คัดกรอง HR",
        CLAIM: "รับงานสัมภาษณ์",
        RELEASE_INTERVIEW: "คืนคิวสัมภาษณ์",
        INTERVIEW: "บันทึกผลสัมภาษณ์",
        MATCH: "เปลี่ยนการผูกคำขอ",
        EDIT_APPLICANT: "แก้ไขข้อมูล / หน่วยงาน",CORRECT_APPLICANT:"แก้ไขข้อมูลใบสมัคร",CHANGE_UNIT:"เปลี่ยนหน่วยงานที่รับจริง",REQUEST_UNLINKED_V412:"ปลดการผูกคำขอ",
        RESERVE: "เก็บเป็นผู้สมัครสำรอง",
        RECALL: "เรียกผู้สมัครกลับ",
        HANDOVER: "ส่งมอบผู้ดูแล",
        EMPLOYMENT: "ปรับสถานะการทำงาน",
        NO_SHOW: "ไม่มาเริ่มงาน",
        ROAD_TEST: "ผลทดลองขับโดย Driver Coach",
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
const requestEditLabels:Record<string,string>={title:'หัวข้อคำขอ',unit:'หน่วยงาน',notes:'หมายเหตุ',plate:'ทะเบียนรถ',fleet_type:'ประเภทรถ',position:'ตำแหน่ง',status:'สถานะ'};
function requestValue(k:string,v:unknown){if(v===undefined||v===null||v==='')return '—';if(k==='fleet_type')return fleet(v);if(k==='position')return position(v);if(k==='status')return ({OPEN:'ว่าง',MATCHED:'ผูกผู้สมัคร',FILLED:'รับผ่านแล้ว',CANCELLED:'ยกเลิก'} as Record<string,string>)[String(v)]||String(v||'—');return String(v||'—');}
function requestDiff(before:Row,after:Row){const keys=Array.from(new Set([...Object.keys(before||{}),...Object.keys(after||{})])).filter(k=>before?.[k]!==after?.[k]);return `<div class="table-wrap"><table data-numbered="true"><thead><tr><th>ลำดับ</th><th>ข้อมูล</th><th>ก่อนแก้</th><th>หลังแก้</th></tr></thead><tbody>${keys.map((k,i)=>`<tr><td>${i+1}</td><td>${esc(requestEditLabels[k]||k)}</td><td>${esc(requestValue(k,before?.[k]))}</td><td>${esc(requestValue(k,after?.[k]))}</td></tr>`).join('')}</tbody></table></div>`;}
function requestFields(s?:Row){return `<div class="fields">${field('plate','ทะเบียนรถ',s?.plate||'',true,'text','maxlength="50"')}${select('fleet_type','ประเภทรถ',opts([{value:'COMPANY',label:'รถบริษัท'},{value:'PARTNER',label:'รถร่วม'}],s?.fleet_type||'COMPANY'),true)}${select('position','ตำแหน่ง',opts([{value:'DRIVER',label:'พนักงานขับรถ'},{value:'HELPER',label:'เด็กติดรถ'}],s?.position||'DRIVER'),true)}</div>`;}
async function openRequestEditor(action:string,id:string,slotId?:string){
 const fresh=await rpc('requests') as Row[];const r=fresh.find(x=>x.id===id);if(!r)throw Error('ไม่พบคำขอหรือไม่มีสิทธิ์');const slot=slotId?r.slots.find((x:Row)=>x.id===slotId):null;if(slotId&&!slot)throw Error('ไม่พบอัตราหรือข้อมูลเปลี่ยนแล้ว');
 if(action==='request_history'){
  const history=await rpc('request_history',{request_id:id}) as Row[];
  openModal('ประวัติแก้ไขคำขอ',history.length?history.map(x=>{let v:Row;try{v=JSON.parse(x.note)}catch{return ''};return `<div class="timeline"><small>${date(x.created_at)} ${new Date(x.created_at).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'})} · ${esc(x.display_name||'ผู้ใช้งาน')}</small><p><b>${esc(v.action)}</b> · ${esc(v.reason)}</p>${requestDiff(v.before,v.after)}${v.detached_count?`<small>ปลดผู้สมัคร ${Number(v.detached_count)} รายการ</small>`:''}</div>`}).join(''):'<p>ยังไม่มีประวัติการแก้ไข</p>');return;
 }
 const base={request_id:id,request_version:r.version,...(slot?{slot_id:slot.id,slot_version:slot.version}:{})};requestEditPending={action,payload:base};
 const title=({edit_request:'แก้ไขคำขอ',edit_request_slot:'แก้ไขอัตรา',add_request_slot:'เพิ่มอัตรา',cancel_request_slot:'ยกเลิกอัตรา',restore_request_slot:'คืนอัตราที่ถูกยกเลิก'} as Record<string,string>)[action];
 let body='';
 if(action==='edit_request')body=`<div class="fields">${select('title','หัวข้อคำขอ',opts(['ทดแทนอัตรากำลังเดิม','ขออัตรากำลังเพิ่ม'].map(value=>({value,label:value})),r.title),true)}${select('unit','หน่วยงาน',unitOpts(r.unit,is('MANAGER')&&!profile.all_units?profile.units:units),true)}<label class="full">หมายเหตุคำขอ<textarea name="notes" maxlength="5000">${esc(r.notes||'')}</textarea></label></div>`;
 else if(action==='edit_request_slot'||action==='add_request_slot')body=requestFields(slot);
 else body=`<p>ทะเบียน <b>${esc(slot.plate)}</b> · ${esc(position(slot.position))} · ${esc(fleet(slot.fleet_type))}</p>`;
 openModal(title||'แก้ไขคำขอ',`${body}<div class="fields">${note('',true,'เหตุผลที่แก้ไข')}</div>`,'request-change');
 const submit=modal.querySelector<HTMLButtonElement>('button[type=submit]');if(submit)submit.textContent='ตรวจสอบผลกระทบ →';
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
          `<section class="card"><div class="detail-head"><div><h2>${esc(r.title)}</h2><p class="muted">${esc(r.unit)} · ขอ ${date(r.created_at)} โดย ${esc(person(r.created_by))}</p></div><div>${r.received_at ? `<span class="badge">HR รับ ${date(r.received_at)}</span>` : is("ADMIN", "HR") ? `<button data-receive="${r.id}" data-version="${r.version}" class="primary">รับเรื่อง</button>` : '<span class="badge warn">รอ HR รับเรื่อง</span>'}</div></div><p>${esc(r.notes)}</p><div class="actions request-actions"><button data-request-edit="${r.id}">แก้ไขคำขอ</button><button data-request-add="${r.id}">+ เพิ่มอัตรา</button><button data-request-history="${r.id}">ประวัติแก้ไข</button></div><div class="table-wrap"><table><thead><tr><th>ทะเบียน</th><th>รถ</th><th>ตำแหน่ง</th><th>สถานะ</th><th>ยืนยันรับคน</th><th></th></tr></thead><tbody>${r.slots.map((s: Row) => `<tr><td>${esc(s.plate)}</td><td>${fleet(s.fleet_type)}</td><td>${position(s.position)}</td><td>${({ OPEN: "ว่าง", MATCHED: "ผูกผู้สมัคร", FILLED: "รับผ่านแล้ว", CANCELLED: "ยกเลิก" } as Record<string, string>)[s.status]}</td><td>${date(s.filled_at)}</td><td>${s.applicant_id ? `<button data-open="${s.applicant_id}">ดูผู้สมัคร</button>` : ""}<button data-request-slot="${r.id}" data-slot-id="${s.id}">แก้ไข</button>${s.status === "CANCELLED" ? `<button data-request-restore="${r.id}" data-slot-id="${s.id}">คืนอัตรา</button>` : `<button data-request-cancel="${r.id}" data-slot-id="${s.id}" class="danger">ยกเลิกอัตรา</button>`}</td></tr>`).join("")}</tbody></table></div></section>`,
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
  const events = ((await rpc("activities")) as Row[]).sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)) || Number(b.id)-Number(a.id)).slice(0,10);
  return (
    head(
      "ตั้งค่าระบบ",
      "สิทธิ์จะตรวจจากฐานข้อมูลทุกครั้ง การเปลี่ยนบทบาทมีผลกับคำสั่งถัดไปทันที",
    ) +
    `<section class="card"><h2>ผู้ใช้งาน</h2><p class="muted">สร้างบัญชีที่ Supabase → Authentication → Users ก่อน แล้วเพิ่มสิทธิ์ที่นี่ ไม่มีการเก็บรหัสผ่านในตารางระบบ</p>${button("+ เพิ่มสิทธิ์ผู้ใช้", "new-profile", "primary")}<div class="table-wrap"><table><thead><tr><th>ชื่อ / อีเมล</th><th>บทบาท</th><th>หน่วยงาน</th><th>สถานะ</th><th></th></tr></thead><tbody>${profiles.map((p) => `<tr><td>${esc(p.display_name)}<small class="table-secondary">${esc(p.email)}</small></td><td>${roles[p.role]}</td><td>${esc(p.role === "MANAGER" && p.all_units ? "ทุกหน่วยงาน (สิทธิ์พิเศษ)" : p.units.join(", ") || (p.role === "MANAGER" ? "ยังไม่กำหนดหน่วยงาน" : "ตามบทบาท"))}</td><td>${p.active ? "เปิด" : "ปิด"}</td><td><button data-profile="${p.id}">แก้ไข</button><script type="application/json" id="profile-${p.id}">${JSON.stringify(p).replace(/</g, "\\u003c")}</script></td></tr>`).join("")}</tbody></table></div></section><div class="split"><section class="card"><h2>การรับสมัครออนไลน์</h2><p class="muted">กำหนดสถานะรับสมัคร ผู้สมัครเข้าผ่านแบบฟอร์มของระบบและใช้ PIN จาก HR</p><div class="recruitment-status"><span class="badge ${settings.public_apply ? "" : "neutral"}">${settings.public_apply ? "เปิดรับสมัคร" : "ปิดรับสมัคร"}</span></div><form id="settings"><div class="fields full">${select(
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
    )}</div><p class="hint">เมื่อปิดรับสมัคร จะไม่สามารถส่งใบสมัครออนไลน์ใหม่ได้</p><div class="actions form-footer"><button type="submit" class="primary">บันทึกตั้งค่า</button>${button("ยกเลิก", "close-modal")}</div><p class="error" data-error></p></form></section><section class="card"><h2>หน่วยงาน</h2><div class="actions unit-list">${units.map((x) => `<span class="badge">${esc(x)}</span>`).join("")}</div><form id="unit" style="margin-top:20px">${field("name", "ชื่อหน่วยงานใหม่", "", true, "text", 'maxlength="120"')}<button type="submit" style="margin-top:12px">เพิ่มหน่วยงาน</button><p class="error" data-error></p></form><hr><h2>สำรองและรีเซ็ตข้อมูล</h2><p class="muted">ล้างใบสมัคร คำขอ ผลสัมภาษณ์ ผลอบรมและประวัติ คงบัญชี หน่วยงาน หัวข้ออบรมและตั้งค่าไว้ ต้องไม่มีเอกสารแนบ</p><div class="actions">${button("ดาวน์โหลดสำรองข้อมูล", "backup")}${button("ตรวจรายการก่อนรีเซ็ต", "reset-preview", "danger")}</div></section></div><section class="card"><h2>ประวัติระบบล่าสุด</h2><p class="muted">แสดง 10 รายการล่าสุด</p><div class="table-wrap"><table><thead><tr><th>วันที่</th><th>ผู้ดำเนินการ</th><th>รายการ</th><th>บันทึก</th></tr></thead><tbody>${events.map((e) => `<tr><td>${date(e.created_at)}</td><td>${esc(e.display_name || "ผู้สมัคร")}</td><td>${esc(actionLabel(e.action))}</td><td>${esc(e.note)}</td></tr>`).join("")}</tbody></table></div></section>`
  );
}
function guide() {
 return head("วิธีใช้งาน","เริ่มจากภาพรวม แล้วเปิดรายการเพื่อทำขั้นตอนถัดไป")+`<section class="card"><h2>โฟลวหลัก</h2><div class="flow"><span>ใบสมัคร</span>→<span>HR ตรวจ</span>→<span>Supervisor สัมภาษณ์</span>→<span>ส่งมอบ</span>→<span>HR กำหนด / เริ่มงาน</span>→<span>อบรม</span></div><p>HR รับผู้สมัครได้โดยไม่ต้องรอคำขอคน หัวข้อคำขอเลือก ทดแทนอัตรากำลังเดิม หรือ ขออัตรากำลังเพิ่ม</p></section><section class="card"><h2>บทบาทและสิทธิ์</h2><div class="table-wrap"><table><thead><tr><th>บทบาท</th><th>งานหลัก</th><th>ขอบเขต</th></tr></thead><tbody><tr><td>Admin</td><td>จัดผู้ใช้ หน่วยงาน และตั้งค่าระบบ</td><td>ทุกหน่วยงาน ยืนยันสัมภาษณ์แทน Supervisor และเริ่มงานแทน HR ไม่ได้</td></tr><tr><td>HR</td><td>คัดกรอง ติดต่อ ส่งมอบ กำหนดและบันทึกเริ่มงาน / ไม่มาเริ่มงาน อบรม</td><td>ทุกหน่วยงาน</td></tr><tr><td>Supervisor</td><td>ขอคน สัมภาษณ์ ส่งมอบ และอบรม</td><td>เฉพาะหน่วยงานที่รับผิดชอบ หรือทุกหน่วยงานเมื่อ Admin เปิดสิทธิ์พิเศษ</td></tr><tr><td>Driver Coach</td><td>บันทึกผลทดลองขับพร้อมวันที่</td><td>ดูพนักงานที่รับแล้ว บันทึกทดลองขับเฉพาะผู้ที่มอบหมายให้ตนเอง</td></tr></tbody></table></div></section><section class="card"><h2>ข้อควรทราบ</h2><p>วันที่ใช้ dd/mm/yyyy (ค.ศ.) เลือกปฏิทินหรือพิมพ์ได้ ช่อง * สีแดงจำเป็นต้องกรอก ประเภทเชื้อเพลิงอ่านจากใบสมัคร</p><p>สัมภาษณ์ผ่าน → ส่งมอบให้ครบ → HR บันทึกกำหนดเริ่มงาน → บันทึกวันจริงหรือไม่มาเริ่มงาน อบรมบันทึกหลังเริ่มงานโดย HR หรือ Supervisor</p><p>KPI 14 วันนับคนขับ ตั้งแต่ HR รับคำขอถึงยืนยันผ่าน ส่วน KPI 90 วันนับผู้เริ่มงานใน 90 วันล่าสุดที่ยังทำงาน ไม่รวมผลอบรม</p></section>`;
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
    )}${select("all_units","สิทธิ์พิเศษ Supervisor",opts([{value:"false",label:"เฉพาะหน่วยงานที่รับผิดชอบ"},{value:"true",label:"ดูและทำงานได้ทุกหน่วยงาน"}],String(p?.all_units ?? false)),true)}<label class="full">หน่วยงานที่รับผิดชอบ<select name="units" multiple size="4">${units.map((x) => `<option value="${esc(x)}" ${p?.units.includes(x) ? "selected" : ""}>${esc(x)}</option>`).join("")}</select><small>เลือกหลายรายการด้วย Cmd / Ctrl</small></label><input type="hidden" name="version" value="${p?.version || 0}"></div>`,
    "profile",
  );
  profileRequirements();
}
function profileRequirements() {
  const form=modal.querySelector<HTMLFormElement>("#profile");
  if(!form)return;
  const role=form.elements.namedItem("role") as HTMLSelectElement;
  const all=form.elements.namedItem("all_units") as HTMLSelectElement;
  const assigned=form.elements.namedItem("units") as HTMLSelectElement;
  all.disabled=role.value!=="MANAGER";
  if(all.disabled)all.value="false";
  const required=role.value==="MANAGER" && all.value!=="true";
  assigned.required=required;
  const label=assigned.closest("label")!;
  label.querySelector(".req")?.remove();
  if(required){const star=document.createElement("span");star.className="req";star.textContent="*";label.insertBefore(star,assigned);}
}
function topicModal() {
  if (!is("HR","MANAGER")) throw Error("เฉพาะ HR และ Supervisor");
  const cat = "CUSTOMER";
  openModal(
    "เพิ่มหัวข้ออบรม",
    `<div class="fields">${field("title", "หัวข้อ", "", true, "text", 'maxlength="200"')}${select(
      "category",
      "ประเภท",
      opts(
        Object.entries(categories)
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
    )}${select("unit", "หน่วยงาน", unitOpts("", is("MANAGER") && !profile.all_units ? profile.units : units), is("MANAGER"))}</div>`,
    "topic",
  );
}
let pendingCorrection:{mode:string;payload:Row}|null=null;
function correctionChanges(changes:Row[]):string{return `<div class="table-wrap"><table data-numbered="true"><thead><tr><th>ลำดับ</th><th>ข้อมูล</th><th>ก่อนแก้</th><th>หลังแก้</th></tr></thead><tbody>${changes.map((c,i)=>`<tr><td>${i+1}</td><td>${esc(correctionLabels[c.field]||c.field)}</td><td>${esc(correctionValue(c.field,c.before))}</td><td>${esc(correctionValue(c.field,c.after))}</td></tr>`).join('')}</tbody></table></div>`;}
function correctionHistory(value:string):string{const audit=correctionAudit(value);return audit?`${esc(audit.reason||'แก้ข้อมูลทั่วไป')}${audit.age_review?'<br>ทบทวนเกณฑ์อายุแล้ว':''}${correctionChanges(audit.changes)}`:esc(value);}
function correctionPositionRequirements(){const form=modal.querySelector<HTMLFormElement>('#correction-fields');const pos=form?.elements.namedItem('position') as HTMLSelectElement|null;if(!form||!pos)return;for(const name of ['vehicle_type','license_type','driver_license_no']){const input=form.elements.namedItem(name) as HTMLInputElement;input.required=pos.value==='DRIVER';const label=input.closest('label')!;label.querySelector('.req')?.remove();if(input.required)input.insertAdjacentHTML('beforebegin','<span class="req">*</span>');}}
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
  if (action === "toggle-menu") {
    const sidebar = root.querySelector(".sidebar")!;
    const open = sidebar.classList.toggle("mobile-open");
    sidebar.querySelector(".mobile-menu")?.setAttribute("aria-expanded",String(open));
    return;
  }
  if (["admin-workspace","coach-workspace"].includes(action)) {
    screen = action === "admin-workspace" ? "admin" : "applicants";
    filters = blankFilters(); await render(); return;
  }
  if (action === "clear-filters") {filters=blankFilters();await render();return;}
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
    openModal("เพิ่มผู้สมัคร", profileFields()+attachmentFields(), "new-applicant");
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
      `<div class="fields">${select("title", "หัวข้อคำขอ", opts(["ทดแทนอัตรากำลังเดิม","ขออัตรากำลังเพิ่ม"].map(value=>({value,label:value}))),true)}${select("unit", "หน่วยงาน", unitOpts("", is("MANAGER") && !profile.all_units ? profile.units : units), true)}${note()}</div><h3>ทะเบียนและอัตราที่ต้องการ</h3><div id="request-lines"></div>${button("+ เพิ่มทะเบียน / อัตรา", "add-line")}<p class="hint">คนขับและเด็กติดรถแยกคนละรายการ (KPI นับเฉพาะคนขับ)</p>`,
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
    openModal('แก้ไขข้อมูลใบสมัคร',`<p class="muted">เลือกหมวดที่ต้องการแก้ ข้อมูลในหมวดอื่นและผลการดำเนินการจะคงเดิม</p><div class="correction-menu">${correctionSections.filter(x=>x.id!=='position'||(['HR_REVIEW','WAITING_INFO'].includes(a.status)&&!a.owner_id&&!a.slot_id)).map(x=>button(x.title,'correction-'+x.id)).join('')}</div>`);return;
  }
  if(action.startsWith('correction-')){
    const section=correctionSections.find(x=>x.id===action.slice(11));if(!section)return;
    const template=document.createElement('template');template.innerHTML=profileFields(a);
    const labels=Array.from(template.content.querySelectorAll<HTMLLabelElement>('label')).filter(label=>section.fields.includes(label.querySelector<HTMLInputElement|HTMLSelectElement>('input,select,textarea')?.name||''));
    openModal(section.title,`<p class="hint">แก้เฉพาะข้อมูลที่ตรวจสอบแล้ว ขั้นตอนถัดไปจะแสดงค่าก่อนและหลังให้ตรวจอีกครั้ง</p><div class="fields">${labels.map(l=>l.outerHTML).join('')}</div>`,'correction-fields');
    modal.querySelector<HTMLFormElement>('#correction-fields')!.dataset.mode='correct_applicant';
    for(const name of ['id_issued_at','id_expires_at','current_job_status','available_start_date','cargo_types','other_cargo_note']){const input=modal.querySelector<HTMLInputElement>(`[name="${name}"]`);if(input?.value){input.required=true;if(!input.closest('label')?.querySelector('.req'))input.insertAdjacentHTML('beforebegin','<span class="req">*</span>');}}
    const submit=modal.querySelector<HTMLButtonElement>('button[type=submit]');if(submit)submit.textContent='ตรวจสอบการเปลี่ยนแปลง →';
    if(section.id==='position')correctionPositionRequirements();return;
  }
  if(action==='change-unit'){
    openModal('เปลี่ยนหน่วยงานที่รับจริง',`<p>หน่วยงานเดิมที่สมัคร: <b>${esc(a.original_unit)}</b> · รับจริงปัจจุบัน: <b>${esc(a.hiring_unit)}</b></p><div class="notice warn">ระบบจะปลดคำขอรถ ผู้สัมภาษณ์ ผู้ดูแล Coach และทะเบียนรถเดิม หากกำลังสัมภาษณ์จะกลับให้ HR คัดกรองใหม่ ประวัติผลที่บันทึกแล้ว วันเริ่มงาน และโฟลเดอร์เอกสารยังคงอยู่</div><div class="fields">${select('unit','หน่วยงานใหม่',unitOpts(a.hiring_unit),true)}${note('',true,'เหตุผลเปลี่ยนหน่วยงาน')}</div>`,'correction-fields');
    modal.querySelector<HTMLFormElement>('#correction-fields')!.dataset.mode='change_unit';return;
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
  if (action === "no-show") {
    if (!is("HR")) throw Error("เฉพาะ HR");
    openModal("ไม่มาเริ่มงาน",`<p class="notice">กำหนดเริ่มงาน ${date(a.scheduled_start_date)} · ระบบจะปลดคำขอคนที่ผูกไว้</p><div class="fields">${note("",true,"เหตุผล / รายละเอียดที่ติดต่อผู้สมัคร")}</div>`,"no-show");
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
      )}${note("", true)}</div><p class="hint">กลับเข้า HR ตรวจ และให้ Supervisor ยืนยันผลรอบใหม่</p>`,
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
document.addEventListener("keydown",e=>{
 if(e.key==='Escape') {
  const menu=root.querySelector<HTMLDetailsElement>('.case-actions[open]');
  if(menu){menu.open=false;menu.querySelector<HTMLElement>('summary')?.focus();return;}
 }
 const tab=(e.target as Element).closest<HTMLButtonElement>("[data-detail-tab]");
 if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 const tabs=Array.from(root.querySelectorAll<HTMLButtonElement>("[data-detail-tab]"));
 const i=tabs.indexOf(tab);const n=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
 e.preventDefault();selectDetailTab(tabs[n]!.dataset.detailTab as DetailTab,true);
});
document.addEventListener("change", (e) => {
  if ((e.target as Element).closest("#profile")) profileRequirements();
  const el = e.target as HTMLInputElement;
  if(el.name==='attachments'){void previewSelection(el);return;}
  if(el.hasAttribute("data-list-size")){filters.size=Number(el.value);filters.offset=0;void render();return;}
  if (el.name === "position") {applyDriverRequirements();correctionPositionRequirements();}
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
  const target=e.target as Element;
  if(!target.closest('.case-actions')) root.querySelectorAll<HTMLDetailsElement>('.case-actions[open]').forEach(menu=>{menu.open=false;});
  const el = (e.target as Element).closest<HTMLElement>("button,a");
  if (!el) return;
  void (async () => {
    try {
      if(el.dataset.sort){filters.order=el.dataset.sort===filters.sort && filters.order==='asc'?'desc':'asc';filters.sort=el.dataset.sort;filters.offset=0;await render();return;}
      if(el.dataset.offset!==undefined){filters.offset=Number(el.dataset.offset);await render();return;}
      if (el.dataset.detailTab) {selectDetailTab(el.dataset.detailTab as DetailTab); return;}
      if (el.dataset.nextTarget) {
        selectDetailTab(el.dataset.nextTab as DetailTab);
        const target=root.querySelector<HTMLButtonElement>(["recall","new-topic"].includes(el.dataset.nextTarget) ? `[data-action="${el.dataset.nextTarget}"]` : `[data-workflow="${el.dataset.nextTarget}"]`);
        if(target&&!target.disabled)target.click();
        else {const panel=root.querySelector<HTMLElement>(`[data-detail-panel="${el.dataset.nextTab}"]`);panel?.scrollIntoView({block:"start",behavior:"smooth"});panel?.focus();}
        return;
      }
      if (el.dataset.workflow) {
        const template = root.querySelector<HTMLTemplateElement>(`#workflow-${el.dataset.workflow}`);
        if (template) {
          openModal(esc(el.dataset.title || "บันทึกข้อมูล"), (el.dataset.workflow === "employment" ? '<p class="notice">บันทึกกำหนดเริ่มงานก่อน แล้วจึงบันทึกวันเริ่มงานจริงได้</p>' : "") + template.innerHTML);
          const form = modal.querySelector("form");
          if (form && !form.querySelector('[data-action="close-modal"]')) {
            const footer = document.createElement("div");
            footer.className = "actions form-footer";
            for (const control of form.querySelectorAll<HTMLButtonElement>(':scope > button')) footer.append(control);
            footer.insertAdjacentHTML("beforeend",button("ยกเลิก","close-modal"));
            form.append(footer);
          }
          dynamicRequirements();
        }
        return;
      }
      if (el.dataset.action) await clickAction(el.dataset.action);
      if (el.dataset.nav) {
        screen = el.dataset.nav;
        filters = blankFilters();
        await render();
      }
      if(el.dataset.workQueue){
        const q=queueDefinitions(profile.role).find(q=>q.id===el.dataset.workQueue);
        if(q){screen='applicants';filters={...blankFilters(),status:q.status||'',workflow_stage:q.workflow_stage||'',queue:q.queue||'',sort:q.sort||'created_at',order:q.order||'desc'};await render();}return;
      }
      if (el.dataset.filter) {
        screen = "applicants";
        filters = {
          ...blankFilters(),
          search: "",
          status: el.dataset.filter,
          unit: "",
          offset: 0,
        };
        await render();
      }
      if (el.dataset.open) await openApplicant(el.dataset.open,el.dataset.openTab as DetailTab|undefined);
      if (el.dataset.page) {
        filters.offset = Math.max(
          0,
          filters.offset + Number(el.dataset.page) * filters.size,
        );
        await render();
      }
      if (el.hasAttribute("data-remove-line"))
        el.closest(".request-line")?.remove();
      if(el.dataset.requestEdit)await openRequestEditor('edit_request',el.dataset.requestEdit);
      if(el.dataset.requestAdd)await openRequestEditor('add_request_slot',el.dataset.requestAdd);
      if(el.dataset.requestHistory)await openRequestEditor('request_history',el.dataset.requestHistory);
      if(el.dataset.requestSlot)await openRequestEditor('edit_request_slot',el.dataset.requestSlot,el.dataset.slotId);
      if(el.dataset.requestCancel)await openRequestEditor('cancel_request_slot',el.dataset.requestCancel,el.dataset.slotId);
      if(el.dataset.requestRestore)await openRequestEditor('restore_request_slot',el.dataset.requestRestore,el.dataset.slotId);
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
      if(el.dataset.driveOpen){const doc=visibleDocuments.get(el.dataset.driveOpen);if(doc){const token=crypto.randomUUID();openModal('กำลังโหลด PDF','<p role="status">กำลังตรวจสิทธิ์และโหลดเอกสาร…</p>');modal.dataset.pdfRequest=token;try{const blob=await readDocument(doc);if(!modal.open||modal.dataset.pdfRequest!==token)return;const url=URL.createObjectURL(blob);previewUrls.add(url);openModal(esc(doc.filename),`<iframe data-private-pdf="${url}" class="pdf-preview" src="${url}" title="${esc(doc.filename)}"></iframe><p class="hint">หากอุปกรณ์ไม่รองรับการดู PDF ในหน้าเว็บ สามารถดาวน์โหลดได้</p><a class="button" href="${url}" download="${esc(doc.filename)}">ดาวน์โหลด PDF</a>`);}catch(e){if(modal.open&&modal.dataset.pdfRequest===token)openModal('โหลดเอกสารไม่สำเร็จ',`<p class="error">${esc(e instanceof Error?e.message:e)}</p>`);}}return;}
      if(el.dataset.driveDownload){const doc=visibleDocuments.get(el.dataset.driveDownload);if(doc){el.setAttribute('disabled','');try{const blob=await readDocument(doc);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=doc.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}finally{el.removeAttribute('disabled');}}return;}
      if(el.dataset.drivePreview){const doc=visibleDocuments.get(el.dataset.drivePreview);if(doc)await showImage(doc);return;}
      if(el.dataset.driveRecover){const doc=visibleDocuments.get(el.dataset.driveRecover);if(doc){el.setAttribute('disabled','');try{await recoverDocument(doc);await refreshDocuments(doc.applicant_id);toast('ตรวจไฟล์และบันทึกสำเร็จ');}finally{el.removeAttribute('disabled');}}return;}
      if(el.dataset.retryUpload){await runStaffUpload(el.dataset.retryUpload);return;}
      if(el.dataset.action==='retry-public-files'){await continuePublicUploads();return;}
      if(el.dataset.action==='clear-attachments'){const form=el.closest('form');const input=form?.querySelector<HTMLInputElement>('[name="attachments"]');if(input){input.value='';selectedBatches.delete(input);const holder=form?.querySelector<HTMLElement>('[data-selected-files]');if(holder){revokeInside(holder);holder.replaceChildren();}}return;}

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
        case "apply-pin": {
          const {data,error} = await db.rpc("recruitment_unlock_application", {p_pin:String(d.pin)});
          if(error) throw error;
          if(!data.ok) throw Error(data.message);
          applyTicket = data.token;
          applyTicketExpires = Date.now() + Math.max(0,Date.parse(data.expires_at)-Date.parse(data.server_time));
          publicApplicationForm();
          break;
        }
        case "public-apply": {
          if (!applyTicket || Date.now() >= applyTicketExpires) throw Error("สิทธิ์เปิดฟอร์มหมดอายุ กรุณาคัดลอกข้อมูลที่กรอกไว้ แล้วเปิดฟอร์มด้วย PIN ใหม่");
          const items=await selectedUploads(form);
          const payload={...applicantPayload(form),access_token:applyTicket};delete payload.data.consent;
          const {data,error}=await db.rpc(items.length?'recruitment_apply_with_documents':'recruitment_apply',{p_payload:{...payload,...(items.length?{document_count:items.length}:{})}});
          if(error)throw error;
          applyTicket='';applyTicketExpires=0;
          publicReceipt={id:data.id,code:data.reference_code||data.id,token:data.upload_token||'',items,busy:false};
          await continuePublicUploads();break;
        }
        case "new-applicant": {
          const items=await selectedUploads(form);
          const created=await rpc("create_applicant",applicantPayload(form));
          if(items.length)uploadJobs.set(created.id,items);
          modal.close();await openApplicant(created.id,items.length?'documents':'general');
          toast('เพิ่มผู้สมัครแล้ว');if(items.length)await runStaffUpload(created.id);break;
        }
        case "correction-fields": {
          const a=detail!.applicant as Applicant;const {full_name,phone,position,unit,note:reason,...values}=dataOf(form);
          const payload:Row={id:a.id,version:a.version,data:values};for(const [k,v] of Object.entries({full_name,phone,position,unit,note:reason}))if(v!==undefined)payload[k]=v;
          const mode=form.dataset.mode!;const plan=await rpc(mode,{...payload,preview:true});
          pendingCorrection={mode,payload};
          openModal('ตรวจสอบก่อนบันทึก',`<p>ผู้สมัคร: <b>${esc(a.full_name)}</b></p>${correctionChanges(plan.changes)}${plan.age_review?'<div class="notice warn">วันเกิดเปลี่ยนหลังผ่านคัดกรองแล้ว โปรดทบทวนเกณฑ์อายุ ผลเดิมจะไม่เปลี่ยนอัตโนมัติ</div>':''}${plan.duplicates?.length?`<div class="notice warn">พบข้อมูลซ้ำ ${plan.duplicates.length} รายการ: ${plan.duplicates.map((x:Row)=>esc(x.name)+' ('+esc(statuses[x.status]||x.status)+')').join(', ')} โปรดตรวจว่าไม่ใช่การใช้ใบสมัครผิดคน</div>`:''}<div class="fields">${note(String(reason||''),plan.needs_reason,'เหตุผล / สิ่งที่ตรวจสอบแล้ว')}</div>${plan.duplicates?.length?'<label class="check"><input type="checkbox" name="duplicate_ack" required> ตรวจรายการซ้ำแล้ว และยืนยันแก้ข้อมูลของผู้สมัครคนนี้ <span class="req">*</span></label>':''}${plan.age_review?'<label class="check"><input type="checkbox" name="age_review_ack" required> ทบทวนเกณฑ์อายุและผลคัดกรองที่เกี่ยวข้องแล้ว <span class="req">*</span></label>':''}${mode==='change_unit'?'<label class="check"><input type="checkbox" name="confirm_impact" required> ยืนยันปลดคำขอและผู้รับผิดชอบเดิมตามที่แจ้ง <span class="req">*</span></label>':''}`,'correction-confirm');break;
        }
        case "correction-confirm": {
          if(!pendingCorrection)throw Error('เปิดรายการแก้ไขใหม่');const {mode,payload}=pendingCorrection;
          await rpc(mode,{...payload,note:d.note||'',duplicate_ack:d.duplicate_ack==='on',age_review_ack:d.age_review_ack==='on',confirm_impact:d.confirm_impact==='on'});
          pendingCorrection=null;modal.close();toast('แก้ไขข้อมูลและบันทึกประวัติแล้ว');await openApplicant(payload.id);break;
        }
        case "filters":
          if(d.age_min!==""&&d.age_max!==""&&d.age_min!==undefined&&d.age_max!==undefined&&Number(d.age_min)>Number(d.age_max))throw Error("อายุตั้งแต่ต้องไม่มากกว่าอายุไม่เกิน");
          if(d.from&&d.to&&String(d.from)>String(d.to))throw Error("วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด");
          filters = {
            ...filters,workflow_stage:String(d.workflow_stage||""),position:String(d.position||""),vehicle:String(d.vehicle||""),age_min:String(d.age_min||""),age_max:String(d.age_max||""),from:String(d.from||""),to:String(d.to||""),
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
        case "road-test":
          await runAction("road_test",d);
          break;
        case "no-show":
          await runAction("no_show",d);
          break;
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
        case "request-change": {
          if(!requestEditPending)throw Error('เปิดคำขอใหม่');const {action,payload}=requestEditPending;
          const proposal:Row={...payload,...d,reason:String(d.note||'')};delete proposal.note;
          const plan=await rpc(action,{...proposal,preview:true});requestEditPending={action,payload:{...proposal,review_token:plan.review_token}};
          const impact=plan.impacts as Row[];
          openModal('ตรวจสอบก่อนบันทึก',`<p><b>${esc(plan.audit.action)}</b></p>${requestDiff(plan.audit.before,plan.audit.after)}<p>เหตุผล: ${esc(proposal.reason)}</p>${impact.length?`<div class="notice warn"><b>ต้องปลดผู้สมัคร ${impact.length} รายการ</b><ul>${impact.map((x:Row)=>`<li>${esc(x.name)} · ทะเบียน ${esc(x.plate)}</li>`).join('')}</ul><p>สถานะการรับสมัครและข้อมูลส่งมอบของผู้สมัครไม่เปลี่ยนอัตโนมัติ</p></div>`:''}<div class="notice">การเพิ่ม ยกเลิก คืน เปลี่ยนตำแหน่งหรือหน่วยงาน อาจเปลี่ยนผล KPI 14 วันตามข้อมูลคำขอปัจจุบัน ระบบคงวันที่รับผ่านครั้งแรกของอัตราไว้ ทะเบียน/รถในข้อมูลพนักงานแก้แยกได้</div><label class="check"><input type="checkbox" name="confirm_changes" required> ตรวจสอบข้อมูลและผลกระทบแล้ว <span class="req">*</span></label>${impact.length?'<label class="check"><input type="checkbox" name="confirm_detach" required> ยืนยันปลดการผูกผู้สมัครตามรายการข้างต้น <span class="req">*</span></label>':''}`,'request-change-confirm');break;
        }
        case "request-change-confirm": {
          if(!requestEditPending)throw Error('เปิดคำขอใหม่');const {action,payload}=requestEditPending;
          await rpc(action,{...payload,confirm_changes:d.confirm_changes==='on',confirm_detach:d.confirm_detach==='on'});requestEditPending=null;modal.close();toast('บันทึกคำขอและประวัติแล้ว');await render();break;
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
          modal.close();
          toast("บันทึกแล้ว");
          await load();
          break;
        case "unit":
          await rpc("unit", d);
          modal.close();
          toast("เพิ่มหน่วยงานแล้ว");
          await load();
          break;
        case "profile":
          await rpc("save_profile", {
            ...d,
            active: d.active === "true",
            all_units: d.all_units === "true",
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
          if(!attachmentsEnabled||!detail)throw Error('ยังไม่เปิดใช้งานไฟล์แนบ');
          const id=detail.applicant.id as string;
          if(uploadJobs.get(id)?.some(x=>x.state!=='done'))throw Error('กรุณาลองส่งไฟล์รายการที่ค้างให้เสร็จก่อนแนบชุดใหม่');
          const items=await selectedUploads(form);if(!items.length)throw Error('เลือกไฟล์อย่างน้อยหนึ่งรายการ');
          uploadJobs.set(id,items);modal.close();await runStaffUpload(id);break;
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
installDatePickers();
void init();
