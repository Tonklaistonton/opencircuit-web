import {snap} from './model.ts';
import type {Point, Project, Wire} from './model.ts';

export function wireVertices(wire: Wire, positions: ReadonlyMap<string, Point>): Point[] {
  const a = positions.get(wire.from);
  const b = positions.get(wire.to);
  if (!a || !b) return [];
  const targets = [a, ...(wire.bends ?? []), b];
  const result: Point[] = [{...targets[0]}];
  for (const next of targets.slice(1)) {
    const prev = result[result.length - 1];
    // CAD routes use orthogonal horizontal-first elbows.
    if (prev.x !== next.x) result.push({x: next.x, y: prev.y});
    if (prev.y !== next.y) result.push({...next});
  }
  return result;
}

export function nearestWirePoint(wire: Wire, positions: ReadonlyMap<string, Point>, location: Point): Point | null {
  const vertices = wireVertices(wire, positions);
  let distance = Infinity;
  let best: Point | null = null;
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1];
    const b = vertices[i];
    const point = a.x === b.x
      ? {x: a.x, y: Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), snap(location.y)))}
      : {x: Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), snap(location.x))), y: a.y};
    const nextDistance = Math.hypot(point.x - location.x, point.y - location.y);
    if (nextDistance < distance) { distance = nextDistance; best = point; }
  }
  return distance <= 15 ? best : null;
}

export type WireTap = {project: Project; endpoint: string; split: boolean};

// Splits the electrically connected edge exactly where a user taps it.
// Crossing lines never join unless explicitly tapped; imported pin-to-pin projects remain valid.
export function tapWire(project: Project, wireId: string, at: Point, positions: ReadonlyMap<string, Point>): WireTap | null {
  const wire = project.wires.find((item) => item.id === wireId);
  if (!wire) return null;
  const vertices = wireVertices(wire, positions);
  if (vertices.length < 2) return null;
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  if (at.x === first.x && at.y === first.y) return {project, endpoint: wire.from, split: false};
  if (at.x === last.x && at.y === last.y) return {project, endpoint: wire.to, split: false};
  let index = -1;
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1];
    const b = vertices[i];
    const onVertical = a.x === b.x && at.x === a.x && at.y >= Math.min(a.y, b.y) && at.y <= Math.max(a.y, b.y);
    const onHorizontal = a.y === b.y && at.y === a.y && at.x >= Math.min(a.x, b.x) && at.x <= Math.max(a.x, b.x);
    if (onVertical || onHorizontal) {index = i; break;}
  }
  if (index < 0) return null;
  // Deliberately tapping a crossing on an already-existing junction joins the nets.
  const existing = Object.entries(project.junctions ?? {}).find(([, point]) => point.x === at.x && point.y === at.y);
  if (existing && (wire.from === existing[0] || wire.to === existing[0]))
    return {project, endpoint: existing[0], split: false};
  let j = 1;
  while ((project.junctions ?? {})[`J${j}`] || project.components.some((c) => c.id === `J${j}`)) j++;
  let w = 1;
  while (project.wires.some((item) => item.id === `w${w}`)) w++;
  const junctionId = existing?.[0] ?? `J${j}`;
  const pathA = [...vertices.slice(0, index), at];
  const pathB = [at, ...vertices.slice(index)];
  const firstWire: Wire = {id: wire.id, from: wire.from, to: junctionId, bends: pathA.slice(1, -1)};
  const secondWire: Wire = {id: `w${w}`, from: junctionId, to: wire.to, bends: pathB.slice(1, -1)};
  return {
    project: {...project, junctions: {...project.junctions, [junctionId]: at},
      wires: project.wires.flatMap((item) => item.id === wireId ? [firstWire, secondWire] : [item])},
    endpoint: junctionId, split: true,
  };
}

/** Adds an editable vertex to an existing segment without changing electrical topology. */
export function insertWireBend(wire: Wire, at: Point, positions: ReadonlyMap<string, Point>): Wire | null {
  const vertices = wireVertices(wire, positions);
  if (vertices.length < 2) return null;
  if (vertices.some((p) => p.x === at.x && p.y === at.y)) return null;
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1];
    const b = vertices[i];
    const onVertical = a.x === b.x && at.x === a.x && at.y > Math.min(a.y, b.y) && at.y < Math.max(a.y, b.y);
    const onHorizontal = a.y === b.y && at.y === a.y && at.x > Math.min(a.x, b.x) && at.x < Math.max(a.x, b.x);
    if (onVertical || onHorizontal) {
      const path = [...vertices.slice(0, i), at, ...vertices.slice(i)];
      return {...wire, bends: path.slice(1, -1)};
    }
  }
  return null;
}

/** Allocates a persistent schematic junction for a freehand wire endpoint. */
export function addFreeJunction(project: Project, at: Point): {project: Project; endpoint: string} {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || Math.abs(at.x) > 1e6 || Math.abs(at.y) > 1e6)
    throw new Error('Invalid free junction position.');
  const exists = Object.entries(project.junctions ?? {}).find(([, p]) => p.x === at.x && p.y === at.y);
  if (exists) return {project, endpoint: exists[0]};
  let i = 1;
  while ((project.junctions ?? {})[`J${i}`] || project.components.some((c) => c.id === `J${i}`)) i++;
  const endpoint = `J${i}`;
  return {project: {...project, junctions: {...project.junctions, [endpoint]: at}}, endpoint};
}

export function addWireEdge(project: Project, from: string, to: string, bends: Point[] = []): Project {
  if (from === to || project.wires.some((wire) =>
    (wire.from === from && wire.to === to) || (wire.from === to && wire.to === from))) return project;
  let i = 1;
  while (project.wires.some((wire) => wire.id === `w${i}`)) i++;
  return {...project, wires: [...project.wires, {id: `w${i}`, from, to, bends: bends.map((point) => ({...point}))}]};
}

/** Removes orphan junctions and their labels when a wire or part is deleted. */
export function pruneLooseJunctions(project: Project): Project {
  const used = new Set(project.wires.flatMap((wire) => [wire.from, wire.to]));
  const junctions = Object.fromEntries(Object.entries(project.junctions ?? {})
    .filter(([id]) => used.has(id)));
  const removed = new Set(Object.keys(project.junctions ?? {}).filter((id) => !used.has(id)));
  const netAliases = Object.fromEntries(Object.entries(project.netAliases ?? {})
    .filter(([endpoint]) => !removed.has(endpoint)));
  return {...project, junctions, netAliases};
}
