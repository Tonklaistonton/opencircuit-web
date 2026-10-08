import {strict as assert} from 'node:assert';
import test from 'node:test';
import {analyzeCircuit, extractNets, parseValue} from './engine.ts';
import {createComponent, pinPosition} from './model.ts';
import type {Kind, Project} from './model.ts';

function createTestCircuit(kinds: Kind[], edges: [string, string][]): Project {
  const components = kinds.map((kind, index) => createComponent(kind, `${kind}${index + 1}`));
  return {
    version: 2,
    components,
    wires: edges.map(([from, to], index) => ({id: `w${index + 1}`, from, to})),
    schematic: Object.fromEntries(components.map((component, index) => [
      component.id,
      {x: index * 120, y: 100, rotation: 0},
    ])),
  };
}

test('RC Low-pass filter (V1=5V, R1=1kΩ, C1=100nF) generates valid netlist with analytical cutoff', () => {
  const v1 = createComponent('V', 'V1');
  v1.value = '5V';
  const r1 = createComponent('R', 'R1');
  r1.value = '1kΩ';
  const c1 = createComponent('C', 'C1');
  c1.value = '100nF';
  const g1 = createComponent('G', 'G1');

  const rcProject: Project = {
    version: 2,
    components: [v1, r1, c1, g1],
    wires: [
      {id: 'w1', from: 'V1:0', to: 'G1:0'},
      {id: 'w2', from: 'V1:1', to: 'R1:0'},
      {id: 'w3', from: 'R1:1', to: 'C1:0'},
      {id: 'w4', from: 'C1:1', to: 'G1:0'},
    ],
    schematic: {
      V1: {x: 100, y: 100, rotation: 0},
      R1: {x: 300, y: 100, rotation: 0},
      C1: {x: 500, y: 100, rotation: 0},
      G1: {x: 500, y: 300, rotation: 0},
    },
  };

  const rVal = parseValue('R', r1.value);
  const cVal = parseValue('C', c1.value);
  assert.equal(rVal, 1000);
  assert.equal(cVal, 1e-7);

  // Analytical cutoff frequency: fc = 1 / (2 * pi * R * C) ≈ 1591.55 Hz
  const fc = 1 / (2 * Math.PI * rVal! * cVal!);
  assert.ok(Math.abs(fc - 1591.55) < 0.1, `Expected ~1591.55 Hz, got ${fc}`);

  const analysis = analyzeCircuit(rcProject);
  assert.deepEqual(analysis.issues, []);
  assert.ok(analysis.netlist !== null);
  assert.equal(
    analysis.netlist,
    'OpenCircuit schematic\nC1 n1 0 1e-7\nR1 n2 n1 1000\nV1 n2 0 DC 5\n.end\n',
  );
});

test('Voltage Divider (V1=10V, R1=1kΩ, R2=1kΩ) generates expected SPICE netlist with correct polarity', () => {
  const v1 = createComponent('V', 'V1'); v1.value = '10V';
  const r1 = createComponent('R', 'R1'); r1.value = '1kΩ';
  const r2 = createComponent('R', 'R2'); r2.value = '1kΩ';
  const g1 = createComponent('G', 'G1');

  // V1:0 (-) -> GND, V1:1 (+) -> R1:0 (n1)
  // R1:1 -> R2:0 (n2, Vout)
  // R2:1 -> GND
  const divider: Project = {
    version: 2,
    components: [v1, r1, r2, g1],
    wires: [
      {id: 'w1', from: 'V1:0', to: 'G1:0'},
      {id: 'w2', from: 'V1:1', to: 'R1:0'},
      {id: 'w3', from: 'R1:1', to: 'R2:0'},
      {id: 'w4', from: 'R2:1', to: 'G1:0'},
    ],
    schematic: {
      V1: {x: 100, y: 100, rotation: 0},
      R1: {x: 300, y: 100, rotation: 0},
      R2: {x: 300, y: 250, rotation: 0},
      G1: {x: 300, y: 400, rotation: 0},
    },
  };

  const res = analyzeCircuit(divider);
  assert.deepEqual(res.issues, []);
  assert.ok(res.netlist);
  assert.ok(res.netlist.includes('V1 n1 0 DC 10'));
  assert.ok(res.netlist.includes('R1 n1 n2 1000'));
  assert.ok(res.netlist.includes('R2 n2 0 1000'));
});

test('Voltage Source polarity reverses when pins are swapped', () => {
  const v1 = createComponent('V', 'V1'); v1.value = '10V';
  const r1 = createComponent('R', 'R1'); r1.value = '1kΩ';
  const g1 = createComponent('G', 'G1');

  // Swap terminals: V1:1 (+) -> GND, V1:0 (-) -> R1:0
  const reversed: Project = {
    version: 2,
    components: [v1, r1, g1],
    wires: [
      {id: 'w1', from: 'V1:1', to: 'G1:0'},
      {id: 'w2', from: 'V1:0', to: 'R1:0'},
      {id: 'w3', from: 'R1:1', to: 'G1:0'},
    ],
    schematic: {
      V1: {x: 100, y: 100, rotation: 0},
      R1: {x: 300, y: 100, rotation: 0},
      G1: {x: 200, y: 250, rotation: 0},
    },
  };

  const res = analyzeCircuit(reversed);
  assert.deepEqual(res.issues, []);
  assert.ok(res.netlist);
  // Positive pin (V1:1) is on node 0, negative pin (V1:0) is on node n1 -> V1 0 n1 DC 10
  assert.ok(res.netlist.includes('V1 0 n1 DC 10'));
});

test('Net Extraction merges connected pins into common electrical nodes', () => {
  const circuit = createTestCircuit(['V', 'R', 'R', 'G'], [
    ['V1:0', 'G4:0'],
    ['V1:1', 'R2:0'],
    ['R2:1', 'R3:0'],
    ['R3:1', 'G4:0'],
  ]);

  const nets = extractNets(circuit);
  assert.equal(nets.nets.length, 3);
  assert.deepEqual(nets.nets.map((n) => n.pins), [
    ['G4:0', 'R3:1', 'V1:0'],
    ['R2:0', 'V1:1'],
    ['R2:1', 'R3:0'],
  ]);
  assert.equal(nets.nodeByPin.get('G4:0'), '0');
  assert.equal(nets.nodeByPin.get('V1:0'), '0');
  assert.equal(nets.nodeByPin.get('R3:1'), '0');
});

test('Multiple Ground components are unified to SPICE node 0', () => {
  const circuit = createTestCircuit(['V', 'R', 'R', 'G', 'G'], [
    ['V1:0', 'G4:0'],
    ['V1:1', 'R2:0'],
    ['R2:0', 'R3:0'],
    ['R2:1', 'G5:0'],
    ['R3:1', 'G4:0'],
  ]);

  const nets = extractNets(circuit);
  assert.equal(nets.nodeByPin.get('G4:0'), '0');
  assert.equal(nets.nodeByPin.get('G5:0'), '0');
  assert.equal(nets.nodeByPin.get('R2:1'), '0');
  assert.equal(nets.nodeByPin.get('R3:1'), '0');

  const analysis = analyzeCircuit(circuit);
  assert.deepEqual(analysis.issues, []);
  assert.ok(analysis.netlist?.includes('R2 n1 0 1000'));
});

test('Multiple branching wires on a single node merge correctly', () => {
  const v1 = createComponent('V', 'V1');
  const r1 = createComponent('R', 'R1');
  const r2 = createComponent('R', 'R2');
  const r3 = createComponent('R', 'R3');
  const c1 = createComponent('C', 'C1');
  const g1 = createComponent('G', 'G1');

  const topology = {
    components: [v1, r1, r2, r3, c1, g1],
    wires: [
      {id: 'w1', from: 'V1:0', to: 'G1:0'},
      {id: 'w2', from: 'V1:1', to: 'R1:0'},
      {id: 'w3', from: 'R1:1', to: 'R2:0'},
      {id: 'w4', from: 'R2:0', to: 'R3:0'},
      {id: 'w5', from: 'R3:0', to: 'C1:0'},
      {id: 'w6', from: 'R2:1', to: 'G1:0'},
      {id: 'w7', from: 'R3:1', to: 'G1:0'},
      {id: 'w8', from: 'C1:1', to: 'G1:0'},
    ],
  };

  const nets = extractNets(topology);
  const n1 = nets.nets.find((net) => net.name === 'n1');
  assert.ok(n1);
  assert.deepEqual(n1.pins.sort(), ['C1:0', 'R1:1', 'R2:0', 'R3:0'].sort());

  const groundNet = nets.nets.find((net) => net.name === '0');
  assert.ok(groundNet);
  assert.deepEqual(groundNet.pins.sort(), ['C1:1', 'G1:0', 'R2:1', 'R3:1', 'V1:0'].sort());
});

test('Netlist generation is invariant to component translation and rotation', () => {
  const base = createTestCircuit(['V', 'R', 'C', 'G'], [
    ['V1:0', 'G4:0'],
    ['V1:1', 'R2:0'],
    ['R2:1', 'C3:0'],
    ['C3:1', 'G4:0'],
  ]);

  const movedAndRotated: Project = {
    ...base,
    schematic: {
      V1: {x: -9999, y: 12345, rotation: 90},
      R2: {x: 8888, y: -4567, rotation: 180},
      C3: {x: 0, y: 0, rotation: 270},
      G4: {x: 5432, y: 9876, rotation: 0},
    },
  };

  const res1 = analyzeCircuit(base);
  const res2 = analyzeCircuit(movedAndRotated);
  assert.equal(res1.netlist, res2.netlist);
  assert.deepEqual(extractNets(base).nets, extractNets(movedAndRotated).nets);
});

test('SI prefix and unit parsing supports standard electronic formats', () => {
  // Resistors
  assert.equal(parseValue('R', '1k'), 1000);
  assert.equal(parseValue('R', '1kΩ'), 1000);
  assert.equal(parseValue('R', '1kohm'), 1000);
  assert.equal(parseValue('R', '1 kohm'), 1000);
  assert.equal(parseValue('R', '1K'), 1000);
  assert.equal(parseValue('R', '1meg'), 1e6);
  assert.equal(parseValue('R', '1megΩ'), 1e6);
  assert.equal(parseValue('R', '1megohm'), 1e6);
  assert.equal(parseValue('R', '1MEG'), 1e6);
  assert.equal(parseValue('R', '1M'), 1e6);
  assert.equal(parseValue('R', '1MΩ'), 1e6);
  assert.equal(parseValue('R', '1mΩ'), 1e-3);
  assert.equal(parseValue('R', '100'), 100);

  // Capacitors
  assert.equal(parseValue('C', '100n'), 1e-7);
  assert.equal(parseValue('C', '100nF'), 1e-7);
  assert.equal(parseValue('C', '10u'), 1e-5);
  assert.equal(parseValue('C', '10uF'), 1e-5);
  assert.equal(parseValue('C', '10µF'), 1e-5);
  assert.equal(parseValue('C', '10μF'), 1e-5);
  assert.equal(parseValue('C', '100pF'), 1e-10);

  // Inductors
  assert.equal(parseValue('L', '10u'), 1e-5);
  assert.equal(parseValue('L', '10uH'), 1e-5);
  assert.equal(parseValue('L', '10mH'), 0.01);
  assert.equal(parseValue('L', '1H'), 1);

  // Voltage Source
  assert.equal(parseValue('V', '5'), 5);
  assert.equal(parseValue('V', '5V'), 5);
  assert.equal(parseValue('V', '-5V'), -5);
  assert.equal(parseValue('V', '0V'), 0);
  assert.equal(parseValue('V', '2.5V'), 2.5);
  assert.equal(parseValue('V', '100mV'), 0.1);
});

test('Invalid values, negative passives, unit mismatches, and injection attacks are rejected', () => {
  const invalid = [
    ['R', '0'],
    ['R', '0Ω'],
    ['R', '-10Ω'],
    ['C', '0F'],
    ['C', '-1uF'],
    ['L', '0H'],
    ['L', '-1mH'],
    ['R', 'invalid'],
    ['R', '10V'],
    ['C', '10Ω'],
    ['L', '10F'],
    ['V', '10Ω'],
    ['R', '1; .control'],
    ['R', 'NaN'],
    ['R', 'Infinity'],
    ['R', '1e999Ω'],
  ] as const;

  for (const [kind, val] of invalid) {
    assert.equal(parseValue(kind as Exclude<Kind, 'G'>, val), null, `Expected null for ${kind} ${val}`);
  }
});

test('Circuit validation identifies unconnected pins, missing ground, shorted parts, and floating nodes', () => {
  // 1. Unconnected pin
  const disconnected = createTestCircuit(['V', 'R', 'G'], [
    ['V1:0', 'G3:0'],
    ['V1:1', 'R2:0'],
  ]);
  const discResult = analyzeCircuit(disconnected);
  assert.equal(discResult.netlist, null);
  assert.ok(discResult.issues.some((i) => i.severity === 'error' && i.message.includes('R2:1: Pin is not connected')));

  // 2. Missing ground
  const noGround = createTestCircuit(['V', 'R'], [
    ['V1:0', 'R2:0'],
    ['V1:1', 'R2:1'],
  ]);
  const noGndResult = analyzeCircuit(noGround);
  assert.equal(noGndResult.netlist, null);
  assert.ok(noGndResult.issues.some((i) => i.severity === 'error' && i.message.includes('Add Ground (node 0)')));

  // 3. Shorted terminals
  const shorted = createTestCircuit(['V', 'R', 'G'], [
    ['V1:0', 'G3:0'],
    ['V1:1', 'R2:0'],
    ['R2:0', 'R2:1'],
  ]);
  const shortResult = analyzeCircuit(shorted);
  assert.equal(shortResult.netlist, null);
  assert.ok(shortResult.issues.some((i) => i.severity === 'error' && i.message.includes('R2: Both pins are on the same node (shorted)')));

  // 4. Floating node (isolated capacitors blocking DC path)
  const isolatedCap = createTestCircuit(['C', 'C', 'G'], [
    ['C1:0', 'G3:0'],
    ['C1:1', 'C2:0'],
    ['C2:1', 'G3:0'],
  ]);
  const isoResult = analyzeCircuit(isolatedCap);
  assert.equal(isoResult.netlist, null);
  assert.ok(isoResult.issues.some((i) => i.severity === 'error' && i.message.includes('Floating node')));

  // 5. Unconnected ground warning
  const unconnGnd = createTestCircuit(['V', 'R', 'G', 'G'], [
    ['V1:0', 'G3:0'],
    ['V1:1', 'R2:0'],
    ['R2:1', 'G3:0'],
  ]);
  const warnResult = analyzeCircuit(unconnGnd);
  assert.ok(warnResult.issues.some((i) => i.severity === 'warning' && i.message.includes('G4: Ground is not connected')));
});
