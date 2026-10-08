export type Kind = 'R' | 'C' | 'L' | 'V' | 'G';
export type Rotation = 0 | 90 | 180 | 270;
export type Component = {id: string; kind: Kind; value: string; pins: string[]};
export type Wire = {id: string; from: string; to: string};
export type Placement = {x: number; y: number; rotation: Rotation};
export type Project = {version: 2; components: Component[]; wires: Wire[]; schematic: Record<string, Placement>};

export const GRID = 20;
export const snap = (value: number) => Math.round(value / GRID) * GRID;
export const defaults: Record<Kind, string> = {R: '1kΩ', C: '100nF', L: '10mH', V: '5V', G: 'GND'};
export const names: Record<Kind, string> = {R: 'Resistor', C: 'Capacitor', L: 'Inductor', V: 'Voltage Source', G: 'Ground'};
const kinds: Kind[] = ['R', 'C', 'L', 'V', 'G'];
const rotations: Rotation[] = [0, 90, 180, 270];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const validPoint = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000;

export function createComponent(kind: Kind, id: string): Component {
  return {id, kind, value: defaults[kind], pins: Array.from({length: kind === 'G' ? 1 : 2}, (_, i) => `${id}:${i}`)};
}

export function pinPosition(component: Component, placement: Placement, pin: string): {x: number; y: number} | null {
  const index = component.pins.indexOf(pin);
  if (index < 0) return null;
  const dx = component.kind === 'G' ? 0 : index === 0 ? -40 : 40;
  const dy = component.kind === 'G' ? -30 : 0;
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
  for (const entry of source) {
    if (!isRecord(entry) || !validId(entry.id) || !kinds.includes(entry.kind as Kind) ||
      typeof entry.value !== 'string' || entry.value.length > 120 || !entry.value.trim() ||
      componentIds.has(entry.id)) throw new Error('Invalid or duplicate component.');
    componentIds.add(entry.id);
    const kind = entry.kind as Kind;
    const component = createComponent(kind, entry.id);
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
  const wires: Wire[] = [];
  const wireIds = new Set<string>();
  const edges = new Set<string>();
  for (const entry of raw.wires) {
    if (!isRecord(entry) || !validId(entry.id) || !pinIds.has(entry.from as string) ||
      !pinIds.has(entry.to as string) || entry.from === entry.to ||
      wireIds.has(entry.id)) throw new Error('Invalid wire or pin reference.');
    wireIds.add(entry.id);
    const from = entry.from as string;
    const to = entry.to as string;
    const edge = JSON.stringify([from, to].sort());
    if (edges.has(edge)) throw new Error('Duplicate wire.');
    edges.add(edge);
    wires.push({id: entry.id, from, to});
  }
  return {version: 2, components, wires, schematic};
}
