import test from 'node:test';
import assert from 'node:assert/strict';
import {queueDefinitions,progressState,nextTask} from '../web/workspace.ts';
const applicant={status:'HIRED',data:{},scheduled_start_date:null,actual_start_date:null};
test('role work queues separate screening, interview and coach tasks',()=>{
 assert.deepEqual(queueDefinitions('HR').map(q=>q.status),['HR_REVIEW','WAITING_INFO','HIRED']);
 assert.equal(queueDefinitions('MANAGER')[0]!.tab,'interview');
 assert.equal(queueDefinitions('COACH')[0]!.tab,'road');
});
test('next action respects available role actions and hiring prerequisites',()=>{
 assert.equal(nextTask(applicant,['handover','handover-incomplete','employment']).target,'handover');
 assert.equal(nextTask(applicant,['handover','employment']).label,'กำหนดวันเริ่มงาน');
 assert.equal(nextTask({...applicant,scheduled_start_date:'2026-10-20'},['employment']).label,'บันทึกการเริ่มงานจริง');
 assert.equal(nextTask(applicant,[]).target,'');
 assert.equal(nextTask(applicant,['road-test']).target,'road-test');
 assert.equal(nextTask({...applicant,data:{road_test_result:'PASS'}},['road-test']).target,'');
 assert.equal(nextTask({...applicant,status:'STARTED'},['employment','training']).target,'training');
 assert.equal(nextTask({...applicant,status:'NO_SHOW'},['employment']).target,'');
 assert.equal(nextTask({...applicant,status:'INTERVIEW'},['claim']).tab,'interview');
 assert.equal(nextTask({...applicant,status:'INTERVIEW'},['screen']).target,'view-interview');
});
test('progress never depicts a closed or reserve case as successfully hired',()=>{
 for(const status of ['REJECTED','NO_SHOW','CANCELLED','WITHDRAWN','RESERVE']) assert.equal(progressState({status,actual_start_date:null}).paused,true);
 assert.equal(progressState({status:'INTERVIEW',actual_start_date:null}).current,2);
 assert.equal(progressState({status:'HIRED',actual_start_date:null}).current,3);
 assert.equal(progressState({status:'STARTED',actual_start_date:'2026-10-20'}).current,5);
});
