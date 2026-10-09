import {createComponent} from './model.ts';
import type {Kind, Project} from './model.ts';

export type CircuitTopology = Pick<Project, 'components' | 'wires'> & Partial<Pick<Project, 'junctions' | 'netAliases'>>;
export type Net = {name: string; pins: string[]};
export type Nets = {nets: Net[]; nodeByPin: Map<string, string>};
export type Issue = {severity: 'error' | 'warning'; message: string};
export type Analysis = {nets: Net[]; issues: Issue[]; netlist: string | null};

// Built-in finite-gain, rail-limited behavioral op-amp (DC approximation, not a vendor uA741 model).
// This exact block is allowlisted independently by the Python simulation backend.
export const GENERIC_OPAMP_MODEL = [
  '.subckt OC_OPAMP INP INM VP VN OUT',
  'Bdrv core 0 V=min(max(100000*(v(INP)-v(INM)),v(VN)+1.5),v(VP)-1.5)',
  'Rout core OUT 50',
  'Rin INP INM 1e9',
  '.ends OC_OPAMP',
].join('\n');

const prefixes: Record<string, number> = {p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6,
  'μ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12};
const units: Record<Exclude<Kind, 'G' | 'O' | 'P'>, string[]> = {
  R: ['', 'Ω', 'Ohm', 'ohms'], C: ['', 'F'], L: ['', 'H'], V: ['', 'V'],
};

export function parseValue(kind: Exclude<Kind, 'G' | 'O' | 'P'>, value: string): number | null {
  const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(meg|[pnuµμmkKMGT]?)\s*(Ω|Ohm|ohms|F|H|V)?\s*$/i.exec(value);
  if (!match) return null;
  const [, amount, rawPrefix, rawUnit = ''] = match;
  const prefix = rawPrefix.toLowerCase() === 'meg' ? 1e6 : rawPrefix ? prefixes[rawPrefix] : 1;
  if (prefix === undefined || !units[kind].some((unit) => unit.toLowerCase() === rawUnit.toLowerCase())) return null;
  const number = Number(amount) * prefix;
  return Number.isFinite(number) && (kind === 'V' || number > 0) ? Number(number.toPrecision(15)) : null;
}

// Explicit junction endpoints are electrical topology; geometric wire crossings remain disconnected.
export function extractNets(circuit: CircuitTopology): Nets {
  const pins = new Map<string, string>();
  const parent = new Map<string, string>();
  const names = new Set<string>();
  for (const component of circuit.components) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(component.id) || names.has(component.id) ||
      !['R', 'C', 'L', 'V', 'G', 'O', 'P'].includes(component.kind) ||
      component.pins.join('|') !== createComponent(component.kind, component.id, component.partId).pins.join('|'))
      throw new Error(`Invalid component or pins: ${component.id}`);
    names.add(component.id);
    for (const pin of component.pins) {
      if (parent.has(pin)) throw new Error(`Duplicate pin: ${pin}`);
      parent.set(pin, pin);
      pins.set(pin, component.id);
    }
  }
  for (const id of Object.keys(circuit.junctions ?? {})) {
    if (!/^J[0-9]+$/.test(id) || parent.has(id) || names.has(id)) throw new Error(`Invalid or duplicate junction: ${id}`);
    const position = circuit.junctions?.[id];
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error(`Invalid junction coordinates: ${id}`);
    parent.set(id, id);
  }
  const root = (pin: string): string => {
    const parentPin = parent.get(pin);
    if (!parentPin) throw new Error(`Unknown pin: ${pin}`);
    if (parentPin === pin) return pin;
    const result = root(parentPin);
    parent.set(pin, result);
    return result;
  };
  const join = (a: string, b: string) => {
    const left = root(a);
    const right = root(b);
    if (left !== right) parent.set(right, left);
  };
  const wireIds = new Set<string>();
  const edges = new Set<string>();
  for (const wire of circuit.wires) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(wire.id) || wireIds.has(wire.id) ||
      wire.from === wire.to) throw new Error(`Invalid wire: ${wire.id}`);
    wireIds.add(wire.id);
    const edge = JSON.stringify([wire.from, wire.to].sort());
    if (edges.has(edge)) throw new Error(`Duplicate connection: ${wire.from} / ${wire.to}`);
    edges.add(edge);
    join(wire.from, wire.to);
  }
  const aliasEndpoints = new Map<string, string>();
  for (const [endpoint, alias] of Object.entries(circuit.netAliases ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(alias)) throw new Error(`Invalid net alias: ${alias}`);
    const normalized = alias.toUpperCase();
    const previous = aliasEndpoints.get(normalized);
    if (previous) join(previous, endpoint);
    else {root(endpoint); aliasEndpoints.set(normalized, endpoint);}
  }
  const grounds = circuit.components.filter((component) => component.kind === 'G');
  for (let i = 1; i < grounds.length; i++) join(grounds[0].pins[0], grounds[i].pins[0]);
  const groups = new Map<string, string[]>();
  for (const pin of pins.keys()) {
    const id = root(pin);
    groups.set(id, [...(groups.get(id) ?? []), pin]);
  }
  const ordered = [...groups.values()].map((group) => group.sort())
    .sort((a, b) => a[0].localeCompare(b[0], 'en'));
  const groundRoot = grounds.length ? root(grounds[0].pins[0]) : null;
  const aliasByRoot = new Map<string, string>();
  for (const [endpoint, alias] of Object.entries(circuit.netAliases ?? {})) {
    const id = root(endpoint);
    const upper = alias.toUpperCase();
    const existing = aliasByRoot.get(id);
    if (existing && existing !== upper) throw new Error(`Conflicting net aliases: ${existing} / ${upper}`);
    aliasByRoot.set(id, upper);
  }
  const reservedAliases = new Set(aliasByRoot.values());
  const nodeByPin = new Map<string, string>();
  let next = 1;
  const nets = ordered.map((group) => {
    const id = root(group[0]);
    let name = groundRoot && id === groundRoot ? '0' : aliasByRoot.get(id);
    if (!name) {
      do {name = `n${next++}`;} while (reservedAliases.has(name.toUpperCase()));
    }
    group.forEach((pin) => nodeByPin.set(pin, name));
    return {name, pins: group};
  }).sort((a, b) => a.name === '0' ? -1 : b.name === '0' ? 1 : a.name.localeCompare(b.name, 'en', {numeric: true}));
  return {nets, nodeByPin};
}

export function analyzeCircuit(circuit: CircuitTopology): Analysis {
  let extracted: Nets;
  try { extracted = extractNets(circuit); }
  catch (error) { return {nets: [], issues: [{severity: 'error', message: error instanceof Error ? error.message : 'Invalid circuit.'}], netlist: null}; }
  const {nets, nodeByPin} = extracted;
  const issues: Issue[] = [];
  if (!circuit.components.some((component) => component.kind !== 'G'))
    issues.push({severity: 'error', message: 'Add a resistor, capacitor, inductor or voltage source.'});
  if (!circuit.components.some((component) => component.kind === 'G'))
    issues.push({severity: 'error', message: 'Add Ground (node 0) to the circuit.'});
  const connected = new Set(circuit.wires.flatMap((wire) => [wire.from, wire.to]));
  for (const label of new Set(Object.values(circuit.netAliases ?? {}).map((name) => name.toUpperCase()))) {
    const members = Object.entries(circuit.netAliases ?? {}).filter(([, name]) => name.toUpperCase() === label);
    if (members.length > 1) members.forEach(([endpoint]) => connected.add(endpoint));
  }
  for (const component of circuit.components) {
    if (component.kind === 'P') {
      issues.push({severity: 'error', message: `${component.id}: Library part "${component.value}" is schematic-only. SPICE simulation for this family is not yet supported.`});
      continue;
    }
    if (component.kind === 'G') {
      if (!connected.has(component.pins[0])) issues.push({severity: 'warning', message: `${component.id}: Ground is not connected.`});
      continue;
    }
    for (const pin of component.pins) {
      if (!connected.has(pin)) issues.push({severity: 'error', message: `${pin}: Pin is not connected.`});
    }
    if (component.kind === 'O') {
      if (component.value.trim() !== 'Generic Op-Amp') {
        issues.push({severity: 'error', message: `${component.id}: Unsupported Op-Amp model "${component.value}". Select "Generic Op-Amp" in Properties, or import a verified vendor SPICE model (not supported yet).`});
      } else {
        issues.push({severity: 'warning', message: `${component.id}: Generic Op-Amp is an approximate rail-limited DC model, NOT a validated uA741 model.`});
      }
      const inputMinus = nodeByPin.get(component.pins[0]);
      const inputPlus = nodeByPin.get(component.pins[1]);
      const positiveSupply = nodeByPin.get(component.pins[3]);
      const negativeSupply = nodeByPin.get(component.pins[4]);
      if (inputMinus === inputPlus) issues.push({severity: 'warning', message: `${component.id}: Op-Amp inputs are connected to the same net.`});
      if (positiveSupply === negativeSupply)
        issues.push({severity: 'error', message: `${component.id}: Both Op-Amp supply pins are on the same net.`});
      continue;
    }
    if (nodeByPin.get(component.pins[0]) === nodeByPin.get(component.pins[1]))
      issues.push({severity: 'error', message: `${component.id}: Both pins are on the same node (shorted).`});
    if (parseValue(component.kind, component.value) === null)
      issues.push({severity: 'error', message: `${component.id}: Invalid ${component.kind} value "${component.value}". Use SI units (e.g. 1kΩ, 100nF, 5V).`});
  }
  // DC reference: capacitors do not conduct at the operating point.
  const reached = new Set<string>(['0']);
  let changed = true;
  while (changed) {
    changed = false;
    for (const component of circuit.components) {
      if (component.kind === 'G' || component.kind === 'C' || component.kind === 'P') continue;
      if (component.kind === 'O') {
        // The built-in behavioral source references ground and both supply rails.
        const output = nodeByPin.get(component.pins[2]);
        const supplyPlus = nodeByPin.get(component.pins[3]);
        const supplyMinus = nodeByPin.get(component.pins[4]);
        if (output && supplyPlus && supplyMinus && reached.has(supplyPlus) &&
          reached.has(supplyMinus) && !reached.has(output)) {
          reached.add(output); changed = true;
        }
        continue;
      }
      const a = nodeByPin.get(component.pins[0]);
      const b = nodeByPin.get(component.pins[1]);
      if (a && b && (reached.has(a) !== reached.has(b))) {
        reached.add(a); reached.add(b); changed = true;
      }
    }
  }
  for (const net of nets) {
    if (net.name !== '0' && !reached.has(net.name) && net.pins.some((pin) =>
      circuit.components.some((component) => component.kind !== 'G' && component.pins.includes(pin))))
      issues.push({severity: 'error', message: `${net.name}: Floating node; add a DC path to Ground (capacitors do not provide one).`});
  }
  if (issues.some((issue) => issue.severity === 'error')) return {nets, issues, netlist: null};
  const components = [...circuit.components].filter((component) => component.kind !== 'G' && component.kind !== 'P')
    .sort((a, b) => a.kind.localeCompare(b.kind, 'en') || a.id.localeCompare(b.id, 'en'));
  const counts: Record<Exclude<Kind, 'G' | 'P'>, number> = {R: 0, C: 0, L: 0, V: 0, O: 0};
  const lines = ['OpenCircuit schematic'];
  for (const component of components) {
    if (component.kind === 'G' || component.kind === 'P') continue;
    const kind = component.kind;
    if (kind === 'O') {
      const pins = component.pins.map((pin) => nodeByPin.get(pin));
      if (pins.some((node) => !node)) throw new Error('Circuit analysis lost an Op-Amp pin.');
      // Symbol pin order: IN-, IN+, OUT, V+, V-.
      // SPICE macro pins: INP, INM, VP, VN, OUT.
      lines.push(`XOP${++counts.O} ${pins[1]} ${pins[0]} ${pins[3]} ${pins[4]} ${pins[2]} OC_OPAMP`);
      continue;
    }
    const name = `${kind}${++counts[kind]}`;
    if (name !== component.id) lines.push(`* ${name} represents ${component.id}`);
    // In SPICE, V source syntax is V<name> <pos_node> <neg_node> DC <val>.
    // Pin 1 (pins[1]) is mapped to (+) and Pin 0 (pins[0]) is mapped to (-).
    const a = kind === 'V' ? nodeByPin.get(component.pins[1]) : nodeByPin.get(component.pins[0]);
    const b = kind === 'V' ? nodeByPin.get(component.pins[0]) : nodeByPin.get(component.pins[1]);
    const value = parseValue(kind, component.value);
    if (!a || !b || value === null) throw new Error('Circuit analysis lost a pin or value.');
    lines.push(`${name} ${a} ${b} ${kind === 'V' ? 'DC ' : ''}${value}`);
  }
  if (counts.O > 0) lines.push(...GENERIC_OPAMP_MODEL.split('\n'));
  lines.push('.op', '.end');
  return {nets, issues, netlist: lines.join('\n') + '\n'};
}
