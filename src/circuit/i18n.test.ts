import {strict as assert} from 'node:assert';
import test from 'node:test';
import {translate} from '../i18n.ts';

test('Thai and English UI labels switch without changing schematic identifiers', () => {
  assert.equal(translate('th', 'File'), 'ไฟล์');
  assert.equal(translate('th', 'Wire'), 'เดินสาย');
  assert.equal(translate('th', 'Simulation Results'), 'ผลการจำลองวงจร');
  assert.equal(translate('en', 'File'), 'File');
  assert.equal(translate('en', 'Wire'), 'Wire');
  assert.equal(translate('th', 'VCC'), 'VCC');
  assert.equal(translate('th', 'uA741 (symbol)'), 'uA741 (symbol)');
});

test('Thai translates dynamic circuit validation and notifications', () => {
  assert.equal(translate('th', 'R1:0: Pin is not connected.'), 'R1:0: ขายังไม่เชื่อมต่อ');
  assert.equal(translate('th', 'Placed C3.'), 'วางอุปกรณ์ C3 แล้ว');
  assert.equal(translate('th', 'Op-Amp example loaded (schematic only). SPICE model for uA741 is not installed yet.'),
    'เปิดตัวอย่าง Op-Amp แล้ว (โหมดเขียนวงจร) ยังไม่มี SPICE Model สำหรับ uA741');
  assert.equal(translate('en', 'Placed C3.'), 'Placed C3.');
});
