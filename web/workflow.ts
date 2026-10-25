import type {Applicant} from './domain';
import type {DetailTab} from './workspace';
export const workflowLabels: Record<string,string> = {
 HR_REVIEW:'รอ HR ตรวจ',WAITING_INFO:'รอข้อมูลเพิ่มเติม',INTERVIEW_UNCLAIMED:'รอ Supervisor รับงาน',INTERVIEW_IN_PROGRESS:'อยู่ระหว่างสัมภาษณ์',
 HANDOVER_PENDING:'รอส่งมอบพนักงาน',START_DATE_PENDING:'รอ HR กำหนดวันเริ่มงาน',START_TODAY:'นัดเริ่มงานวันนี้',START_OVERDUE:'เลยวันนัด · รอยืนยัน',START_SCHEDULED:'นัดเริ่มงานแล้ว',
 ACTIVE:'ทำงานอยู่',RESIGNED:'ลาออกแล้ว',RESERVE:'ผู้สมัครสำรอง',REJECTED:'ไม่ผ่าน',WITHDRAWN:'ถอนตัว',NO_SHOW:'ไม่มาเริ่มงาน',CANCELLED:'ยกเลิกรับ',
};
export type WorkflowApplicant = Pick<Applicant,'status'|'owner_id'|'coach_id'|'supervisor_id'|'scheduled_start_date'|'employment_status'> & Partial<Applicant>;
export function missingHandover(a:WorkflowApplicant):string[] {
 if(a.handover_missing)return a.handover_missing;
 return [!a.coach_id?'Driver Coach':'',!a.supervisor_id?'Supervisor ผู้ดูแล':'',!a.data?.plate?.trim()?'ทะเบียนรถ':'',!a.data?.fleet_type?.trim()?'ประเภทรถ':''].filter(Boolean);
}
export function stageOf(a:WorkflowApplicant,day:string):string {
 if(a.workflow_stage)return a.workflow_stage;
 if(a.status==='STARTED')return a.employment_status==='RESIGNED'?'RESIGNED':'ACTIVE';
 if(a.status==='INTERVIEW')return a.owner_id?'INTERVIEW_IN_PROGRESS':'INTERVIEW_UNCLAIMED';
 if(a.status!=='HIRED')return a.status;
 if(missingHandover(a).length)return 'HANDOVER_PENDING';
 if(!a.scheduled_start_date)return 'START_DATE_PENDING';
 return a.scheduled_start_date<day?'START_OVERDUE':a.scheduled_start_date===day?'START_TODAY':'START_SCHEDULED';
}
export function workflowSummary(a:WorkflowApplicant,day:string,person:(id:string)=>string=()=> '') {
 const stage=stageOf(a,day),label=workflowLabels[stage]||'ตรวจสอบสถานะ';
 const named=(id:string|null|undefined,role:string)=>{const name=id?person(id):'';return name&&name!=='—'?name:role;};
 const waiting=stage==='HR_REVIEW'?'HR':stage==='WAITING_INFO'?'ผู้สมัครส่งข้อมูล / HR ติดตาม':stage==='INTERVIEW_UNCLAIMED'?`Supervisor · ${a.hiring_unit||'หน่วยงานที่รับ'}`:stage==='INTERVIEW_IN_PROGRESS'?named(a.owner_id,'Supervisor ผู้รับงาน'):stage==='HANDOVER_PENDING'?'HR / Supervisor ของหน่วยงาน':['START_DATE_PENDING','START_TODAY','START_OVERDUE','START_SCHEDULED'].includes(stage)?'HR':stage==='ACTIVE'?'HR / Supervisor ผู้ดูแล':stage==='RESERVE'?'HR ติดตามเมื่อมีอัตราว่าง':'—';
 const nextDate=a.next_date||(stage==='WAITING_INFO'?a.data?.followup_date:stage.startsWith('START_')?a.scheduled_start_date:null)||null;
 const late=stage==='START_OVERDUE'||(stage==='WAITING_INFO'&&!!nextDate&&nextDate<day);
 const reason=stage==='HANDOVER_PENDING'?`ยังขาด: ${missingHandover(a).join(', ')}`:stage==='INTERVIEW_UNCLAIMED'?'ยังไม่มีผู้รับงานสัมภาษณ์':stage==='INTERVIEW_IN_PROGRESS'?'รอผู้รับงานยืนยันผลสัมภาษณ์':stage==='START_DATE_PENDING'?'ส่งมอบครบแล้ว ยังไม่มีวันนัดเริ่มงาน':stage==='START_OVERDUE'?'เลยวันนัดแล้ว ยังไม่มีการยืนยันเริ่มงานจริงหรือไม่มาเริ่มงาน':stage==='START_TODAY'?'ถึงวันนัดแล้ว ให้ HR ยืนยันเมื่อมาทำงานจริง':stage==='START_SCHEDULED'?'รอถึงวันนัดเริ่มงาน':stage==='WAITING_INFO'?'รอข้อมูลเพิ่มเติมตามที่ HR แจ้ง':stage==='ACTIVE'?'เริ่มงานแล้ว ติดตามการทำงานและบันทึกอบรม':stage==='RESIGNED'?'สิ้นสุดการทำงานแล้ว ดูรายละเอียดและประวัติได้':stage==='HR_REVIEW'?'HR ตรวจใบสมัครและเลือกขั้นตอนถัดไป':stage==='RESERVE'?'อยู่ในรายชื่อสำรอง ยังไม่ได้รับเข้าทำงาน':'รายการสิ้นสุดแล้ว ดูเหตุผลในประวัติ';
 const tab:DetailTab=stage.startsWith('INTERVIEW_')?'interview':stage==='ACTIVE'?'training':stage.startsWith('START_')||stage==='HANDOVER_PENDING'?'employment':['RESIGNED','REJECTED','WITHDRAWN','NO_SHOW','CANCELLED'].includes(stage)?'history':'general';
 return {stage,label,waiting,nextDate,dateLabel:stage==='WAITING_INFO'?'วันติดตาม':'กำหนดเริ่มงาน',late,reason,tab,closed:['RESIGNED','REJECTED','WITHDRAWN','NO_SHOW','CANCELLED'].includes(stage)};
}
