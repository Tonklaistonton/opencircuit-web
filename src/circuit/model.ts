import {findLibraryPart} from './catalog.ts';
export type Kind = 'R' | 'C' | 'L' | 'V' | 'G' | 'O' | 'P';
export type Rotation = 0 | 90 | 180 | 270;
export type Component = {id: string; kind: Kind; value: string; pins: string[]; partId?: string};
export type Wire = {id: string; from: string; to: string; bends?: {x: number; y: number}[]};
export type Placement = {x: number; y: number; rotation: Rotation};
export type Point = {x: number; y: number};
export type Project = {version: 2; components: Component[]; wires: Wire[]; schematic: Record<string, Placement>; junctions?: Record<string, Point>; netAliases?: Record<string, string>};

export const GRID = 20;
export const snap = (value: number) => Math.round(value / GRID) * GRID;
export const defaults: Record<Kind, string> = {R: '1kΩ', C: '100nF', L: '10mH', V: '5V', G: 'GND', O: 'Generic Op-Amp', P: 'Library Part'};
export const names: Record<Kind, string> = {R: 'Resistor', C: 'Capacitor', L: 'Inductor', V: 'Voltage Source', G: 'Ground', O: 'Op-Amp (5-pin)', P: 'Library Part'};
export const pinLabels: Record<Kind, string[]> = {
  R: ['1', '2'],
  C: ['1', '2'],
  L: ['1', '2'],
  V: ['−', '+'], // pin 0 is negative (-), pin 1 is positive (+)
  G: ['GND'],
  O: ['IN−', 'IN+', 'OUT', 'V+', 'V−'],
  P: [],
};
const kinds: Kind[] = ['R', 'C', 'L', 'V', 'G', 'O', 'P'];
const rotations: Rotation[] = [0, 90, 180, 270];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const validPoint = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000;

export function createComponent(kind: Kind, id: string, partId?: string): Component {
  if (kind === 'P') {
    const definition = partId ? findLibraryPart(partId) : undefined;
    if (!definition || definition.kind !== 'P') throw new Error(`Unknown library part: ${partId ?? ''}`);
    return {id, kind, partId: definition.id, value: definition.defaultValue,
      pins: definition.pins.map((_, index) => `${id}:${index}`)};
  }
  return {id, kind, value: defaults[kind], pins: Array.from({length: kind === 'G' ? 1 : kind === 'O' ? 5 : 2}, (_, i) => `${id}:${i}`)};
}

export function pinPosition(component: Component, placement: Placement, pin: string): {x: number; y: number} | null {
  const index = component.pins.indexOf(pin);
  if (index < 0) return null;
  const opampPins = [{x: -60, y: -20}, {x: -60, y: 20}, {x: 80, y: 0}, {x: 0, y: -60}, {x: 0, y: 60}];
  const custom = component.kind === 'P' ? findLibraryPart(component.partId ?? '')?.pins[index] : undefined;
  if (component.kind === 'P' && !custom) return null;
  const dx = component.kind === 'P' ? custom!.x : component.kind === 'O' ? opampPins[index].x : component.kind === 'G' ? 0 : index === 0 ? -40 : 40;
  const dy = component.kind === 'P' ? custom!.y : component.kind === 'O' ? opampPins[index].y : component.kind === 'G' ? -30 : 0;
  const angle = placement.rotation * Math.PI / 180;
  return {x: placement.x + Math.round(dx * Math.cos(angle) - dy * Math.sin(angle)),
    y: placement.y + Math.round(dx * Math.sin(angle) + dy * Math.cos(angle))};
}

export function starterProject(): Project {
  const components = (['V', 'R', 'C', 'G'] as Kind[]).map((kind) => createComponent(kind, `${kind}1`));
  return {version: 2, components, wires: [], schematic: {
    V1: {x: 160, y: 180, rotation: 0}, R1: {x: 360, y: 180, rotation: 0},
    C1: {x: 560, y: 180, rotation: 0}, G1: {x: 560, y: 340, rotation: 0},
  }};
}

// ponytail: v1 migration preserves components and pin-to-pin wires; routed bends need a future schema.
export function parseProject(text: string): Project {
  if (text.length > 2_000_000) throw new Error('Project file is too large.');
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || (raw.version !== 1 && raw.version !== 2)) throw new Error('Unsupported project version.');
  const legacy = raw.version === 1;
  const source = legacy ? raw.parts : raw.components;
  if (!Array.isArray(source) || source.length > 2000 || !Array.isArray(raw.wires) || raw.wires.length > 10000)
    throw new Error('Invalid component or wire list.');
  if (!legacy && !isRecord(raw.schematic)) throw new Error('Invalid schematic layout.');
  const layout = legacy ? null : raw.schematic as Record<string, unknown>;
  const schematic: Record<string, Placement> = Object.create(null);
  const components: Component[] = [];
  const componentIds = new Set<string>();
  const pinIds = new Set<string>();
  const junctions: Record<string, Point> = Object.create(null);
  for (const entry of source) {
    if (!isRecord(entry) || !validId(entry.id) || !kinds.includes(entry.kind as Kind) ||
      typeof entry.value !== 'string' || entry.value.length > 120 || !entry.value.trim() ||
      componentIds.has(entry.id)) throw new Error('Invalid or duplicate component.');
    componentIds.add(entry.id);
    const kind = entry.kind as Kind;
    const component = createComponent(kind, entry.id, kind === 'P' ? entry.partId as string : undefined);
    if (kind !== 'P' && entry.partId !== undefined) throw new Error('Unexpected library part ID.');
    const pins = entry.pins;
    if (!legacy && (!Array.isArray(pins) || pins.length !== component.pins.length ||
      !component.pins.every((pin, i) => pins[i] === pin))) throw new Error('Invalid component pins.');
    const place: unknown = legacy ? entry : layout?.[component.id];
    if (!isRecord(place) || !validPoint(place.x) || !validPoint(place.y) ||
      (!legacy && !rotations.includes(place.rotation as Rotation))) throw new Error('Invalid component placement.');
    schematic[component.id] = {x: place.x, y: place.y, rotation: legacy ? 0 : place.rotation as Rotation};
    component.value = entry.value;
    components.push(component);
    component.pins.forEach((pin) => pinIds.add(pin));
  }
  if (layout && (Object.keys(layout).length !== components.length ||
    Object.keys(layout).some((id) => !Object.prototype.hasOwnProperty.call(schematic, id)))) throw new Error('Unexpected schematic placement.');
  if (!legacy && raw.junctions !== undefined) {
    if (!isRecord(raw.junctions) || Object.keys(raw.junctions).length > 10000) throw new Error('Invalid junction list.');
    for (const [id, position] of Object.entries(raw.junctions)) {
      if (!validId(id) || !/^J[0-9]+$/.test(id) || pinIds.has(id) || componentIds.has(id) || !isRecord(position) ||
        !validPoint(position.x) || !validPoint(position.y))
        throw new Error('Invalid junction position.');
      junctions[id] = {x: position.x, y: position.y};
    }
  }
  const endpoints = new Set([...pinIds, ...Object.keys(junctions)]);
  const netAliases: Record<string, string> = Object.create(null);
  if (!legacy && raw.netAliases !== undefined) {
    if (!isRecord(raw.netAliases) || Object.keys(raw.netAliases).length > 10000) throw new Error('Invalid net alias list.');
    for (const [endpoint, alias] of Object.entries(raw.netAliases)) {
      if (!endpoints.has(endpoint) || typeof alias !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(alias))
        throw new Error('Invalid net alias.');
      netAliases[endpoint] = alias;
    }
  }
  const wires: Wire[] = [];
  const wireIds = new Set<string>();
  const edges = new Set<string>();
  for (const entry of raw.wires) {
    if (!isRecord(entry) || !validId(entry.id) || !endpoints.has(entry.from as string) ||
      !endpoints.has(entry.to as string) || entry.from === entry.to ||
      wireIds.has(entry.id)) throw new Error('Invalid wire or pin reference.');
    wireIds.add(entry.id);
    const from = entry.from as string;
    const to = entry.to as string;
    const edge = JSON.stringify([from, to].sort());
    if (edges.has(edge)) throw new Error('Duplicate wire.');
    edges.add(edge);
    const bends = entry.bends === undefined ? [] : entry.bends;
    if (!Array.isArray(bends) || bends.length > 100 || bends.some((p) =>
      !isRecord(p) || !validPoint(p.x) || !validPoint(p.y))) throw new Error('Invalid wire bends.');
    wires.push({...{id: entry.id, from, to}, ...(bends.length ? {bends: bends.map((p) => ({x: p.x as number, y: p.y as number}))} : {})});
  }
  return {version: 2, components, wires, schematic, ...(Object.keys(junctions).length ? {junctions} : {}),
    ...(Object.keys(netAliases).length ? {netAliases} : {})};
}
