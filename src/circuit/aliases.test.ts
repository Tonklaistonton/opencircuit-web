import {strict as assert} from 'node:assert';
import test from 'node:test';
import {extractNets, analyzeCircuit, GENERIC_OPAMP_MODEL} from './engine.ts';
import {parseProject, createComponent} from './model.ts';
import {opAmpExampleProject} from './examples.ts';
import type {Project} from './model.ts';

test('Net aliases join electrically separate pin endpoints using identical names', () => {
  const a = createComponent('R', 'R1');
  const b = createComponent('R', 'R2');
  const project: Project = {version: 2, components: [a,b], wires: [], schematic: {
    R1: {x: 100,y: 100,rotation: 0}, R2: {x: 400,y: 100,rotation: 0},
  }, netAliases: {'R1:1': 'Vout', 'R2:0': 'VOUT'}};
  const nets = extractNets(project);
  assert.equal(nets.nodeByPin.get('R1:1'), 'VOUT');
  assert.equal(nets.nodeByPin.get('R2:0'), 'VOUT');
  assert.notEqual(nets.nodeByPin.get('R1:0'), 'VOUT');
  assert.equal(parseProject(JSON.stringify(project)).netAliases?.['R1:1'], 'Vout');
});

test('Different net aliases on the same connected node produce a real validation error', () => {
  const a = createComponent('R', 'R1');
  const b = createComponent('R', 'R2');
  const project: Project = {version: 2, components: [a,b],
    wires: [{id: 'w1', from: 'R1:1', to: 'R2:0'}],
    schematic: {R1: {x:100,y:100,rotation:0}, R2:{x:400,y:100,rotation:0}},
    netAliases: {'R1:1': 'VCC', 'R2:0': 'VEE'}};
  assert.throws(() => extractNets(project), /Conflicting net aliases/);
  assert.equal(analyzeCircuit(project).netlist, null);
});

test('Alias injection and invalid endpoint cannot be loaded', () => {
  const project = opAmpExampleProject();
  assert.throws(() => parseProject(JSON.stringify({...project, netAliases: {'U1:2': '.include evil'}})));
  assert.throws(() => parseProject(JSON.stringify({...project, netAliases: {'BAD:1': 'VCC'}})));
});

test('Editable Op-Amp example has true supply aliases, ground and junction topology', () => {
  const project = opAmpExampleProject();
  const parsed = parseProject(JSON.stringify(project));
  assert.equal(parsed.components.find((part) => part.id === 'U1')?.pins.length, 5);
  assert.equal(parsed.wires.length, 10);
  assert.deepEqual(parsed.junctions?.J1, {x: 420, y: 220});
  const nets = extractNets(parsed);
  assert.equal(nets.nodeByPin.get('U1:3'), 'VCC');
  assert.equal(nets.nodeByPin.get('V2:1'), 'VCC');
  assert.equal(nets.nodeByPin.get('U1:4'), 'VEE');
  assert.equal(nets.nodeByPin.get('V3:0'), 'VEE');
  assert.equal(nets.nodeByPin.get('U1:0'), nets.nodeByPin.get('R2:0'));
  assert.equal(nets.nodeByPin.get('U1:0'), nets.nodeByPin.get('R3:1'));
  assert.equal(nets.nodeByPin.get('V1:0'), '0');
  const analysis = analyzeCircuit(parsed);
  assert.ok(analysis.issues.some((issue) => issue.severity === 'warning' && issue.message.includes('Generic Op-Amp')));
  assert.ok(analysis.netlist);
  assert.ok(analysis.netlist.includes('XOP1 n1 n2 VCC VEE VOUT OC_OPAMP') || analysis.netlist.includes('XOP1'));
  assert.ok(analysis.netlist.includes(GENERIC_OPAMP_MODEL));
  assert.ok(analysis.netlist.endsWith('.op\n.end\n'));
  assert.deepEqual(analysis.issues.filter((issue) => issue.severity === 'error'), []);
});

test('Old saved uA741 symbol is not silently simulated as a vendor model', () => {
  const project = opAmpExampleProject();
  const op = project.components.find((component) => component.id === 'U1')!;
  op.value = 'uA741 (symbol)';
  const fromSaved = parseProject(JSON.stringify(project));
  const blocked = analyzeCircuit(fromSaved);
  assert.equal(blocked.netlist, null);
  assert.ok(blocked.issues.some((issue) => issue.severity === 'error' &&
    issue.message.includes('Unsupported Op-Amp model')));
  fromSaved.components.find((component) => component.id === 'U1')!.value = 'Generic Op-Amp';
  const approximate = analyzeCircuit(fromSaved);
  assert.ok(approximate.netlist?.includes('XOP1 '));
  assert.ok(approximate.issues.some((issue) => issue.severity === 'warning' &&
    issue.message.includes('NOT a validated uA741')));
});
