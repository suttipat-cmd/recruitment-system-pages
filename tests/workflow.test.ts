import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowSummary,stageOf,missingHandover} from '../web/workflow';
import {nextTask,queueDefinitions} from '../web/workspace';
import type {Applicant} from '../web/domain';
const day='2026-10-25';
const base={status:'HIRED',owner_id:'manager',coach_id:'coach',supervisor_id:'manager',scheduled_start_date:null,actual_start_date:null,employment_status:'PENDING',hiring_unit:'Unit A',data:{plate:'AA-123',fleet_type:'COMPANY'}} as unknown as Applicant;
test('hiring summary distinguishes handover, scheduling, today and overdue without changing main status',()=>{
 assert.equal(stageOf({...base,coach_id:null},day),'HANDOVER_PENDING');
 assert.deepEqual(missingHandover({...base,data:{}}),['ทะเบียนรถ','ประเภทรถ']);
 assert.equal(stageOf(base,day),'START_DATE_PENDING');
 assert.equal(stageOf({...base,scheduled_start_date:day},day),'START_TODAY');
 assert.equal(stageOf({...base,scheduled_start_date:'2026-10-24'},day),'START_OVERDUE');
 assert.equal(stageOf({...base,scheduled_start_date:'2026-10-26'},day),'START_SCHEDULED');
 assert.equal(base.status,'HIRED');
});
test('interview states identify shared queue and named owner, with role fallback for inactive users',()=>{
 assert.equal(workflowSummary({...base,status:'INTERVIEW',owner_id:null},day).stage,'INTERVIEW_UNCLAIMED');
 assert.equal(workflowSummary({...base,status:'INTERVIEW'},day,()=> 'หัวหน้าทดสอบ').waiting,'หัวหน้าทดสอบ');
 assert.equal(workflowSummary({...base,status:'INTERVIEW'},day,()=> '—').waiting,'Supervisor ผู้รับงาน');
});
test('follow-up date and start-date boundaries never automatically decide no-show',()=>{
 const w=workflowSummary({...base,status:'WAITING_INFO',data:{followup_date:'2026-10-24'}},day);
 assert.equal(w.nextDate,'2026-10-24');assert.equal(w.late,true);assert.equal(w.dateLabel,'วันติดตาม');
 assert.equal(workflowSummary({...base,scheduled_start_date:day},day).late,false);
 assert.equal(workflowSummary({...base,scheduled_start_date:'2026-10-24'},day).closed,false);
});
test('resigned employee cannot be presented as active or prompted to add training',()=>{
 const a={...base,status:'STARTED',employment_status:'RESIGNED'};
 assert.equal(workflowSummary(a,day).stage,'RESIGNED');assert.equal(workflowSummary(a,day).closed,true);
 assert.equal(nextTask(a,['employment','training']).target,'');
 assert.equal(workflowSummary({...a,employment_status:'ACTIVE'},day).stage,'ACTIVE');
});
test('closed/reserve cases show explicit outcomes instead of a hiring action',()=>{
 for(const status of ['NO_SHOW','REJECTED','WITHDRAWN','CANCELLED']){
  const w=workflowSummary({...base,status},day);assert.equal(w.closed,true);assert.equal(w.waiting,'—');assert.equal(w.tab,'history');
 }
 assert.equal(workflowSummary({...base,status:'RESERVE'},day).closed,false);
});
test('Coach queue is explicitly pending work; HR has interview and appointment follow-up queues',()=>{
 assert.equal(queueDefinitions('COACH')[0]!.queue,'coach_pending');
 assert.ok(queueDefinitions('HR').some(q=>q.status==='INTERVIEW'));
 for(const stage of ['START_TODAY','START_OVERDUE','START_SCHEDULED','HANDOVER_PENDING','START_DATE_PENDING'])assert.ok(queueDefinitions('HR').some(q=>q.workflow_stage===stage));
});
