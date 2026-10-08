import {strict as assert} from 'node:assert';
import test from 'node:test';
import {createComponent, parseProject, pinPosition, starterProject} from './model.ts';

test('Project v1 migration to v2 preserves components, pins, wires, and layout', () => {
  const old = {
    version: 1,
    parts: [
      {id: 'R1', kind: 'R', x: 120, y: 80, value: '1kΩ'},
      {id: 'G1', kind: 'G', x: 220, y: 80, value: 'GND'},
    ],
    wires: [{id: 'w1', from: 'R1:1', to: 'G1:0'}],
  };

  const migrated = parseProject(JSON.stringify(old));
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.components[0].pins, ['R1:0', 'R1:1']);
  assert.deepEqual(migrated.wires, old.wires);
  assert.deepEqual(migrated.schematic.R1, {x: 120, y: 80, rotation: 0});
  assert.deepEqual(parseProject(JSON.stringify(migrated)).wires, old.wires);
});

test('Rotated component pin positions calculate correctly according to angle', () => {
  assert.deepEqual(
    pinPosition(createComponent('R', 'R1'), {x: 120, y: 80, rotation: 90}, 'R1:0'),
    {x: 120, y: 40},
  );
  assert.deepEqual(
    pinPosition(createComponent('R', 'R1'), {x: 120, y: 80, rotation: 90}, 'R1:1'),
    {x: 120, y: 120},
  );
  assert.deepEqual(
    pinPosition(createComponent('G', 'G1'), {x: 220, y: 80, rotation: 0}, 'G1:0'),
    {x: 220, y: 50},
  );
});

test('Starter project initializes with default components and valid v2 schema', () => {
  const starter = starterProject();
  assert.equal(starter.components.length, 4);
  assert.equal(parseProject(JSON.stringify(starter)).components.length, 4);
});

test('Invalid project files and schemas are safely rejected', () => {
  const valid = {
    version: 1,
    parts: [
      {id: 'R1', kind: 'R', x: 120, y: 80, value: '1kΩ'},
      {id: 'G1', kind: 'G', x: 220, y: 80, value: 'GND'},
    ],
    wires: [{id: 'w1', from: 'R1:1', to: 'G1:0'}],
  };

  const migrated = parseProject(JSON.stringify(valid));

  const brokenCases = [
    {...valid, version: 99},
    {...valid, parts: [{...valid.parts[0], x: 'left'}]},
    {...valid, parts: [{...valid.parts[0], x: 1e99}]},
    {...valid, parts: [valid.parts[0], valid.parts[0]]},
    {...valid, wires: [{id: 'w1', from: 'R1:1', to: 'missing:0'}]},
    {...valid, wires: [valid.wires[0], {...valid.wires[0], id: 'w2'}]},
    {...migrated, schematic: {...migrated.schematic, R1: {...migrated.schematic.R1, rotation: 45}}},
    {...migrated, components: [{...migrated.components[0], pins: ['invalid']}]},
  ];

  for (const broken of brokenCases) {
    assert.throws(() => parseProject(JSON.stringify(broken)));
  }
});
