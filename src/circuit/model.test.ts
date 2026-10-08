import {strict as assert} from 'node:assert';
import {createComponent, parseProject, pinPosition, starterProject} from './model.ts';

const old = {version: 1, parts: [
  {id: 'R1', kind: 'R', x: 120, y: 80, value: '1kΩ'},
  {id: 'G1', kind: 'G', x: 220, y: 80, value: 'GND'},
], wires: [{id: 'w1', from: 'R1:1', to: 'G1:0'}]};
const migrated = parseProject(JSON.stringify(old));
assert.equal(migrated.version, 2);
assert.deepEqual(migrated.components[0].pins, ['R1:0', 'R1:1']);
assert.deepEqual(migrated.wires, old.wires);
assert.deepEqual(migrated.schematic.R1, {x: 120, y: 80, rotation: 0});
assert.deepEqual(parseProject(JSON.stringify(migrated)).wires, old.wires);
assert.deepEqual(pinPosition(createComponent('R', 'R1'), {x: 120, y: 80, rotation: 90}, 'R1:0'), {x: 120, y: 40});
assert.deepEqual(pinPosition(createComponent('R', 'R1'), {x: 120, y: 80, rotation: 90}, 'R1:1'), {x: 120, y: 120});
assert.deepEqual(pinPosition(createComponent('G', 'G1'), {x: 220, y: 80, rotation: 0}, 'G1:0'), {x: 220, y: 50});
assert.equal(parseProject(JSON.stringify(starterProject())).components.length, 4);

for (const broken of [
  {...old, version: 99},
  {...old, parts: [{...old.parts[0], x: 'left'}]},
  {...old, parts: [{...old.parts[0], x: 1e99}]},
  {...old, parts: [old.parts[0], old.parts[0]]},
  {...old, wires: [{id: 'w1', from: 'R1:1', to: 'missing:0'}]},
  {...old, wires: [old.wires[0], {...old.wires[0], id: 'w2'}]},
  {...migrated, schematic: {...migrated.schematic, R1: {...migrated.schematic.R1, rotation: 45}}},
  {...migrated, components: [{...migrated.components[0], pins: ['invalid']}]},
]) assert.throws(() => parseProject(JSON.stringify(broken)));
console.log('Project model and migration checks passed.');
