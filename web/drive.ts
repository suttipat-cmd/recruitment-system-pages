import type {SupabaseClient} from '@supabase/supabase-js';
import {setAttachmentsEnabled} from './runtime';
export const MAX_FILE_BYTES=10*1024*1024;
export const MAX_FILES=10;
export interface UploadItem {id:string;file:File;mime:string;sha256:string;state:'waiting'|'uploading'|'done'|'failed';error?:string}
export interface DriveDocument {id:string;applicant_id:string;folder_code:string;filename:string;mime_type:string;byte_size:number;state:'PENDING'|'READY';created_at:string}
let client:SupabaseClient;
let bridgeUrl='';
let operationEpoch=0;
const activeRequests=new Set<()=>void>();
export function cancelDriveRequests(){operationEpoch++;for(const cancel of [...activeRequests])cancel();}
export function formatFileSize(bytes:number){return bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1024/1024).toFixed(2)} MB`;}
export function validBridgeUrl(url:string,local=false) {
 return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)||(local&&/^http:\/\/(127\.0\.0\.1|localhost):\d+\/mock\/drive$/.test(url));
}
export async function initDrive(db:SupabaseClient) {
 client=db;setAttachmentsEnabled(false);bridgeUrl='';
 try {const {data,error}=await db.rpc('recruitment_drive_status');if(!error&&data?.enabled&&validBridgeUrl(data.url,!!import.meta.env?.DEV)){bridgeUrl=data.url;setAttachmentsEnabled(true);}}catch{/* Optional bridge must never prevent login/application submission. */}
}
export function mimeFor(name:string,type:string) {
 const ext=name.split('.').pop()?.toLowerCase();
 const mime=ext==='jpg'||ext==='jpeg'?'image/jpeg':ext==='png'?'image/png':ext==='pdf'?'application/pdf':'';
 if(!mime||(type&&type!==mime))throw Error('รองรับ JPG, PNG และ PDF เท่านั้น และชนิดไฟล์ต้องตรงกับนามสกุล');
 return mime;
}
export function validateHeader(bytes:Uint8Array,mime:string) {
 const magic=mime==='image/jpeg'?[255,216,255]:mime==='image/png'?[137,80,78,71,13,10,26,10]:mime==='application/pdf'?[37,80,68,70,45]:[];
 if(!magic.length||!magic.every((v,i)=>bytes[i]===v))throw Error('เนื้อหาไฟล์ไม่ตรงกับชนิด JPG, PNG หรือ PDF');
}
export function validateFileInfo(file:{name:string;size:number;type:string}) {
 if(file.size<1||file.size>MAX_FILE_BYTES)throw Error(`${file.name}: ขนาดต้องไม่เกิน 10 MB และไม่เป็นไฟล์ว่าง`);
 if(!file.name.trim()||file.name.length>200||/[\x00-\x1f\x7f/\\]/.test(file.name))throw Error('ชื่อไฟล์ยาวเกินไปหรือมีอักขระที่ใช้ไม่ได้');
 return mimeFor(file.name,file.type);
}
export async function prepareUploads(files:File[]):Promise<UploadItem[]> {
 if(files.length>MAX_FILES)throw Error('แนบได้สูงสุด 10 ไฟล์ต่อครั้ง');
 const result:UploadItem[]=[];
 for(const file of files){const mime=validateFileInfo(file);const bytes=new Uint8Array(await file.arrayBuffer());validateHeader(bytes,mime);const hash=await crypto.subtle.digest('SHA-256',bytes);result.push({id:crypto.randomUUID(),file,mime,sha256:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join(''),state:'waiting'});}
 return result;
}
export function trustedMessage(origin:string,data:unknown,id:string,nonce:string,url:string,local=false):boolean {
 const validOrigin=/^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/.test(origin)||origin==='https://script.googleusercontent.com'||origin==='https://script.google.com'||(local&&validBridgeUrl(url,true)&&origin===new URL(url).origin);
 if(!validOrigin||!data||typeof data!=='object')return false;
 const d=data as Record<string,unknown>;return d.kind==='recruitment-drive-v1'&&d.request_id===id&&d.nonce===nonce;
}
async function transport(payload:Record<string,unknown>):Promise<any> {
 if(!bridgeUrl)throw Error('ยังไม่เปิดใช้งานไฟล์แนบ กรุณาติดต่อผู้ดูแล');
 const url=bridgeUrl;
 const id=crypto.randomUUID(),nonce=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const iframe=document.createElement('iframe'),form=document.createElement('form'),input=document.createElement('input');
 iframe.name='drive-'+id;iframe.hidden=true;iframe.title='กำลังรับส่งไฟล์อย่างปลอดภัย';
 form.method='POST';form.action=url;form.target=iframe.name;form.hidden=true;
 input.type='hidden';input.name='payload';input.value=JSON.stringify({...payload,request_id:id,nonce,origin:location.origin});form.append(input);
 return new Promise((resolve,reject)=>{
  const cancel=()=>{cleanup();reject(Error('ยกเลิกการรับส่งไฟล์เมื่อออกจากระบบ'));};
  const cleanup=()=>{activeRequests.delete(cancel);clearTimeout(timer);window.removeEventListener('message',receive);iframe.remove();form.remove();};
  const receive=(event:MessageEvent)=>{if(!trustedMessage(event.origin,event.data,id,nonce,url,!!import.meta.env?.DEV))return;cleanup();event.data.ok?resolve(event.data.data):reject(Error(event.data.message||'ส่งไฟล์ไม่สำเร็จ'));};
  const timer=setTimeout(()=>{cleanup();reject(Error('ยังไม่ได้รับผลจาก Drive กรุณาลองส่งรายการนี้อีกครั้ง ระบบจะตรวจไฟล์เดิมก่อน ไม่สร้างซ้ำ'));},240000);
  activeRequests.add(cancel);window.addEventListener('message',receive);document.body.append(iframe,form);form.submit();
 });
}
async function auth(token?:string) {
 if(token)return {upload_token:token};
 const {data}=await client.auth.getSession();if(!data.session)throw Error('กรุณาเข้าสู่ระบบใหม่');return {access_token:data.session.access_token};
}
function base64(file:File):Promise<string>{return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=()=>reject(Error('อ่านไฟล์ไม่สำเร็จ'));r.readAsDataURL(file);});}
export async function uploadBatch(applicantId:string,items:UploadItem[],changed:()=>void,token?:string) {
 const epoch=operationEpoch;
 for(const item of items){if(epoch!==operationEpoch)break;if(item.state==='done')continue;item.state='uploading';item.error=undefined;changed();try{await transport({action:'upload',applicant_id:applicantId,document_id:item.id,filename:item.file.name,mime_type:item.mime,byte_size:item.file.size,sha256:item.sha256,base64:await base64(item.file),...await auth(token)});item.state='done';}catch(e){item.state='failed';item.error=e instanceof Error?e.message:'ส่งไฟล์ไม่สำเร็จ';}changed();}
}
export async function listDocuments(applicantId:string):Promise<DriveDocument[]> {
 const {data,error}=await client.rpc('recruitment_drive_documents',{p_applicant_id:applicantId});if(error)throw Error('โหลดเอกสารไม่สำเร็จ กรุณาลองใหม่');return data||[];
}
export async function readDocument(doc:DriveDocument):Promise<Blob> {
 const d=await transport({action:'read',applicant_id:doc.applicant_id,document_id:doc.id,...await auth()});
 if(d.id!==doc.id||d.mime_type!==doc.mime_type||typeof d.base64!=='string'||d.base64.length>Math.ceil(MAX_FILE_BYTES/3)*4)throw Error('ข้อมูลไฟล์ไม่ถูกต้อง');
 const bytes=Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0));if(bytes.length!==doc.byte_size)throw Error('ขนาดไฟล์ไม่ตรง');validateHeader(bytes,doc.mime_type);return new Blob([bytes],{type:doc.mime_type});
}
export async function recoverDocument(doc:DriveDocument) {await transport({action:'recover',applicant_id:doc.applicant_id,document_id:doc.id,...await auth()});}
