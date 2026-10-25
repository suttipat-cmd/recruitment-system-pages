import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {MAX_FILE_BYTES,mimeFor,validateFileInfo,validateHeader,trustedMessage,validBridgeUrl,prepareUploads} from '../web/drive';
const bytes=Buffer.from([137,80,78,71,13,10,26,10]);
const hash=createHash('sha256').update(bytes).digest('hex');
const source=await readFile(new URL('../integrations/google-drive/Code.gs',import.meta.url),'utf8');
const url='https://script.google.com/macros/s/bridge_test/exec';
test('file constraints accept JPG JPEG PNG PDF at the boundary, reject empty/oversize/spoofed files',async()=>{
 assert.equal(mimeFor('photo.JPEG','image/jpeg'),'image/jpeg');assert.equal(mimeFor('file.pdf',''),'application/pdf');
 assert.equal(validateFileInfo({name:'file.png',type:'image/png',size:MAX_FILE_BYTES}),'image/png');
 for(const f of [{name:'a.png',type:'image/png',size:0},{name:'a.png',type:'image/png',size:MAX_FILE_BYTES+1},{name:'../a.png',type:'image/png',size:8},{name:'a.svg',type:'image/svg+xml',size:8},{name:'a.pdf',type:'image/png',size:8}])assert.throws(()=>validateFileInfo(f));
 assert.throws(()=>validateHeader(new Uint8Array([60,115,118,103]),'image/png'));validateHeader(bytes,'image/png');
 await assert.rejects(()=>prepareUploads(Array(11).fill({name:'a.png',size:8,type:'image/png'} as File)));
});
test('message channel requires Google Script origin, exact random nonce and matching request ID',()=>{
 const data={kind:'recruitment-drive-v1',request_id:'request',nonce:'nonce'};
 assert.equal(trustedMessage('https://abc-script.googleusercontent.com',data,'request','nonce',url),true);
 for(const origin of ['https://evil.test','null','https://googleusercontent.com','https://script.google.com.evil.test'])assert.equal(trustedMessage(origin,data,'request','nonce',url),false);
 assert.equal(trustedMessage('https://script.googleusercontent.com',data,'request','wrong',url),false);
 assert.equal(validBridgeUrl(url),true);assert.equal(validBridgeUrl('https://evil.test/exec'),false);assert.equal(validBridgeUrl('http://127.0.0.1:3100/mock/drive'),false);
});
function sandbox(){
 const files=new Map<string,any>(),calls:any[]=[];const properties=new Map<string,string>([['ROOT_FOLDER_ID','root_test_recruitment'],['SUPABASE_URL','https://test.supabase.co'],['SUPABASE_ANON_KEY','sb_publishable_test'],['BRIDGE_KEY','x'.repeat(144)]]);
 let number=0;const context:any={console:{log:()=>{},warn:()=>{}},PropertiesService:{getScriptProperties:()=>({getProperty:(k:string)=>properties.get(k),setProperty:(k:string,v:string)=>properties.set(k,v)})},Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'SHA_256'},computeDigest:(_:string,b:number[])=>[...createHash('sha256').update(Buffer.from(b.map(n=>n&255))).digest()],newBlob:(b:any,type?:string)=>({getBytes:()=>[...Buffer.from(b)],getDataAsString:()=>Buffer.from(b).toString(),type}),base64Decode:(s:string)=>[...Buffer.from(s,'base64')],base64Encode:(b:any)=>Buffer.from(b).toString('base64')},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},ScriptApp:{getOAuthToken:()=> 'private-google-token'},HtmlService:{XFrameOptionsMode:{ALLOWALL:'ALLOWALL'},createHtmlOutput:(html:string)=>({html,setXFrameOptionsMode(){return this;}})},Drive:{Files:{get:(id:string)=>{calls.push(['get',id]);if(id==='root_test_recruitment')return {id,mimeType:'application/vnd.google-apps.folder',permissions:[]};return files.get(id);},list:(o:any)=>{calls.push(['list',o]);const matches=[...files.values()].filter(f=>o.q.includes("'"+f.parents[0]+"'")&&(o.q.includes("mimeType='application/vnd.google-apps.folder'")?f.mimeType==='application/vnd.google-apps.folder'&&o.q.includes("name='"+f.name+"'"):f.appProperties?.recruitment_document_id&&o.q.includes(f.appProperties.recruitment_document_id)));return {files:matches};},create:(meta:any,blob:any,o:any)=>{calls.push(['create',meta,o]);const id='drive_test_file_'+ ++number;const f={...meta,id,size:blob?8:undefined,permissions:[]};files.set(id,f);return f;}}},UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getBlob:()=>({getBytes:()=>[...bytes]})})}};
 vm.createContext(context);vm.runInContext(source,context);return {context,files,calls,properties};
}
test('Apps Script authenticates before any Drive action; response never reflects credentials',()=>{
 const {context,calls}=sandbox();context.rpc_=()=>{throw Error('ไม่มีสิทธิ์');};
 const r=context.doPost({parameter:{payload:JSON.stringify({action:'upload',origin:'https://suttipat-cmd.github.io',nonce:'a'.repeat(64),request_id:'10000000-0000-4000-8000-000000000001',access_token:'sensitive-token'})}});
 assert.equal(calls.length,0);assert.ok(r.html.includes('ไม่มีสิทธิ์'));assert.ok(!r.html.includes('sensitive-token'));assert.ok(!r.html.includes('private-google-token'));
});
test('Drive uploads use one canonical child folder; retry after uncertain commit reuses the same file',()=>{
 const {context,files,calls}=sandbox();const f={id:'41000000-0000-4000-8000-000000000001',folder_code:'DRV-20261020-83ED5718',filename:'photo.png',mime_type:'image/png',byte_size:8,sha256:hash,state:'PENDING'};
 let commits=0;context.rpc_=(name:string)=>{if(name==='recruitment_drive_authorize')return f;if(name==='recruitment_drive_commit'){commits++;if(commits===1)throw Error('network timeout');return {ok:true};}throw Error('unexpected');};
 const payload={origin:'https://suttipat-cmd.github.io',nonce:'b'.repeat(64),request_id:'10000000-0000-4000-8000-000000000001',action:'upload',applicant_id:'app',document_id:f.id,base64:bytes.toString('base64')};
 assert.ok(context.doPost({parameter:{payload:JSON.stringify(payload)}}).html.includes('network timeout'));
 assert.equal(files.size,2); // folder + file remain reconcilable after uncertain commit.
 assert.ok(context.doPost({parameter:{payload:JSON.stringify(payload)}}).html.includes('"ok":true'));
 assert.equal(files.size,2);assert.equal(commits,2);
 const created=calls.filter(x=>x[0]==='create');assert.equal(created[0][1].name,f.folder_code);assert.deepEqual([...created[0][1].parents],['root_test_recruitment']);assert.equal(created[1][1].parents[0],created[0][1].id??[...files.values()][0].id);
});
test('Drive refuses a read outside its applicant folder and refuses publicly shared root folders',()=>{
 const {context,files}=sandbox();files.set('other_file_id_123',{parents:['wrong_folder'],mimeType:'image/png',size:8,appProperties:{recruitment_document_id:'doc'},permissions:[]});
 assert.throws(()=>context.readFile_({id:'doc',drive_file_id:'other_file_id_123',mime_type:'image/png',byte_size:8,sha256:hash},'correct_folder'));
 context.Drive.Files.get=()=>({id:'root',mimeType:'application/vnd.google-apps.folder',permissions:[{type:'anyone'}]});assert.throws(()=>context.root_());
});
test('GAS validates magic bytes, length, extension and checksum; iframe response escapes HTML',()=>{
 const {context}=sandbox();context.validateBytes_([...bytes],{filename:'a.png',mime_type:'image/png',byte_size:8,sha256:hash});
 assert.throws(()=>context.validateBytes_([...bytes],{filename:'a.pdf',mime_type:'image/png',byte_size:8,sha256:hash}));
 assert.throws(()=>context.validateBytes_([...bytes],{filename:'a.png',mime_type:'image/png',byte_size:8,sha256:'0'.repeat(64)}));
 const r=context.reply_({request_id:'id',nonce:'nonce'},'https://suttipat-cmd.github.io',{ok:false,message:'</script><img src=x>'});assert.ok(!r.html.includes('</script><img'));assert.ok(r.html.includes('\\u003c/script>'));
});
