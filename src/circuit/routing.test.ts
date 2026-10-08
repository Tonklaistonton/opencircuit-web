import {strict as assert} from 'node:assert';
import test from 'node:test';
import {extractNets, analyzeCircuit} from './engine.ts';
import {createComponent, parseProject, pinPosition} from './model.ts';
import type {Point, Project} from './model.ts';
import {addFreeJunction, addWireEdge, insertWireBend, nearestWirePoint, pruneLooseJunctions, tapWire, wireVertices} from './routing.ts';

function basicProject(): Project {
  const v = createComponent('V', 'V1');
  const r1 = createComponent('R', 'R1');
  const r2 = createComponent('R', 'R2');
  const g = createComponent('G', 'G1');
  return {version: 2, components: [v, r1, r2, g], wires: [
    {id: 'w1', from: 'V1:1', to: 'R1:0', bends: [{x: 240, y: 120}]},
    {id: 'w2', from: 'V1:0', to: 'G1:0'},
    {id: 'w3', from: 'R1:1', to: 'G1:0'},
  ], schematic: {
    V1: {x: 100, y: 100, rotation: 0}, R1: {x: 360, y: 100, rotation: 0},
    R2: {x: 360, y: 300, rotation: 0}, G1: {x: 100, y: 300, rotation: 0},
  }};
}
function positions(project: Project): Map<string, Point> {
  const locations = new Map<string, Point>(Object.entries(project.junctions ?? {}));
  for (const component of project.components) {
    for (const pin of component.pins) {
      const position = pinPosition(component, project.schematic[component.id], pin);
      if (position) locations.set(pin, position);
    }
  }
  return locations;
}

test('Orthogonal routing stores exact wire polyline and supports hit-testing', () => {
  const project = basicProject();
  const points = wireVertices(project.wires[0], positions(project));
  assert.deepEqual(points, [
    {x: 140, y: 100}, {x: 240, y: 100}, {x: 240, y: 120},
    {x: 320, y: 120}, {x: 320, y: 100},
  ]);
  assert.deepEqual(nearestWirePoint(project.wires[0], positions(project), {x: 242, y: 109}), {x: 240, y: 100});
  assert.equal(nearestWirePoint(project.wires[0], positions(project), {x: 500, y: 500}), null);
});

test('T-junction creates explicit graph node and preserves route through JSON', () => {
  const original = basicProject();
  const result = tapWire(original, 'w1', {x: 200, y: 100}, positions(original));
  assert.ok(result?.split);
  assert.equal(result?.endpoint, 'J1');
  const tapped = result!.project;
  assert.equal(tapped.wires.length, 4);
  assert.deepEqual(tapped.junctions?.J1, {x: 200, y: 100});
  assert.deepEqual(wireVertices(tapped.wires[0], positions(tapped)), [
    {x: 140, y: 100}, {x: 200, y: 100},
  ]);
  const splitPart = tapped.wires.find((w) => w.from === 'J1')!;
  assert.deepEqual(wireVertices(splitPart, positions(tapped)), [
    {x: 200, y: 100}, {x: 240, y: 100}, {x: 240, y: 120},
    {x: 320, y: 120}, {x: 320, y: 100},
  ]);
  tapped.wires.push({id: 'w5', from: 'R2:0', to: 'J1'});
  tapped.wires.push({id: 'w6', from: 'R2:1', to: 'G1:0'});
  const nets = extractNets(tapped);
  assert.equal(nets.nodeByPin.get('V1:1'), nets.nodeByPin.get('R1:0'));
  assert.equal(nets.nodeByPin.get('R2:0'), nets.nodeByPin.get('R1:0'));
  assert.equal(parseProject(JSON.stringify(tapped)).junctions?.J1.x, 200);
  const analysis = analyzeCircuit(tapped);
  assert.ok(analysis.netlist?.includes('R2'));
});

test('Crossing without a deliberate junction does not short independent nets', () => {
  const project = basicProject();
  project.wires.push({id: 'w4', from: 'R2:0', to: 'R2:1', bends: [{x: 200, y: 100}]});
  const nets = extractNets(project);
  assert.notEqual(nets.nodeByPin.get('V1:1'), nets.nodeByPin.get('R2:0'));
});

test('Op-amp has five stable pins and safely blocks unsupported simulation', () => {
  const op = createComponent('O', 'O1');
  assert.equal(op.pins.length, 5);
  const p = {x: 400, y: 300, rotation: 0} as const;
  assert.deepEqual(pinPosition(op, p, 'O1:0'), {x: 340, y: 280});
  assert.deepEqual(pinPosition(op, p, 'O1:2'), {x: 480, y: 300});
  assert.deepEqual(pinPosition(op, p, 'O1:3'), {x: 400, y: 240});
  const project: Project = {version: 2, components: [op], schematic: {O1: p}, wires: []};
  assert.equal(parseProject(JSON.stringify(project)).components[0].pins.length, 5);
  const analysis = analyzeCircuit(project);
  assert.equal(analysis.netlist, null);
  assert.ok(analysis.issues.some((i) => i.message.includes('Op-Amp')));
});

test('Invalid junction references and coordinates are rejected on import', () => {
  const p = basicProject();
  p.junctions = {J1: {x: 200, y: 100}};
  p.wires[0].to = 'J1';
  assert.equal(parseProject(JSON.stringify(p)).wires[0].to, 'J1');
  assert.throws(() => parseProject(JSON.stringify({...p, junctions: {J1: {x: 'bad', y: 100}}})));
  assert.throws(() => parseProject(JSON.stringify({...p, junctions: {}})));
});

test('Double-click adds editable bend without changing circuit nodes', () => {
  const project = basicProject();
  const before = extractNets(project).nodeByPin.get('V1:1');
  const changed = insertWireBend(project.wires[0], {x: 200, y: 100}, positions(project));
  assert.ok(changed);
  assert.ok(changed?.bends?.some((p) => p.x === 200 && p.y === 100));
  const result = {...project, wires: [changed!, ...project.wires.slice(1)]};
  assert.equal(extractNets(result).nodeByPin.get('V1:1'), before);
  assert.equal(insertWireBend(changed!, {x: 200, y: 100}, positions(result)), null);
});

test('Freehand CAD wire starts and ends on real junction endpoints and survives save/load', () => {
  const project = basicProject();
  const from = addFreeJunction(project, {x: 200, y: 460});
  const to = addFreeJunction(from.project, {x: 460, y: 460});
  const joined = addWireEdge(to.project, from.endpoint, to.endpoint, [{x: 300, y: 400}]);
  assert.equal(joined.wires.length, project.wires.length + 1);
  const saved = parseProject(JSON.stringify(joined));
  assert.equal(saved.wires[saved.wires.length - 1].from, 'J1');
  assert.equal(saved.wires[saved.wires.length - 1].to, 'J2');
  assert.deepEqual(saved.wires[saved.wires.length - 1].bends, [{x: 300, y: 400}]);
  assert.deepEqual(saved.junctions?.J2, {x: 460, y: 460});
  assert.equal(addWireEdge(saved, 'J1', 'J1').wires.length, joined.wires.length);
  assert.throws(() => addFreeJunction(saved, {x: Infinity, y: 50}));
});

test('Existing snapped junction location is reused when starting a freehand branch', () => {
  const project = basicProject();
  const first = addFreeJunction(project, {x: 200, y: 200});
  const reused = addFreeJunction(first.project, {x: 200, y: 200});
  assert.equal(first.endpoint, reused.endpoint);
  assert.equal(Object.keys(reused.project.junctions ?? {}).length, 1);
});

test('Deleting last wire cleans up orphan junction and alias', () => {
  const project = basicProject();
  project.junctions = {J1: {x: 180,y: 180}};
  project.netAliases = {J1: 'TEMP', 'R1:1': 'OUT'};
  project.wires.push({id: 'w4',from:'J1',to:'R2:0'});
  const removed = pruneLooseJunctions({...project, wires:project.wires.filter((wire)=>wire.id !== 'w4')});
  assert.equal(removed.junctions?.J1, undefined);
  assert.equal(removed.netAliases?.J1, undefined);
  assert.equal(removed.netAliases?.['R1:1'], 'OUT');
});
