import type {Applicant,Role} from './domain';
export type DetailTab = 'general'|'interview'|'employment'|'road'|'training'|'history';
export const detailTabs: {id:DetailTab;label:string}[] = [
  {id:'general',label:'ข้อมูลทั่วไป'}, {id:'interview',label:'สัมภาษณ์'},
  {id:'employment',label:'ส่งมอบ / เริ่มงาน'}, {id:'road',label:'ทดลองขับ'},
  {id:'training',label:'การอบรม'}, {id:'history',label:'ประวัติ'},
];
export interface WorkQueue {id:string;title:string;hint:string;tab:DetailTab;status?:string;workflow_stage?:string;queue?:string;sort?:string;order?:string}
export const queueDefinitions = (role:Role):WorkQueue[] => role === 'COACH' ? [
 {id:'coach-pending',queue:'coach_pending',title:'งานของฉัน · รอผลทดลองขับ',hint:'เฉพาะคนที่มอบหมายให้คุณและยังไม่บันทึกผล',tab:'road'},
] : role === 'MANAGER' ? [
 {id:'interview',status:'INTERVIEW',title:'คิวสัมภาษณ์ของหน่วยงาน',hint:'รับงานหรือทำแบบประเมินที่รับไว้ต่อ',tab:'interview'},
 {id:'handover',workflow_stage:'HANDOVER_PENDING',title:'รอส่งมอบพนักงาน',hint:'กำหนดผู้ดูแลและข้อมูลรถให้ครบ',tab:'employment'},
 {id:'active',workflow_stage:'ACTIVE',title:'พนักงาน / บันทึกอบรม',hint:'พนักงานที่ยังทำงานอยู่ในขอบเขตของคุณ',tab:'training'},
] : [
 {id:'review',status:'HR_REVIEW',title:'ใบสมัครรอตรวจ',hint:'ตรวจข้อมูลและส่ง Supervisor สัมภาษณ์',tab:'general'},
 {id:'info',status:'WAITING_INFO',title:'ติดตามข้อมูลเพิ่มเติม',hint:'เรียงวันติดตามเก่าก่อน · เปิดดูข้อมูลที่รอ',tab:'general',sort:'next_date',order:'asc'},
 {id:'interview',status:'INTERVIEW',title:'ติดตามผลสัมภาษณ์',hint:'ดูว่าใครรับงานแล้วและใครยังรอรับงาน',tab:'interview'},
 {id:'handover',workflow_stage:'HANDOVER_PENDING',title:'รอส่งมอบพนักงาน',hint:'กรอกผู้ดูแลและข้อมูลรถให้ครบ',tab:'employment'},
 {id:'schedule',workflow_stage:'START_DATE_PENDING',title:'รอกำหนดวันเริ่มงาน',hint:'ส่งมอบครบแล้ว ให้ HR บันทึกวันนัด',tab:'employment'},
 {id:'today',workflow_stage:'START_TODAY',title:'นัดเริ่มงานวันนี้',hint:'ยืนยันวันจริงเมื่อมาทำงานแล้ว',tab:'employment',sort:'next_date',order:'asc'},
 {id:'overdue',workflow_stage:'START_OVERDUE',title:'เลยวันนัด · รอยืนยัน',hint:'ตรวจสอบก่อนบันทึกเริ่มงานหรือไม่มาเริ่มงาน',tab:'employment',sort:'next_date',order:'asc'},
 {id:'scheduled',workflow_stage:'START_SCHEDULED',title:'นัดเริ่มงานล่วงหน้า',hint:'เรียงวันนัดใกล้ที่สุดก่อน',tab:'employment',sort:'next_date',order:'asc'},
];
export function progressState(a: Pick<Applicant,'status'|'actual_start_date'>) {
  const paused = !['HR_REVIEW','WAITING_INFO','INTERVIEW','HIRED','STARTED'].includes(a.status);
  const current = paused ? -1 : a.status === 'STARTED' ? 5 : a.status === 'HIRED' ? 3 : a.status === 'INTERVIEW' ? 2 : 1;
  return {paused,current,labels:['รับใบสมัคร','HR คัดกรอง','สัมภาษณ์','เตรียมเริ่มงาน','เริ่มงานจริง']};
}
export function nextTask(a:Pick<Applicant,'status'|'data'|'scheduled_start_date'|'actual_start_date'> & Partial<Pick<Applicant,'employment_status'>>, available: readonly string[]) {
  const has=(id:string)=>available.includes(id);
  if(a.employment_status==='RESIGNED')return {label:'',target:'',tab:'history' as DetailTab,hint:'ลาออกแล้ว สามารถตรวจรายละเอียดและประวัติได้'};
  if(a.status==='RESERVE'&&has('recall')) return {label:'ติดตาม / เรียกผู้สมัครกลับ',target:'recall',tab:'general' as DetailTab,hint:'ตรวจข้อมูลและประวัติการติดต่อก่อนเรียกกลับ'};
  if(['REJECTED','WITHDRAWN','NO_SHOW','CANCELLED'].includes(a.status)) return {label:'',target:'',tab:'history' as DetailTab,hint:'รายการนี้ปิดแล้ว สามารถตรวจรายละเอียดและประวัติได้'};
  if(['HR_REVIEW','WAITING_INFO'].includes(a.status)&&has('screen')) return {label:'ตรวจและคัดกรองผู้สมัคร',target:'screen',tab:'general' as DetailTab,hint:'ตรวจใบสมัครให้ครบ แล้วเลือกส่งสัมภาษณ์ ขอข้อมูลเพิ่ม หรือไม่ผ่าน'};
  if(has('interview')) return {label:'ทำแบบสัมภาษณ์ต่อ',target:'interview',tab:'interview' as DetailTab,hint:'ยืนยันผลผ่านถือว่ารับเข้าทำงาน ผลทดลองขับบันทึกแยกโดย Driver Coach'};
  if(has('claim')) return {label:'เปิดงานสัมภาษณ์',target:'claim',tab:'interview' as DetailTab,hint:'เปิดแท็บสัมภาษณ์ แล้วรับงานก่อนเริ่มบันทึกผล'};
  if(a.status==='INTERVIEW') return {label:'ติดตามงานสัมภาษณ์',target:'view-interview',tab:'interview' as DetailTab,hint:'ส่งคัดกรองแล้ว รอ Supervisor รับงานและบันทึกผล'};
  if(has('road-test')&&!a.data.road_test_result) return {label:'บันทึกผลทดลองขับ',target:'road-test',tab:'road' as DetailTab,hint:'ระบุผล วันที่ และหมายเหตุของพนักงานที่คุณได้รับมอบหมาย'};
  if(a.status==='HIRED'&&has('handover')&&has('handover-incomplete')) return {label:'กำหนดผู้ดูแลและส่งมอบ',target:'handover',tab:'employment' as DetailTab,hint:'กรอก Driver Coach, Supervisor, ทะเบียนรถ และประเภทรถให้ครบ'};
  if(a.status==='HIRED'&&has('employment')) return {label:a.scheduled_start_date?'บันทึกการเริ่มงานจริง':'กำหนดวันเริ่มงาน',target:'employment',tab:'employment' as DetailTab,hint:a.scheduled_start_date?'ยืนยันวันเริ่มงานจริงเมื่อพนักงานมาทำงานแล้ว':'บันทึกวันนัดก่อน แล้วจึงบันทึกวันเริ่มงานจริงได้'};
  if(a.status==='STARTED'&&has('training')) return {label:'บันทึกผลอบรม',target:'training',tab:'training' as DetailTab,hint:'เลือกหัวข้อ วันที่ และผลอบรมของพนักงาน'};
  if(a.status==='STARTED'&&has('new-topic')) return {label:'เพิ่มหัวข้ออบรม',target:'new-topic',tab:'training' as DetailTab,hint:'เพิ่มหัวข้อที่ตรงกับตำแหน่งและหน่วยงานก่อนบันทึกผล'};
  return {label:'',target:'',tab:'general' as DetailTab,hint:a.status==='HIRED'?'รอผู้รับผิดชอบส่งมอบหรือ HR บันทึกเริ่มงาน':'ตรวจข้อมูลและประวัติ หรือรอผู้รับผิดชอบดำเนินการตามสถานะ'};
}
