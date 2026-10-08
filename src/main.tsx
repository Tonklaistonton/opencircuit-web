import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createComponent, GRID, names, parseProject, pinPosition, snap, starterProject} from './circuit/model';
import type {Kind, Placement, Project, Rotation} from './circuit/model';
import {useHistory} from './hooks/useHistory';
import './style.css';

type Tool = 'select' | 'wire' | 'pan' | Kind;
type Selection = {type: 'component' | 'wire'; id: string} | null;
type Drag = {type: 'component'; id: string; pointerId: number; start: {x: number; y: number}; original: Placement} |
  {type: 'pan'; pointerId: number; clientX: number; clientY: number; x: number; y: number; zoom: number};
const kinds: Kind[] = ['R', 'C', 'L', 'V', 'G'];

function Symbol({kind}: {kind: Kind}) {
  if (kind === 'R') return <path d="M-20 0 l5 -10 10 20 10 -20 10 20 5 -10"/>;
  if (kind === 'C') return <><path d="M-6 -15 V15 M6 -15 V15"/><path d="M-20 0 H-6 M6 0 H20"/></>;
  if (kind === 'L') return <path d="M-20 0 q5 -20 10 0 q5 -20 10 0 q5 -20 10 0 q5 -20 10 0"/>;
  if (kind === 'V') return <><circle r="19"/><path d="M-8 0 H8 M0 -8 V8"/></>;
  return <path d="M0 -30 V0 M-18 0 H18 M-12 7 H12 M-6 14 H6"/>;
}

function App() {
  const {value: project, commit, undo, redo, reset, canUndo, canRedo} = useHistory<Project>(starterProject());
  const [tool, setTool] = useState<Tool>('select');
  const [pending, setPending] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [preview, setPreview] = useState<{id: string; placement: Placement} | null>(null);
  const [viewport, setViewport] = useState({x: 0, y: 0, zoom: 1});
  const [message, setMessage] = useState('Choose a component, then click the canvas to place it.');
  const svg = useRef<SVGSVGElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag | null>(null);
  const previewRef = useRef<Placement | null>(null);
  const valueStart = useRef<{id: string; value: string} | null>(null);
  const [valueDraft, setValueDraft] = useState<{id: string; value: string} | null>(null);
  const valueDraftRef = useRef<{id: string; value: string} | null>(null);
  const selectedComponent = selected?.type === 'component'
    ? project.components.find((component) => component.id === selected.id) : undefined;
  const selectedWire = selected?.type === 'wire'
    ? project.wires.find((wire) => wire.id === selected.id) : undefined;

  function point(event: {clientX: number; clientY: number}) {
    const matrix = svg.current?.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
  }

  function finishDrag(event: React.PointerEvent<SVGSVGElement>, cancelled = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!cancelled && current.type === 'component') {
      const location = point(event);
      const placement = location ? {...current.original,
        x: Math.max(-1_000_000, Math.min(1_000_000, snap(current.original.x + location.x - current.start.x))),
        y: Math.max(-1_000_000, Math.min(1_000_000, snap(current.original.y + location.y - current.start.y)))} : previewRef.current;
      if (placement && (placement.x !== current.original.x || placement.y !== current.original.y))
        commit((value) => value.components.some((component) => component.id === current.id)
          ? {...value, schematic: {...value.schematic, [current.id]: placement}} : value);
    }
    drag.current = null;
    previewRef.current = null;
    setPreview(null);
  }

  function addComponent(kind: Kind, location: {x: number; y: number}) {
    let index = 1;
    while (project.components.some((item) => item.id === `${kind}${index}`)) index++;
    const component = createComponent(kind, `${kind}${index}`);
    commit((value) => ({...value, components: [...value.components, component], schematic: {
      ...value.schematic, [component.id]: {
        x: Math.max(-1_000_000, Math.min(1_000_000, snap(location.x))),
        y: Math.max(-1_000_000, Math.min(1_000_000, snap(location.y))), rotation: 0,
      },
    }}));
    setSelected({type: 'component', id: component.id});
    setMessage(`Placed ${component.id}.`);
  }

  function connect(pin: string) {
    if (tool !== 'wire') return;
    if (!pending) {
      setPending(pin);
      setMessage('Select a second pin. Press Esc to cancel.');
      return;
    }
    if (pin !== pending && !project.wires.some((wire) =>
      (wire.from === pending && wire.to === pin) || (wire.from === pin && wire.to === pending))) {
      let index = 1;
      while (project.wires.some((wire) => wire.id === `w${index}`)) index++;
      commit((value) => ({...value, wires: [...value.wires, {id: `w${index}`, from: pending, to: pin}]}));
      setMessage('Wire connected.');
    }
    setPending(null);
  }

  function remove() {
    if (!selected) return;
    if (selected.type === 'wire') commit((value) => ({...value, wires: value.wires.filter((wire) => wire.id !== selected.id)}));
    else commit((value) => {
      const component = value.components.find((item) => item.id === selected.id);
      if (!component) return value;
      const pins = new Set(component.pins);
      const schematic = {...value.schematic};
      delete schematic[component.id];
      return {...value, schematic, components: value.components.filter((item) => item.id !== component.id),
        wires: value.wires.filter((wire) => !pins.has(wire.from) && !pins.has(wire.to))};
    });
    setPending(null);
    setSelected(null);
    drag.current = null;
    previewRef.current = null;
    setPreview(null);
    valueStart.current = null;
    valueDraftRef.current = null;
    setValueDraft(null);
  }

  function rotate() {
    if (!selectedComponent) return;
    const id = selectedComponent.id;
    commit((value) => {
      const placement = value.schematic[id];
      if (!placement) return value;
      return {...value, schematic: {...value.schematic, [id]: {
        ...placement, rotation: ((placement.rotation + 90) % 360) as Rotation,
      }}};
    });
  }

  function zoomBy(factor: number) {
    setViewport((view) => {
      const zoom = Math.max(0.5, Math.min(3, Number((view.zoom * factor).toFixed(2))));
      return {...view, x: view.x + (900 / view.zoom - 900 / zoom) / 2,
        y: view.y + (540 / view.zoom - 540 / zoom) / 2, zoom};
    });
  }

  function finishValueEdit() {
    const start = valueStart.current;
    const draft = valueDraftRef.current;
    valueStart.current = null;
    valueDraftRef.current = null;
    setValueDraft(null);
    if (!start || !draft || draft.id !== start.id || start.value === draft.value) return;
    if (!draft.value.trim()) {setMessage('Value cannot be empty.'); return;}
    if (draft.value.length > 120) {setMessage('Value is too long.'); return;}
    commit((current) => current.components.some((item) => item.id === start.id)
      ? {...current, components: current.components.map((item) =>
        item.id === start.id ? {...item, value: draft.value} : item)} : current);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))) return;
      if (event.key === 'Escape') {
        drag.current = null; previewRef.current = null; setPreview(null);
        setPending(null); setTool('select'); setMessage('Cancelled.');
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        setSelected(null);
        setPending(null);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); redo(); setSelected(null); setPending(null);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selected) { event.preventDefault(); remove(); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function save() {
    const blob = new Blob([JSON.stringify(project, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'circuit.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function load(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Project file is too large.');
      const next = parseProject(await file.text());
      reset(next);
      drag.current = null;
      previewRef.current = null;
      setPreview(null);
      valueStart.current = null;
      valueDraftRef.current = null;
      setValueDraft(null);
      setSelected(null);
      setPending(null);
      setMessage(`Project loaded (v${next.version}).`);
    } catch (error) {
      setMessage(`Cannot open project: ${error instanceof Error ? error.message : 'Invalid file.'}`);
    } finally {
      if (upload.current) upload.current.value = '';
    }
  }

  const pinLocations = new Map<string, {x: number; y: number}>();
  for (const component of project.components) {
    const placement = preview?.id === component.id ? preview.placement : project.schematic[component.id];
    if (!placement) continue;
    for (const pin of component.pins) {
      const position = pinPosition(component, placement, pin);
      if (position) pinLocations.set(pin, position);
    }
  }
  const viewWidth = 900 / viewport.zoom;
  const viewHeight = 540 / viewport.zoom;

  return <div className="app">
    <header><div className="brand">◈ <b>OpenCircuit</b> <span>Web Studio</span></div>
      <div className="actions"><button onClick={save}>Save JSON</button>
        <button onClick={() => upload.current?.click()}>Open JSON</button>
        <input ref={upload} type="file" accept=".json,application/json" hidden aria-label="Open project JSON"
          onChange={(event) => void load(event.target.files?.[0])}/>
        <span className="unavailable">Simulation not available</span></div></header>
    <main><aside className="tools"><h3>Tools</h3>
      <button className={tool === 'select' ? 'active' : ''} aria-pressed={tool === 'select'}
        onClick={() => {setTool('select'); setPending(null);}}>↖ Select / Move</button>
      <button className={tool === 'wire' ? 'active' : ''} aria-pressed={tool === 'wire'}
        onClick={() => {setTool('wire'); setPending(null);}}>⌁ Wire</button>
      <button className={tool === 'pan' ? 'active' : ''} aria-pressed={tool === 'pan'}
        onClick={() => {setTool('pan'); setPending(null);}}>✥ Pan</button>
      <h3>Components</h3>{kinds.map((kind) => <button key={kind} className={tool === kind ? 'active' : ''}
        aria-pressed={tool === kind} onClick={() => {setTool(kind); setPending(null);}}
        draggable onDragStart={(event) => event.dataTransfer.setData('application/x-opencircuit-kind', kind)}>
        <span className="component-symbol">{kind}</span>{names[kind]}</button>)}
      <div className="hint">Click a component then the canvas, or drag it onto the canvas. Wire: click two pin dots. Pan: drag the canvas or use the middle mouse button.</div>
    </aside>
    <section className="workspace"><div className="workspace-head"><strong>Schematic Editor</strong>
      <div className="workspace-controls"><button onClick={() => {undo(); setSelected(null); setPending(null);}} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
        <button onClick={() => {redo(); setSelected(null); setPending(null);}} disabled={!canRedo} title="Redo (Ctrl+Y)">Redo</button>
        <button onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">−</button>
        <span aria-label="Zoom level">{Math.round(viewport.zoom * 100)}%</span>
        <button onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button></div></div>
      <svg ref={svg} role="img" aria-label="Schematic canvas" viewBox={`${viewport.x} ${viewport.y} ${viewWidth} ${viewHeight}`}
        onDragOver={(event) => {if (event.dataTransfer.types.includes('application/x-opencircuit-kind')) event.preventDefault();}}
        onDrop={(event) => {
          const kind = event.dataTransfer.getData('application/x-opencircuit-kind');
          if (!kinds.includes(kind as Kind)) return;
          event.preventDefault();
          const location = point(event);
          if (location) addComponent(kind as Kind, location);
        }}
        onPointerDown={(event) => {
          if (event.button === 1 || (tool === 'pan' && event.button === 0)) {
            event.preventDefault();
            drag.current = {type: 'pan', pointerId: event.pointerId, clientX: event.clientX,
              clientY: event.clientY, x: viewport.x, y: viewport.y, zoom: viewport.zoom};
            svg.current?.setPointerCapture(event.pointerId);
            return;
          }
          if (event.button !== 0 || (event.target !== svg.current &&
            !(event.target instanceof Element && event.target.classList.contains('grid-hit')))) return;
          if (kinds.includes(tool as Kind)) {
            const location = point(event);
            if (!location) return;
            const kind = tool as Kind;
            addComponent(kind, location);
          } else if (tool === 'select') setSelected(null);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          if (current.type === 'pan') {
            const scale = svg.current?.getScreenCTM()?.a;
            if (scale) setViewport((view) => ({...view, x: current.x - (event.clientX - current.clientX) / scale,
              y: current.y - (event.clientY - current.clientY) / scale}));
          } else {
            const location = point(event);
            if (!location) return;
            const placement = {...current.original,
              x: Math.max(-1_000_000, Math.min(1_000_000, snap(current.original.x + location.x - current.start.x))),
              y: Math.max(-1_000_000, Math.min(1_000_000, snap(current.original.y + location.y - current.start.y)))};
            previewRef.current = placement;
            setPreview({id: current.id, placement});
          }
        }}
        onPointerUp={(event) => finishDrag(event)} onPointerCancel={(event) => finishDrag(event, true)}>
        <defs><pattern id="dots" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="#cbd5e1"/></pattern></defs>
        <rect className="grid-hit" x={viewport.x} y={viewport.y} width={viewWidth} height={viewHeight} fill="url(#dots)"/>
        {project.wires.map((wire) => {
          const a = pinLocations.get(wire.from);
          const b = pinLocations.get(wire.to);
          if (!a || !b) return null;
          return <g key={wire.id} onPointerDown={(event) => {
            if (tool !== 'select' || event.button !== 0) return;
            event.stopPropagation(); setSelected({type: 'wire', id: wire.id});
          }}><path d={`M${a.x} ${a.y} H${b.x} V${b.y}`} stroke="transparent" strokeWidth="14" fill="none"/>
            <path d={`M${a.x} ${a.y} H${b.x} V${b.y}`} stroke={selectedWire?.id === wire.id ? '#f59e0b' : '#0d9488'}
              strokeWidth="3" fill="none" pointerEvents="none"/></g>;
        })}
        {project.components.map((component) => {
          const placement = preview?.id === component.id ? preview.placement : project.schematic[component.id];
          if (!placement) return null;
          return <g key={component.id}>
            <g transform={`translate(${placement.x} ${placement.y})`} onPointerDown={(event) => {
              if (tool !== 'select' || event.button !== 0) return;
              event.stopPropagation();
              const start = point(event);
              if (!start) return;
              setSelected({type: 'component', id: component.id});
              drag.current = {type: 'component', id: component.id, pointerId: event.pointerId, start, original: placement};
              svg.current?.setPointerCapture(event.pointerId);
            }} style={{cursor: tool === 'select' ? 'grab' : 'default'}}>
              <rect x="-33" y="-31" width="66" height="62" rx="6" fill={selectedComponent?.id === component.id ? '#e0f2fe' : '#fff'}
                stroke={selectedComponent?.id === component.id ? '#0284c7' : 'transparent'} strokeWidth="2"/>
              <g transform={`rotate(${placement.rotation})`} stroke="#1e293b" strokeWidth="2.5" fill="none" strokeLinecap="round">
                <Symbol kind={component.kind}/>{component.kind !== 'G' && <path d="M-40 0 H-20 M20 0 H40"/>}</g>
              <text x="0" y="-37" textAnchor="middle" fontSize="15" fill="#334155" fontWeight="600">{component.id}</text>
              <text x="0" y="45" textAnchor="middle" fontSize="12" fill="#64748b">{valueDraft?.id === component.id ? valueDraft.value : component.value}</text>
            </g>{component.pins.map((pin) => {
              const position = pinLocations.get(pin);
              return position && <circle key={pin} cx={position.x} cy={position.y} r="7"
                fill={pending === pin ? '#f59e0b' : '#fff'} stroke="#0284c7" strokeWidth="2.5"
                onPointerDown={(event) => {
                  if (event.button !== 0 || tool !== 'wire') return;
                  event.stopPropagation(); connect(pin);
                }}
                style={{cursor: tool === 'wire' ? 'crosshair' : 'default'}}/>;
            })}</g>;
        })}
      </svg><div className="status" role="status">{message}</div></section>
    <aside className="properties"><h3>Properties</h3>{selectedComponent ? <>
      <label>Component</label><p>{selectedComponent.id} · {names[selectedComponent.kind]}</p>
      <label htmlFor="component-value">Value</label>
      <input id="component-value" value={valueDraft?.id === selectedComponent.id ? valueDraft.value : selectedComponent.value}
        maxLength={120} onFocus={() => {valueStart.current = {id: selectedComponent.id, value: selectedComponent.value};}}
        onChange={(event) => {
          const draft = {id: selectedComponent.id, value: event.target.value};
          valueDraftRef.current = draft;
          setValueDraft(draft);
        }}
        onBlur={finishValueEdit} onKeyDown={(event) => {if (event.key === 'Enter') event.currentTarget.blur();}}/>
      <p>Rotation: {project.schematic[selectedComponent.id]?.rotation ?? 0}°</p>
      <button onClick={rotate}>Rotate 90°</button>
      <button className="danger" onClick={remove}>Delete selected</button>
    </> : selectedWire ? <><p>Selected wire</p><button className="danger" onClick={remove}>Delete wire</button></>
      : <p className="muted">Select a component to edit its value.</p>}
      <h3>Project</h3><p>{project.components.length} components</p><p>{project.wires.length} wires</p>
      <div className="hint">Visual editor only. Electrical validation and simulation are not available yet.</div>
    </aside></main></div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
