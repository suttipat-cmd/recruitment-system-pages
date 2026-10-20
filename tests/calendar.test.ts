import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCalendarDate,date} from '../web/domain';
test('calendar accepts editable Gregorian dd/mm/yyyy and rejects impossible dates',()=>{
 const leap=parseCalendarDate('29/02/2024')!;
 assert.equal(leap.getFullYear(),2024);assert.equal(leap.getMonth(),1);assert.equal(leap.getDate(),29);
 for(const value of ['29/02/2025','31/04/2026','2026-01-01','01/13/2026','abc','']) assert.equal(parseCalendarDate(value),undefined);
 assert.equal(date('2026-10-20'),'20/10/2026');
});
