import React, {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {analyzeCircuit} from './circuit/engine';
import {
  createComponent,
  GRID,
  names,
  parseProject,
  pinLabels,
  pinPosition,
  snap,
  starterProject,
} from './circuit/model';
import type {Kind, Placement, Project, Rotation} from './circuit/model';
import {useHistory} from './hooks/useHistory';
import {checkBackendHealth, requestSimulation} from './simulation/api';
import type {SimulationResult, SimulationStatus} from './simulation/api';
import './style.css';

type Tool = 'select' | 'wire' | 'pan' | Kind;
type Selection = {type: 'component' | 'wire'; id: string} | null;
type Drag =
  | {type: 'component'; id: string; pointerId: number; start: {x: number; y: number}; original: Placement}
  | {type: 'pan'; pointerId: number; clientX: number; clientY: number; x: number; y: number; zoom: number};

const kinds: Kind[] = ['R', 'C', 'L', 'V', 'G'];

function formatEngineering(val: number, unit: string): string {
  if (!Number.isFinite(val)) return 'NaN';
  if (Math.abs(val) < 1e-15) return `0.000 ${unit}`;
  const abs = Math.abs(val);
  const sign = val < 0 ? '−' : '';
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(3)} M${unit}`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(3)} k${unit}`;
  if (abs >= 1) return `${sign}${abs.toFixed(3)} ${unit}`;
  if (abs >= 1e-3) return `${sign}${(abs * 1e3).toFixed(3)} m${unit}`;
  if (abs >= 1e-6) return `${sign}${(abs * 1e6).toFixed(3)} µ${unit}`;
  if (abs >= 1e-9) return `${sign}${(abs * 1e9).toFixed(3)} n${unit}`;
  if (abs >= 1e-12) return `${sign}${(abs * 1e12).toFixed(3)} p${unit}`;
  return `${sign}${val.toExponential(3)} ${unit}`;
}

function Symbol({kind}: {kind: Kind}) {
  if (kind === 'R') return <path d="M-20 0 l5 -10 10 20 10 -20 10 20 5 -10"/>;
  if (kind === 'C') return <><path d="M-6 -15 V15 M6 -15 V15"/><path d="M-20 0 H-6 M6 0 H20"/></>;
  if (kind === 'L') return <path d="M-20 0 q5 -20 10 0 q5 -20 10 0 q5 -20 10 0 q5 -20 10 0"/>;
  if (kind === 'V') {
    return (
      <>
        <circle r="19"/>
        <text x="-9" y="4" fontSize="12" textAnchor="middle" fill="#64748b" fontWeight="bold">−</text>
        <text x="9" y="4" fontSize="12" textAnchor="middle" fill="#0284c7" fontWeight="bold">+</text>
      </>
    );
  }
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

  // Simulation state
  const [simStatus, setSimStatus] = useState<SimulationStatus>('idle');
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [resultsExpanded, setResultsExpanded] = useState<boolean>(true);
  const [simSettingsOpen, setSimSettingsOpen] = useState<boolean>(false);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  const svg = useRef<SVGSVGElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const netlistDialog = useRef<HTMLDialogElement>(null);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const drag = useRef<Drag | null>(null);
  const previewRef = useRef<Placement | null>(null);
  const valueStart = useRef<{id: string; value: string} | null>(null);
  const [valueDraft, setValueDraft] = useState<{id: string; value: string} | null>(null);
  const valueDraftRef = useRef<{id: string; value: string} | null>(null);

  const selectedComponent = selected?.type === 'component'
    ? project.components.find((component) => component.id === selected.id) : undefined;
  const selectedWire = selected?.type === 'wire'
    ? project.wires.find((wire) => wire.id === selected.id) : undefined;

  const analysis = analyzeCircuit(project);

  // Check backend availability on load
  const refreshBackendStatus = useCallback(async () => {
    const health = await checkBackendHealth();
    setBackendOnline(health.available);
  }, []);

  useEffect(() => {
    void refreshBackendStatus();
  }, [refreshBackendStatus]);

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
        commit((val) => val.components.some((c) => c.id === current.id)
          ? {...val, schematic: {...val.schematic, [current.id]: placement}} : val);
    }
    drag.current = null;
    previewRef.current = null;
    setPreview(null);
  }

  function addComponent(kind: Kind, location: {x: number; y: number}) {
    let index = 1;
    while (project.components.some((item) => item.id === `${kind}${index}`)) index++;
    const component = createComponent(kind, `${kind}${index}`);
    commit((val) => ({...val, components: [...val.components, component], schematic: {
      ...val.schematic, [component.id]: {
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
    if (pin !== pending && !project.wires.some((w) =>
      (w.from === pending && w.to === pin) || (w.from === pin && w.to === pending))) {
      let index = 1;
      while (project.wires.some((w) => w.id === `w${index}`)) index++;
      commit((val) => ({...val, wires: [...val.wires, {id: `w${index}`, from: pending, to: pin}]}));
      setMessage('Wire connected.');
    }
    setPending(null);
  }

  function remove() {
    if (!selected) return;
    if (selected.type === 'wire') commit((val) => ({...val, wires: val.wires.filter((w) => w.id !== selected.id)}));
    else commit((val) => {
      const component = val.components.find((item) => item.id === selected.id);
      if (!component) return val;
      const pins = new Set(component.pins);
      const schematic = {...val.schematic};
      delete schematic[component.id];
      return {...val, schematic, components: val.components.filter((item) => item.id !== component.id),
        wires: val.wires.filter((w) => !pins.has(w.from) && !pins.has(w.to))};
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
    commit((val) => {
      const placement = val.schematic[id];
      if (!placement) return val;
      return {...val, schematic: {...val.schematic, [id]: {
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

  async function executeSimulation() {
    if (!analysis.netlist) {
      setMessage('Cannot simulate: fix circuit errors first.');
      return;
    }
    settingsDialog.current?.close();
    setSimSettingsOpen(false);
    setSimStatus('running');
    setSimError(null);
    setResultsExpanded(true);
    setMessage('Simulating with ngspice backend...');

    const result = await requestSimulation(analysis.netlist, 'op');
    if (result.status === 'success') {
      setSimResult(result);
      setSimStatus('completed');
      setBackendOnline(true);
      setMessage('Simulation completed successfully.');
    } else {
      setSimStatus('failed');
      setSimError(result.message ?? 'Simulation error');
      void refreshBackendStatus();
      setMessage(`Simulation failed: ${result.message ?? 'Unknown error'}`);
    }
  }

  function handleNewCircuit() {
    if (project.components.length > 0 && !window.confirm('Create new circuit? Any unsaved changes will be lost.')) return;
    reset({version: 2, components: [], wires: [], schematic: {}});
    setSelected(null);
    setPending(null);
    setSimStatus('idle');
    setSimResult(null);
    setSimError(null);
    setMessage('New blank circuit created.');
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (netlistDialog.current?.open || settingsDialog.current?.open) return;
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

  function download(name: string, contents: string, type: string) {
    const blob = new Blob([contents], {type});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function save() {
    download('circuit.json', JSON.stringify(project, null, 2), 'application/json');
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
      setSimStatus('idle');
      setSimResult(null);
      setSimError(null);
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

  // Build node to pins mapping for table display
  const nodePinsMap = new Map<string, string[]>();
  for (const net of analysis.nets) {
    nodePinsMap.set(net.name, net.pins);
  }

  return (
    <div className="app">
      {/* Top Toolbar */}
      <header>
        <div className="brand">
          ◈ <b>OpenCircuit</b> <span>Web Studio v0.4</span>
        </div>
        <div className="actions">
          <button onClick={handleNewCircuit} title="New circuit">＋ New</button>
          <button onClick={() => upload.current?.click()} title="Open saved project">⇪ Open</button>
          <input
            ref={upload}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="Open project JSON"
            onChange={(event) => void load(event.target.files?.[0])}
          />
          <button onClick={save} title="Save circuit to JSON file">⤓ Save</button>
          <button onClick={() => {undo(); setSelected(null); setPending(null);}} disabled={!canUndo} title="Undo (Ctrl+Z)">↶ Undo</button>
          <button onClick={() => {redo(); setSelected(null); setPending(null);}} disabled={!canRedo} title="Redo (Ctrl+Y)">↷ Redo</button>
          <button
            className="btn-primary"
            onClick={() => {
              setSimSettingsOpen(true);
              settingsDialog.current?.showModal();
            }}
            title="Configure and run simulation"
          >
            ▶ Run Simulation
          </button>
          <button onClick={() => netlistDialog.current?.showModal()} title="View SPICE netlist">
            Preview Netlist
          </button>
          <span
            className={`badge ${backendOnline === true ? 'badge-completed' : backendOnline === false ? 'badge-failed' : 'badge-idle'}`}
            style={{cursor: 'pointer'}}
            onClick={() => void refreshBackendStatus()}
            title="Click to check backend connection status"
          >
            {backendOnline === true ? '● Backend Ready' : backendOnline === false ? '○ Backend Offline' : '● Checking...'}
          </span>
        </div>
      </header>

      {/* Simulation Settings Modal Dialog */}
      <dialog
        ref={settingsDialog}
        aria-labelledby="sim-settings-title"
        onClick={(event) => {
          if (event.target === settingsDialog.current) {
            settingsDialog.current.close();
            setSimSettingsOpen(false);
          }
        }}
      >
        <div className="dialog-head">
          <h2 id="sim-settings-title">Simulation Settings</h2>
          <button onClick={() => {settingsDialog.current?.close(); setSimSettingsOpen(false);}} aria-label="Close dialog">✕</button>
        </div>
        <div className="dialog-body">
          <label style={{fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase'}}>
            Select Analysis Type
          </label>
          <div className="sim-type-group">
            <label className="sim-type-card selected">
              <input type="radio" name="sim-type" value="op" defaultChecked readOnly />
              <div>
                <strong>DC Operating Point (.op)</strong>
                <small>Calculates steady-state node voltages and source currents.</small>
              </div>
            </label>
            <label className="sim-type-card disabled" title="Coming in milestone v0.5">
              <input type="radio" name="sim-type" value="tran" disabled />
              <div>
                <strong>Transient Analysis (.tran) <span style={{color: '#0f766e', fontWeight: 600}}>(v0.5)</span></strong>
                <small>Time-domain voltage/current waveforms.</small>
              </div>
            </label>
            <label className="sim-type-card disabled" title="Coming in milestone v0.5">
              <input type="radio" name="sim-type" value="ac" disabled />
              <div>
                <strong>AC Frequency Sweep (.ac) <span style={{color: '#0f766e', fontWeight: 600}}>(v0.5)</span></strong>
                <small>Bode plot of magnitude and phase response.</small>
              </div>
            </label>
          </div>

          <div className="validation-box">
            <h4>Circuit Validation Check</h4>
            {analysis.issues.length ? (
              <ul>
                {analysis.issues.map((issue, idx) => (
                  <li key={idx} className={issue.severity}>
                    <strong>{issue.severity.toUpperCase()}:</strong> {issue.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{margin: 0, color: '#166534', fontSize: 13, fontWeight: 600}}>
                ✓ Circuit topology is valid for SPICE simulation.
              </p>
            )}
          </div>
        </div>
        <div className="dialog-foot">
          <button onClick={() => {settingsDialog.current?.close(); setSimSettingsOpen(false);}}>Cancel</button>
          <button
            className="btn-primary"
            onClick={() => void executeSimulation()}
            disabled={!analysis.netlist || simStatus === 'running'}
          >
            {analysis.netlist ? 'Run DC Simulation' : 'Fix Errors Before Simulating'}
          </button>
        </div>
      </dialog>

      {/* Netlist Preview Dialog */}
      <dialog
        ref={netlistDialog}
        aria-labelledby="netlist-title"
        className="netlist-dialog"
        onClick={(event) => {
          if (event.target === netlistDialog.current) netlistDialog.current.close();
        }}
      >
        <div className="dialog-head">
          <h2 id="netlist-title">SPICE Netlist Preview</h2>
          <button onClick={() => netlistDialog.current?.close()} aria-label="Close netlist preview">✕</button>
        </div>
        <p style={{margin: '0 0 12px', fontSize: 13, color: '#64748b'}}>
          Topological SPICE netlist generated from pin IDs and wires.
        </p>
        <h4 style={{margin: '12px 0 6px', fontSize: 12, textTransform: 'uppercase', color: '#64748b'}}>Validation</h4>
        {analysis.issues.length ? (
          <ul style={{margin: 0, paddingLeft: 20, fontSize: 13}}>
            {analysis.issues.map((issue, index) => (
              <li key={index} style={{color: issue.severity === 'error' ? '#b91c1c' : '#b45309'}}>
                <strong>{issue.severity}:</strong> {issue.message}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{margin: 0, fontSize: 13, color: '#166534'}}>✓ No validation issues found.</p>
        )}
        <h4 style={{margin: '12px 0 6px', fontSize: 12, textTransform: 'uppercase', color: '#64748b'}}>Electrical Nets</h4>
        <ul style={{margin: 0, paddingLeft: 20, fontSize: 13}}>
          {analysis.nets.map((net) => (
            <li key={net.name}>
              <strong>{net.name}</strong>: {net.pins.join(', ')}
            </li>
          ))}
        </ul>
        {analysis.netlist ? (
          <>
            <h4 style={{margin: '12px 0 6px', fontSize: 12, textTransform: 'uppercase', color: '#64748b'}}>Deterministic Netlist</h4>
            <pre>{analysis.netlist}</pre>
            <button onClick={() => {if (analysis.netlist) download('circuit.cir', analysis.netlist, 'text/plain');}}>
              Export Netlist (.cir)
            </button>
          </>
        ) : (
          <p style={{color: '#b91c1c', fontSize: 13}}>Fix the errors above to generate SPICE netlist.</p>
        )}
      </dialog>

      {/* Main 3-column Layout */}
      <main>
        {/* Left Column: Component Library & Tools */}
        <aside className="tools">
          <h3>Tools</h3>
          <button
            className={tool === 'select' ? 'active' : ''}
            aria-pressed={tool === 'select'}
            onClick={() => {setTool('select'); setPending(null);}}
          >
            ↖ Select / Move
          </button>
          <button
            className={tool === 'wire' ? 'active' : ''}
            aria-pressed={tool === 'wire'}
            onClick={() => {setTool('wire'); setPending(null);}}
          >
            ⌁ Wire
          </button>
          <button
            className={tool === 'pan' ? 'active' : ''}
            aria-pressed={tool === 'pan'}
            onClick={() => {setTool('pan'); setPending(null);}}
          >
            ✥ Pan
          </button>

          <h3>Components</h3>
          {kinds.map((kind) => (
            <button
              key={kind}
              className={tool === kind ? 'active' : ''}
              aria-pressed={tool === kind}
              onClick={() => {setTool(kind); setPending(null);}}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('application/x-opencircuit-kind', kind)}
            >
              <span className="component-symbol">{kind}</span>
              {names[kind]}
            </button>
          ))}
          <div className="hint">
            • <b>Place:</b> Drag or click component, then canvas.<br/>
            • <b>Wire:</b> Click two pin circles.<br/>
            • <b>Pan:</b> Drag canvas with middle-click or Pan tool.<br/>
            • <b>Rotate:</b> Select component, press Rotate 90°.
          </div>
        </aside>

        {/* Center Column: Schematic Canvas & Simulation Results Panel */}
        <section className="workspace">
          <div className="workspace-head">
            <strong>Schematic Canvas</strong>
            <div className="workspace-controls">
              <button onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out">−</button>
              <span aria-label="Zoom level">{Math.round(viewport.zoom * 100)}%</span>
              <button onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in">+</button>
              <button onClick={() => setViewport({x: 0, y: 0, zoom: 1})} title="Reset View">1:1</button>
            </div>
          </div>

          <div className="canvas-container">
            <svg
              ref={svg}
              role="img"
              aria-label="Schematic canvas"
              viewBox={`${viewport.x} ${viewport.y} ${viewWidth} ${viewHeight}`}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes('application/x-opencircuit-kind')) event.preventDefault();
              }}
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
                  drag.current = {
                    type: 'pan',
                    pointerId: event.pointerId,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    x: viewport.x,
                    y: viewport.y,
                    zoom: viewport.zoom,
                  };
                  svg.current?.setPointerCapture(event.pointerId);
                  return;
                }
                if (
                  event.button !== 0 ||
                  (event.target !== svg.current &&
                    !(event.target instanceof Element && event.target.classList.contains('grid-hit')))
                )
                  return;
                if (kinds.includes(tool as Kind)) {
                  const location = point(event);
                  if (!location) return;
                  addComponent(tool as Kind, location);
                } else if (tool === 'select') setSelected(null);
              }}
              onPointerMove={(event) => {
                const current = drag.current;
                if (!current || current.pointerId !== event.pointerId) return;
                if (current.type === 'pan') {
                  const scale = svg.current?.getScreenCTM()?.a;
                  if (scale)
                    setViewport((view) => ({
                      ...view,
                      x: current.x - (event.clientX - current.clientX) / scale,
                      y: current.y - (event.clientY - current.clientY) / scale,
                    }));
                } else {
                  const location = point(event);
                  if (!location) return;
                  const placement = {
                    ...current.original,
                    x: Math.max(-1_000_000, Math.min(1_000_000, snap(current.original.x + location.x - current.start.x))),
                    y: Math.max(-1_000_000, Math.min(1_000_000, snap(current.original.y + location.y - current.start.y))),
                  };
                  previewRef.current = placement;
                  setPreview({id: current.id, placement});
                }
              }}
              onPointerUp={(event) => finishDrag(event)}
              onPointerCancel={(event) => finishDrag(event, true)}
            >
              <defs>
                <pattern id="dots" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="1" fill="#cbd5e1" />
                </pattern>
              </defs>
              <rect className="grid-hit" x={viewport.x} y={viewport.y} width={viewWidth} height={viewHeight} fill="url(#dots)" />

              {/* Wires */}
              {project.wires.map((wire) => {
                const a = pinLocations.get(wire.from);
                const b = pinLocations.get(wire.to);
                if (!a || !b) return null;
                const isSelected = selectedWire?.id === wire.id;
                return (
                  <g
                    key={wire.id}
                    onPointerDown={(event) => {
                      if (tool !== 'select' || event.button !== 0) return;
                      event.stopPropagation();
                      setSelected({type: 'wire', id: wire.id});
                    }}
                  >
                    <path d={`M${a.x} ${a.y} H${b.x} V${b.y}`} stroke="transparent" strokeWidth="14" fill="none" />
                    <path
                      d={`M${a.x} ${a.y} H${b.x} V${b.y}`}
                      stroke={isSelected ? '#f59e0b' : '#0d9488'}
                      strokeWidth="3"
                      fill="none"
                      pointerEvents="none"
                    />
                  </g>
                );
              })}

              {/* Components */}
              {project.components.map((component) => {
                const placement = preview?.id === component.id ? preview.placement : project.schematic[component.id];
                if (!placement) return null;
                const isSelected = selectedComponent?.id === component.id;
                return (
                  <g key={component.id}>
                    <g
                      transform={`translate(${placement.x} ${placement.y})`}
                      onPointerDown={(event) => {
                        if (tool !== 'select' || event.button !== 0) return;
                        event.stopPropagation();
                        const start = point(event);
                        if (!start) return;
                        setSelected({type: 'component', id: component.id});
                        drag.current = {
                          type: 'component',
                          id: component.id,
                          pointerId: event.pointerId,
                          start,
                          original: placement,
                        };
                        svg.current?.setPointerCapture(event.pointerId);
                      }}
                      style={{cursor: tool === 'select' ? 'grab' : 'default'}}
                    >
                      <rect
                        x="-33"
                        y="-31"
                        width="66"
                        height="62"
                        rx="6"
                        fill={isSelected ? '#e0f2fe' : '#fff'}
                        stroke={isSelected ? '#0284c7' : 'transparent'}
                        strokeWidth="2"
                      />
                      <g
                        transform={`rotate(${placement.rotation})`}
                        stroke="#1e293b"
                        strokeWidth="2.5"
                        fill="none"
                        strokeLinecap="round"
                      >
                        <Symbol kind={component.kind} />
                        {component.kind !== 'G' && <path d="M-40 0 H-20 M20 0 H40" />}
                      </g>
                      <text x="0" y="-37" textAnchor="middle" fontSize="15" fill="#334155" fontWeight="600">
                        {component.id}
                      </text>
                      <text x="0" y="45" textAnchor="middle" fontSize="12" fill="#64748b">
                        {valueDraft?.id === component.id ? valueDraft.value : component.value}
                      </text>
                    </g>

                    {/* Pin Dots */}
                    {component.pins.map((pin, pIndex) => {
                      const position = pinLocations.get(pin);
                      const isPendingPin = pending === pin;
                      const label = pinLabels[component.kind]?.[pIndex] ?? '';
                      return (
                        position && (
                          <g key={pin}>
                            <circle
                              cx={position.x}
                              cy={position.y}
                              r="7"
                              fill={isPendingPin ? '#f59e0b' : '#fff'}
                              stroke="#0284c7"
                              strokeWidth="2.5"
                              onPointerDown={(event) => {
                                if (event.button !== 0 || tool !== 'wire') return;
                                event.stopPropagation();
                                connect(pin);
                              }}
                              style={{cursor: tool === 'wire' ? 'crosshair' : 'default'}}
                            />
                            {component.kind === 'V' && (
                              <text
                                x={position.x}
                                y={position.y - 10}
                                textAnchor="middle"
                                fontSize="11"
                                fill="#0f766e"
                                fontWeight="700"
                                pointerEvents="none"
                              >
                                {label}
                              </text>
                            )}
                          </g>
                        )
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="status" role="status">{message}</div>

          {/* Simulation Results Panel */}
          <div className={`results-panel ${resultsExpanded ? 'expanded' : 'collapsed'}`}>
            <div className="results-header">
              <div className="results-header-left">
                <span>Simulation Results</span>
                <span className={`badge badge-${simStatus}`}>
                  {simStatus === 'idle' && '● Idle'}
                  {simStatus === 'running' && '⟳ Running...'}
                  {simStatus === 'completed' && '✓ Completed'}
                  {simStatus === 'failed' && '✕ Failed'}
                </span>
                <div className="results-tabs">
                  <button className="tab-btn active">DC Operating Point</button>
                  <button className="tab-btn" disabled title="Waveforms for transient and AC simulations will arrive in v0.5">
                    Waveforms (v0.5)
                  </button>
                </div>
              </div>
              <div style={{display: 'flex', gap: 6, alignItems: 'center'}}>
                {simStatus === 'completed' && (
                  <button className="btn-sm" onClick={() => void executeSimulation()} title="Re-run simulation">
                    Re-run
                  </button>
                )}
                <button
                  className="btn-sm"
                  onClick={() => setResultsExpanded(!resultsExpanded)}
                  title={resultsExpanded ? 'Collapse panel' : 'Expand panel'}
                >
                  {resultsExpanded ? '▼ Collapse' : '▲ Expand'}
                </button>
              </div>
            </div>

            {resultsExpanded && (
              <div className="results-body">
                {simStatus === 'running' && (
                  <div className="empty-results">
                    <p style={{fontSize: 14, fontWeight: 600, color: '#0f766e'}}>
                      ⟳ Simulating circuit in ngspice...
                    </p>
                    <small>Executing DC operating point analysis safely via Python backend.</small>
                  </div>
                )}

                {simStatus === 'failed' && (
                  <div className="alert-error">
                    <div>
                      <strong>Simulation Failed:</strong>
                      <p style={{margin: '4px 0'}}>{simError}</p>
                      {simResult?.raw_output && <pre>{simResult.raw_output}</pre>}
                    </div>
                  </div>
                )}

                {simStatus === 'completed' && simResult && (
                  <div className="results-grid">
                    {/* Node Voltages Table */}
                    <div className="results-card">
                      <h4>Node Voltages (DC Operating Point)</h4>
                      <table className="sim-table">
                        <thead>
                          <tr>
                            <th>Node</th>
                            <th>Voltage (V)</th>
                            <th>Formatted</th>
                            <th>Pins</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(simResult.node_voltages)
                            .sort(([a], [b]) => a === '0' ? -1 : b === '0' ? 1 : a.localeCompare(b, undefined, {numeric: true}))
                            .map(([node, volt]) => (
                              <tr key={node}>
                                <td><strong>{node === '0' ? '0 (GND)' : node}</strong></td>
                                <td className="num-cell">{volt.toFixed(4)}</td>
                                <td className="num-cell" style={{color: '#0f766e'}}>{formatEngineering(volt, 'V')}</td>
                                <td style={{color: '#64748b', fontSize: 11}}>{nodePinsMap.get(node)?.join(', ') ?? '—'}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Branch Currents Table */}
                    <div className="results-card">
                      <h4>Source Branch Currents</h4>
                      {Object.keys(simResult.branch_currents).length > 0 ? (
                        <table className="sim-table">
                          <thead>
                            <tr>
                              <th>Source</th>
                              <th>Current (A)</th>
                              <th>Formatted</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(simResult.branch_currents).map(([comp, cur]) => (
                              <tr key={comp}>
                                <td><strong>{comp}</strong></td>
                                <td className="num-cell">{cur.toExponential(4)}</td>
                                <td className="num-cell" style={{color: '#0284c7'}}>{formatEngineering(cur, 'A')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p style={{color: '#64748b', fontSize: 12}}>No branch currents reported.</p>
                      )}
                    </div>
                  </div>
                )}

                {simStatus === 'idle' && (
                  <div className="empty-results">
                    Click <strong>▶ Run Simulation</strong> in the top toolbar to calculate DC operating voltages and currents using ngspice.
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Properties Panel */}
        <aside className="properties">
          <h3>Properties</h3>
          {selectedComponent ? (
            <>
              <label>Component</label>
              <p>
                <strong>{selectedComponent.id}</strong> · {names[selectedComponent.kind]}
              </p>
              <label htmlFor="component-value">Value</label>
              <input
                id="component-value"
                value={valueDraft?.id === selectedComponent.id ? valueDraft.value : selectedComponent.value}
                maxLength={120}
                onFocus={() => {
                  valueStart.current = {id: selectedComponent.id, value: selectedComponent.value};
                }}
                onChange={(event) => {
                  const draft = {id: selectedComponent.id, value: event.target.value};
                  valueDraftRef.current = draft;
                  setValueDraft(draft);
                }}
                onBlur={finishValueEdit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              <p style={{color: '#64748b', fontSize: 12}}>
                Rotation: {project.schematic[selectedComponent.id]?.rotation ?? 0}°
              </p>

              <div className="pin-nodes">
                <strong style={{display: 'block', marginBottom: 4, color: '#475569'}}>Electrical Connections</strong>
                {selectedComponent.pins.map((pin, idx) => {
                  const node = analysis.nets.find((net) => net.pins.includes(pin))?.name ?? 'unconnected';
                  const label = pinLabels[selectedComponent.kind]?.[idx] ?? '';
                  return (
                    <div key={pin}>
                      <span>{label ? `Pin ${label} (${pin})` : pin}:</span>
                      <strong style={{color: node === '0' ? '#166534' : node === 'unconnected' ? '#b91c1c' : '#0284c7'}}>
                        {node === '0' ? 'Node 0 (GND)' : node === 'unconnected' ? 'Not connected' : `Node ${node}`}
                      </strong>
                    </div>
                  );
                })}
              </div>

              <div style={{display: 'flex', gap: 6, marginTop: 8}}>
                <button onClick={rotate} style={{flex: 1}}>Rotate 90°</button>
                <button className="danger" onClick={remove} style={{flex: 1}}>Delete</button>
              </div>
            </>
          ) : selectedWire ? (
            <>
              <label>Selected Wire</label>
              <p>ID: {selectedWire.id}</p>
              <p style={{fontSize: 12, color: '#64748b'}}>
                From: <code>{selectedWire.from}</code><br/>
                To: <code>{selectedWire.to}</code>
              </p>
              <button className="danger" onClick={remove}>Delete wire</button>
            </>
          ) : (
            <p className="muted">Select a component or wire to inspect and edit its properties.</p>
          )}

          <h3>Circuit Summary</h3>
          <p style={{margin: '2px 0'}}>{project.components.length} components</p>
          <p style={{margin: '2px 0'}}>{project.wires.length} wires</p>
          <p style={{margin: '2px 0'}}>{analysis.nets.length} electrical nodes</p>
        </aside>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
