/** Recruitment Drive Bridge V1 (V4.10). Deploy as owner, access Anyone.
 * Configure Script Properties SUPABASE_URL + SUPABASE_ANON_KEY, then run setupBridge().
 * No service_role key, public Drive sharing, or browser-side bridge secret is used.
 */
const APP_ORIGIN = 'https://suttipat-cmd.github.io';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function setupBridge() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('BRIDGE_KEY')) props.setProperty('BRIDGE_KEY', Array.from({length:4},function(){return Utilities.getUuid();}).join(''));
  config_();
  root_();
  const hash = sha_(Utilities.newBlob(props.getProperty('BRIDGE_KEY')).getBytes());
  const sql = "update rm_private.drive_config set bridge_url='PASTE_YOUR_EXEC_URL_HERE', bridge_key_hash='" + hash + "', enabled=true where id;";
  console.log('Root folder checked. Keep BRIDGE_KEY private in Script Properties.');
  console.log(sql); // Hash only; the secret itself is never printed.
  return sql;
}
function doGet() {
  return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><p>Recruitment Drive Bridge · ใช้แนบและดูไฟล์ผ่านเว็บ Recruitment เท่านั้น</p>');
}
function doPost(e) {
  let d = {}, origin = APP_ORIGIN;
  try {
    const raw = e && e.parameter && e.parameter.payload;
    if (!raw || raw.length > 16 * 1024 * 1024) throw Error('คำขอมีขนาดเกินกำหนด');
    d = JSON.parse(raw);
    if (d.origin !== APP_ORIGIN || !/^[a-f0-9]{64}$/.test(d.nonce || '') || !/^[0-9a-f-]{36}$/.test(d.request_id || '')) throw Error('คำขอไม่ถูกต้อง');
    const c = config_();
    if (!['upload','read','recover'].includes(d.action)) throw Error('ไม่รองรับคำสั่งนี้');
    // Supabase checks live profile/unit scope or a short-lived, upload-only applicant capability.
    const f = rpc_('recruitment_drive_authorize', {p_payload:{action:d.action,applicant_id:d.applicant_id,document_id:d.document_id,upload_token:d.upload_token || '',filename:d.filename,mime_type:d.mime_type,byte_size:d.byte_size,sha256:d.sha256}}, d.access_token, c);
    let value;
    if (d.action === 'read') {
      const folder = folder_(f.folder_code, false);
      const bytes = readFile_(f, folder.id);
      value = {id:f.id,filename:f.filename,mime_type:f.mime_type,base64:Utilities.base64Encode(bytes)};
    } else if (d.action === 'recover') {
      const folder = folder_(f.folder_code, false);
      const existing = findFile_(f.id, folder.id);
      if (!existing) throw Error('ยังไม่พบไฟล์ใน Drive กรุณาเลือกไฟล์และแนบใหม่');
      readFile_(Object.assign({},f,{drive_file_id:existing.id}),folder.id);
      commit_(f,existing.id,c); value = {id:f.id,state:'READY'};
    } else {
      if (f.state === 'READY') { value = {id:f.id,state:'READY'}; }
      else {
        const bytes = decode_(d.base64, f);
        const lock = LockService.getScriptLock();
        if (!lock.tryLock(25000)) throw Error('มีการส่งไฟล์พร้อมกัน กรุณาลองรายการนี้อีกครั้ง');
        let file;
        try {
          const folder = folder_(f.folder_code, true);
          file = findFile_(f.id,folder.id);
          if (file) readFile_(Object.assign({},f,{drive_file_id:file.id}),folder.id);
          else file = Drive.Files.create({name:f.id+'__'+f.filename,parents:[folder.id],mimeType:f.mime_type,appProperties:{recruitment_document_id:f.id,recruitment_code:f.folder_code,sha256:f.sha256}},Utilities.newBlob(bytes,f.mime_type,f.filename),{supportsAllDrives:true,fields:'id'});
        } finally {lock.releaseLock();}
        // Never trash a file after an uncertain network response: the commit may have succeeded.
        // The stable document ID makes retries/recovery reuse the same file instead of duplicating it.
        commit_(f,file.id,c); value = {id:f.id,state:'READY'};
      }
    }
    return reply_(d,origin,{ok:true,data:value});
  } catch (error) {
    console.warn('Drive bridge request failed: '+String(error && error.message || error).slice(0,250));
    return reply_(d,origin,{ok:false,message:String(error && error.message || 'ส่งไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง').slice(0,250)});
  }
}
function config_() {
  const p=PropertiesService.getScriptProperties();
  const url=(p.getProperty('SUPABASE_URL')||'').replace(/\/$/,'');
  const key=p.getProperty('SUPABASE_ANON_KEY')||'';
  const secret=p.getProperty('BRIDGE_KEY')||'';
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) || !key || secret.length<100) throw Error('ผู้ดูแลยังตั้งค่า Bridge ไม่ครบ');
  if (key.startsWith('sb_secret_')) throw Error('ใช้เฉพาะ anon/publishable key');
  if (key.split('.').length===3) {
    const claim=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(key.split('.')[1])).getDataAsString());
    if(claim.role!=='anon')throw Error('ใช้เฉพาะ anon key');
  } else if (!key.startsWith('sb_publishable_')) throw Error('รูปแบบ key ไม่ถูกต้อง');
  return {url:url,key:key,secret:secret};
}
function rpc_(name,payload,jwt,c) {
  const headers={apikey:c.key};if(jwt)headers.Authorization='Bearer '+jwt;
  const r=UrlFetchApp.fetch(c.url+'/rest/v1/rpc/'+name,{method:'post',contentType:'application/json',headers:headers,payload:JSON.stringify(payload),muteHttpExceptions:true});
  const status=r.getResponseCode();
  if(status<200||status>=300)throw Error(status===401||status===403?'สิทธิ์หมดอายุหรือไม่มีสิทธิ์ กรุณาเข้าสู่ระบบใหม่ หรือติดต่อ HR':'ตรวจสิทธิ์หรือบันทึกไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง ('+status+')');
  return JSON.parse(r.getContentText());
}
function commit_(f,fileId,c) {
  return rpc_('recruitment_drive_commit',{p_payload:{bridge_key:c.secret,document_id:f.id,file_id:fileId,sha256:f.sha256}},'',c);
}
function root_() {
  const rootId=PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID')||'';
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(rootId))throw Error('ตั้งค่า ROOT_FOLDER_ID ใน Script Properties ก่อน');
  const f=Drive.Files.get(rootId,{supportsAllDrives:true,fields:'id,name,mimeType,trashed,driveId,permissions(type)'});
  if(f.trashed || f.mimeType!=='application/vnd.google-apps.folder')throw Error('ไม่พบโฟลเดอร์หลัก');
  if((f.permissions||[]).some(function(p){return p.type==='anyone'||p.type==='domain';}))throw Error('โฟลเดอร์หลักต้องจำกัดสิทธิ์ ไม่เปิดแบบสาธารณะหรือทั้งโดเมน');
  return f;
}
function folder_(code,create) {
  if(!/^(DRV|AST)-\d{8}-[A-F0-9]{8}$/.test(code))throw Error('รหัสผู้สมัครไม่ถูกต้อง');
  const root=root_();
  const options={q:"'"+root.id+"' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='"+code+"'",pageSize:2,supportsAllDrives:true,includeItemsFromAllDrives:true,fields:'files(id,name,parents,permissions(type))'};
  if(root.driveId){options.corpora='drive';options.driveId=root.driveId;}
  const files=Drive.Files.list(options).files||[];
  if(files.length>1)throw Error('พบโฟลเดอร์รหัสนี้ซ้ำ กรุณาให้ผู้ดูแลตรวจ Drive');
  if(files.length===1){
    if((files[0].permissions||[]).some(function(p){return p.type==='anyone'||p.type==='domain';}))throw Error('โฟลเดอร์ผู้สมัครต้องจำกัดสิทธิ์');
    return files[0];
  }
  if(!create)throw Error('ไม่พบโฟลเดอร์ผู้สมัคร');
  return Drive.Files.create({name:code,mimeType:'application/vnd.google-apps.folder',parents:[root.id],appProperties:{recruitment_code:code}},null,{supportsAllDrives:true,fields:'id,name,parents'});
}
function findFile_(id,folderId) {
  if(!/^[0-9a-f-]{36}$/.test(id))throw Error('รหัสไฟล์ไม่ถูกต้อง');
  const folderMeta=Drive.Files.get(folderId,{supportsAllDrives:true,fields:'driveId'});
  const options={q:"'"+folderId+"' in parents and trashed=false and appProperties has { key='recruitment_document_id' and value='"+id+"' }",pageSize:2,supportsAllDrives:true,includeItemsFromAllDrives:true,fields:'files(id)'};
  if(folderMeta.driveId){options.corpora='drive';options.driveId=folderMeta.driveId;}
  const files=Drive.Files.list(options).files||[];
  if(files.length>1)throw Error('พบไฟล์รายการเดียวกันซ้ำ กรุณาให้ผู้ดูแลตรวจ Drive');
  return files[0]||null;
}
function readFile_(f,folderId) {
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(f.drive_file_id||''))throw Error('ไม่พบไฟล์');
  const meta=Drive.Files.get(f.drive_file_id,{supportsAllDrives:true,fields:'id,parents,mimeType,size,trashed,appProperties,permissions(type)'});
  if(meta.trashed || !(meta.parents||[]).includes(folderId) || meta.mimeType!==f.mime_type || Number(meta.size)!==f.byte_size || !meta.appProperties || meta.appProperties.recruitment_document_id!==f.id || (meta.permissions||[]).some(function(p){return p.type==='anyone'||p.type==='domain';}))throw Error('ไฟล์ไม่ตรงกับผู้สมัครหรือสิทธิ์โฟลเดอร์ถูกเปลี่ยน กรุณาติดต่อผู้ดูแล');
  const r=UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(f.drive_file_id)+'?alt=media&supportsAllDrives=true',{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
  if(r.getResponseCode()!==200)throw Error('อ่านไฟล์จาก Drive ไม่สำเร็จ');
  const bytes=r.getBlob().getBytes();validateBytes_(bytes,f);return bytes;
}
function decode_(base64,f) {
  if(typeof base64!=='string'||base64.length>Math.ceil(MAX_FILE_BYTES/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw Error('ข้อมูลไฟล์ไม่ถูกต้อง');
  const bytes=Utilities.base64Decode(base64);validateBytes_(bytes,f);return bytes;
}
function validateBytes_(bytes,f) {
  if(bytes.length!==f.byte_size||bytes.length<1||bytes.length>MAX_FILE_BYTES||sha_(bytes)!==f.sha256)throw Error('ขนาดหรือเนื้อหาไฟล์ไม่ตรง กรุณาเลือกไฟล์ใหม่');
  const b=bytes.map(function(n){return n&255;});
  const jpeg=b[0]===255&&b[1]===216&&b[2]===255;
  const png=[137,80,78,71,13,10,26,10].every(function(n,i){return b[i]===n;});
  const pdf=[37,80,68,70,45].every(function(n,i){return b[i]===n;});
  const valid=f.mime_type==='image/jpeg'?jpeg:f.mime_type==='image/png'?png:f.mime_type==='application/pdf'?pdf:false;
  const ext=/\.([^.]+)$/.exec(f.filename||'');const expected=f.mime_type==='image/jpeg'?['jpg','jpeg']:f.mime_type==='image/png'?['png']:['pdf'];
  if(!valid||!ext||!expected.includes(ext[1].toLowerCase()))throw Error('เนื้อหาและนามสกุลต้องเป็น JPG PNG หรือ PDF ที่ตรงกัน');
}
function sha_(bytes) {return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(function(n){return ('0'+(n&255).toString(16)).slice(-2);}).join('');}
function reply_(d,origin,result) {
  const envelope=JSON.stringify(Object.assign({kind:'recruitment-drive-v1',request_id:d.request_id,nonce:d.nonce},result)).replace(/</g,'\\u003c');
  const target=JSON.stringify(origin);
  // Apps Script adds its own sandbox iframe; notify each ancestor using an exact target origin.
  const script='var message='+envelope+';var w=window;for(var i=0;i<8;i++){var p=w.parent;if(p===w)break;p.postMessage(message,'+target+');w=p;}';
  return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><script>'+script+'</script>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
