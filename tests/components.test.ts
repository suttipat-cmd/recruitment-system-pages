import { test } from 'node:test';
import assert from 'node:assert/strict';
import { button, field, select, note } from '../web/components';

test('shared form controls preserve names, required markers and escaped values', () => {
  const input = field('full_name', 'ชื่อ', 'A" <script>', true);
  assert.match(input, /name="full_name"/);
  assert.match(input, /class="req">\*<\/span>/);
  assert.match(input, /required/);
  assert.doesNotMatch(input, /<script>/);
  assert.match(select('unit', 'หน่วยงาน', '<option value="x">X</option>', true), /name="unit" required/);
  assert.match(note('<unsafe>', true), /&lt;unsafe&gt;/);
  assert.match(button('บันทึก', 'save', 'primary'), /data-action="save" class="primary"/);
});
