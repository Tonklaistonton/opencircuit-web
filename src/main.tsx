import React, {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {analyzeCircuit} from './circuit/engine';
import {opAmpExampleProject} from './circuit/examples';
import {addFreeJunction, addWireEdge, insertWireBend, nearestWirePoint, pruneLooseJunctions, tapWire} from './circuit/routing';
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
import './cad-theme.css';
import {CadMenuBar, CadToolRail} from './CadChrome';
import {translate} from './i18n';
import type {Language} from './i18n';

type Tool = 'select' | 'wire' | 'pan' | Kind;
type Selection = {type: 'component' | 'wire'; id: string} | null;
type Drag =
  | {type: 'component'; id: string; pointerId: number; start: {x: number; y: number}; original: Placement}
  | {type: 'pan'; pointerId: number; clientX: number; clientY: number; x: number; y: number; zoom: number}
  | {type: 'bend'; pointerId: number; wireId: string; index: number; original: XY};

const kinds: Kind[] = ['R', 'C', 'L', 'V', 'G', 'O'];
const FREE_WIRE_START = '__FREE_START__';
type XY = {x: number; y: number};
function orthogonalPath(points: XY[]): string {
  if (!points.length) return '';
  let path = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    if (prev.x !== next.x) path += ` H${next.x}`;
    if (prev.y !== next.y) path += ` V${next.y}`;
  }
  return path;
}

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
  if (kind === 'O') return <>
    <path d="M-20 -48 L60 0 L-20 48 Z M-60 -20 H-20 M-60 20 H-20 M60 0 H80 M0 -60 V-36 M0 36 V60" />
    <text x="-14" y="-15" fontSize="15" stroke="none" fill="currentColor">−</text>
    <text x="-14" y="26" fontSize="15" stroke="none" fill="currentColor">+</text>
  </>;
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
  const {value: project, commit, undo, redo, reset, canUndo, canRedo} = useHistory<Project>(opAmpExampleProject());
  const [tool, setTool] = useState<Tool>('select');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => localStorage.getItem('opencircuit-theme') === 'light' ? 'light' : 'dark');
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem('opencircuit-language') === 'en' ? 'en' : 'th');
  const tr = (key: string) => translate(language, key);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [showSheet, setShowSheet] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [wireBends, setWireBends] = useState<{x: number; y: number}[]>([]);
  const [freeWireStart, setFreeWireStart] = useState<XY | null>(null);
  const [bendPreview, setBendPreview] = useState<{wireId: string; index: number; position: XY} | null>(null);
  const [wireHoverPos, setWireHoverPos] = useState<{x: number; y: number} | null>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [preview, setPreview] = useState<{id: string; placement: Placement} | null>(null);
  const [viewport, setViewport] = useState({x: -240, y: -180, zoom: 0.58});
  const [message, setMessage] = useState('Op-Amp example loaded. Generic Op-Amp DC simulation is available (approximate model).');

  useEffect(() => { localStorage.setItem('opencircuit-theme', theme); document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { localStorage.setItem('opencircuit-language', language); document.documentElement.lang = language; }, [language]);
  useEffect(() => {if (!pending) setFreeWireStart(null);}, [pending]);

  // Simulation state
  const [simStatus, setSimStatus] = useState<SimulationStatus>('idle');
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [resultsExpanded, setResultsExpanded] = useState<boolean>(false);
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
    if (!cancelled && current.type === 'bend') {
      const location = point(event);
      if (location) {
        const position = {x: snap(location.x), y: snap(location.y)};
        if (position.x !== current.original.x || position.y !== current.original.y)
          commit((val) => ({...val, wires: val.wires.map((w) => w.id === current.wireId
            ? {...w, bends: (w.bends ?? []).map((b, i) => i === current.index ? position : b)} : w)}));
      }
    }
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
    setBendPreview(null);
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

  function finishWire(destination: string | XY) {
    if (!pending) return;
    let next = project;
    let from = pending;
    if (pending === FREE_WIRE_START) {
      if (!freeWireStart) return;
      const start = addFreeJunction(next, freeWireStart);
      next = start.project;
      from = start.endpoint;
    }
    let to: string;
    if (typeof destination === 'string') to = destination;
    else {
      const end = addFreeJunction(next, destination);
      next = end.project;
      to = end.endpoint;
    }
    if (from === to) {
      setPending(null); setFreeWireStart(null); setWireBends([]); setWireHoverPos(null);
      setMessage('Zero-length wire cancelled.');
      return;
    }
    const completed = addWireEdge(next, from, to, wireBends);
    if (completed !== project) commit(() => completed);
    setPending(null);
    setFreeWireStart(null);
    setWireBends([]);
    setWireHoverPos(null);
    setMessage('Wire routed and connected.');
  }

  function connect(pin: string) {
    if (tool !== 'wire') return;
    if (!pending) {
      setPending(pin);
      setFreeWireStart(null);
      setWireBends([]);
      setMessage('Route via grid clicks; connect to a pin or existing wire, or double-click to finish freely.');
    } else {
      finishWire(pin);
    }
  }

  function connectToWire(wireId: string, location: XY) {
    if (tool !== 'wire') return;
    const originalWire = project.wires.find((w) => w.id === wireId);
    if (!originalWire) return;
    const at = nearestWirePoint(originalWire, pinLocations, location);
    if (!at) return;
    const result = tapWire(project, wireId, at, pinLocations);
    if (!result) return;
    const endpoint = result.endpoint;
    if (!pending) {
      if (result.split) commit(() => result.project);
      setPending(endpoint);
      setWireBends([]);
      setMessage('Wire branch started. Click grid for corners, then click a pin or wire.');
      return;
    }
    let next = result.project;
    let from = pending;
    if (pending === FREE_WIRE_START) {
      if (!freeWireStart) return;
      const start = addFreeJunction(next, freeWireStart);
      next = start.project;
      from = start.endpoint;
    }
    next = addWireEdge(next, from, endpoint, wireBends);
    if (next !== project) commit(() => next);
    setPending(null);
    setFreeWireStart(null);
    setWireBends([]);
    setWireHoverPos(null);
    setMessage('T-junction electrically connected.');
  }

  function remove() {
    if (!selected) return;
    if (selected.type === 'wire') commit((val) => pruneLooseJunctions({...val, wires: val.wires.filter((w) => w.id !== selected.id)}));
    else commit((val) => {
      const component = val.components.find((item) => item.id === selected.id);
      if (!component) return val;
      const pins = new Set(component.pins);
      const schematic = {...val.schematic};
      delete schematic[component.id];
      const netAliases = Object.fromEntries(Object.entries(val.netAliases ?? {}).filter(([id]) => !pins.has(id)));
      return pruneLooseJunctions({...val, schematic, netAliases,
        components: val.components.filter((item) => item.id !== component.id),
        wires: val.wires.filter((w) => !pins.has(w.from) && !pins.has(w.to))});
    });
    setPending(null);
    setWireHoverPos(null);
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

  function loadOpAmpExample() {
    if (project.wires.length > 0 && !window.confirm(tr('Load the Op-Amp example? Save your current project first.'))) return;
    reset(opAmpExampleProject());
    setTool('select');
    setSelected(null);
    setPending(null);
    setWireBends([]);
    setViewport({x: -240, y: -180, zoom: 0.58});
    setSimResult(null);
    setSimError(null);
    setSimStatus('idle');
    setResultsExpanded(false);
    setMessage('Op-Amp example loaded. Generic Op-Amp DC simulation is available (approximate model).');
  }

  function handleNewCircuit() {
    if (project.components.length > 0 && !window.confirm(tr('Create new circuit? Any unsaved changes will be lost.'))) return;
    reset({version: 2, components: [], wires: [], schematic: {}, junctions: {}});
    setSelected(null);
    setPending(null);
    setWireHoverPos(null);
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
        setPending(null); setWireBends([]); setWireHoverPos(null); setTool('select'); setMessage('Cancelled.');
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        setSelected(null);
        setPending(null);
        setWireHoverPos(null);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); redo(); setSelected(null); setPending(null); setWireHoverPos(null);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selected) { event.preventDefault(); remove(); }
      } else if (event.key === 'r' || event.key === 'R') {
        if (selected && selected.type === 'component') {
          event.preventDefault();
          rotate();
        }
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
      setWireHoverPos(null);
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

  for (const [id, position] of Object.entries(project.junctions ?? {})) pinLocations.set(id, position);
  if (pending === FREE_WIRE_START && freeWireStart) pinLocations.set(FREE_WIRE_START, freeWireStart);

  // Junction Dots: coordinates where 2 or more wire connections meet
  const junctionCounts = new Map<string, {x: number; y: number; count: number}>();
  for (const wire of project.wires) {
    const pA = pinLocations.get(wire.from);
    const pB = pinLocations.get(wire.to);
    if (pA) {
      const key = `${pA.x},${pA.y}`;
      const entry = junctionCounts.get(key) || {x: pA.x, y: pA.y, count: 0};
      entry.count += 1;
      junctionCounts.set(key, entry);
    }
    if (pB) {
      const key = `${pB.x},${pB.y}`;
      const entry = junctionCounts.get(key) || {x: pB.x, y: pB.y, count: 0};
      entry.count += 1;
      junctionCounts.set(key, entry);
    }
  }
  const junctions = Array.from(junctionCounts.values()).filter((j) => j.count >= 2);
  const viewWidth = 900 / viewport.zoom;
  const viewHeight = 540 / viewport.zoom;

  // Build node to pins mapping for table display
  const nodePinsMap = new Map<string, string[]>();
  for (const net of analysis.nets) {
    nodePinsMap.set(net.name, net.pins);
  }

  return (
    <div className={`app theme-${theme}`}>
      <CadMenuBar groups={[
        {label: tr("File"), commands: [
          {label: tr("New Schematic"), run: handleNewCircuit},
          {label: tr("Open Project…"), run: () => upload.current?.click()},
          {label: tr("Save Project"), run: save},
          {label: tr("Open Op-Amp Example"), run: loadOpAmpExample},
          {label: tr("Open RC Starter Example"), run: () => {reset(starterProject()); setSelected(null); setViewport({x: -240, y: -180, zoom: 0.58}); setSimStatus('idle'); setSimResult(null);}},
        ]},
        {label: tr("Edit"), commands: [
          {label: tr("Undo"), run: undo, disabled: !canUndo},
          {label: tr("Redo"), run: redo, disabled: !canRedo},
          {label: tr("Select / Move"), run: () => {setTool('select'); setPending(null);}},
        ]},
        {label: tr("Place"), commands: [
          {label: tr('Wire'), run: () => {setTool('wire'); setPending(null); setWireBends([]);}},
          ...kinds.map((kind) => ({label: tr(names[kind]), run: () => {setTool(kind); setPending(null);}})),
        ]},
        {label: tr("View"), commands: [
          {label: tr(showSheet ? 'Hide Sheet Frame' : 'Show Sheet Frame'), run: () => setShowSheet((v) => !v)},
          {label: tr("Zoom In"), run: () => zoomBy(1.25)},
          {label: tr("Zoom Out"), run: () => zoomBy(1 / 1.25)},
          {label: tr("Reset View"), run: () => setViewport({x: 0, y: 0, zoom: 1})},
          {label: tr("Fit Schematic Sheet"), run: () => setViewport({x: -240, y: -180, zoom: 0.58})},
          {label: tr('Toggle Dark / Light'), run: () => setTheme((v) => v === 'dark' ? 'light' : 'dark')},
        ]},
        {label: tr("PSpice"), commands: [
          {label: tr("Run Simulation…"), run: () => {setSimSettingsOpen(true); settingsDialog.current?.showModal();}},
          {label: tr("View Netlist"), run: () => netlistDialog.current?.showModal()},
        ]},
      ]}/>
      {/* Top Toolbar */}
      <header>
        <div className="brand">
          ◈ <b>OpenCircuit</b> <span>{tr("Studio / Schematic Editor")}</span>
        </div>
        <div className="actions">
          <span className="workspace-pill">{tr('● 2D SCHEMATIC')}</span>
          <button className="language-toggle" onClick={() => setLanguage((current) => current === 'th' ? 'en' : 'th')}
            title={language === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
            aria-label={language === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
            aria-pressed={language === 'th'}>{language === 'th' ? 'EN · English' : 'TH · ไทย'}</button>
          <button onClick={loadOpAmpExample} title={tr("Open editable Op-Amp schematic example")}>{tr("◈ Op-Amp Example")}</button>
          <button onClick={handleNewCircuit} title={tr("New circuit")}>{tr("＋ New")}</button>
          <button onClick={() => upload.current?.click()} title={tr("Open saved project")}>{tr("⇪ Open")}</button>
          <input
            ref={upload}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label={tr("Open project JSON")}
            onChange={(event) => void load(event.target.files?.[0])}
          />
          <button onClick={save} title={tr("Save circuit to JSON file")}>{tr("⤓ Save")}</button>
          <button onClick={() => {undo(); setSelected(null); setPending(null);}} disabled={!canUndo} title={tr("Undo (Ctrl+Z)")}>{tr("↶ Undo")}</button>
          <button onClick={() => {redo(); setSelected(null); setPending(null);}} disabled={!canRedo} title={tr("Redo (Ctrl+Y)")}>{tr("↷ Redo")}</button>
          <button
            className="btn-primary"
            onClick={() => {
              setSimSettingsOpen(true);
              settingsDialog.current?.showModal();
            }}
            title={tr("Configure and run simulation")}
          >
            {tr('▶ Run Simulation')}
          </button>
          <button onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} title={tr("Switch light / dark theme")} aria-label={tr("Toggle color theme")}>{tr(theme === 'dark' ? '☀ Light' : '☾ Dark')}</button>
          <button onClick={() => netlistDialog.current?.showModal()} title={tr("View SPICE netlist")}>
            {tr('Preview Netlist')}
          </button>
          <span
            className={`badge ${backendOnline === true ? 'badge-completed' : backendOnline === false ? 'badge-failed' : 'badge-idle'}`}
            style={{cursor: 'pointer'}}
            onClick={() => void refreshBackendStatus()}
            title={tr("Click to check backend connection status")}
          >
            {tr(backendOnline === true ? '● Backend Ready' : backendOnline === false ? '○ Backend Offline' : '● Checking...')}
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
          <h2 id="sim-settings-title">{tr("Simulation Settings")}</h2>
          <button onClick={() => {settingsDialog.current?.close(); setSimSettingsOpen(false);}} aria-label={tr("Close dialog")}>✕</button>
        </div>
        <div className="dialog-body">
          <label style={{fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase'}}>
            {tr('Select Analysis Type')}
          </label>
          <div className="sim-type-group">
            <label className="sim-type-card selected">
              <input type="radio" name="sim-type" value="op" defaultChecked readOnly />
              <div>
                <strong>{tr("DC Operating Point (.op)")}</strong>
                <small>{tr("Calculates steady-state node voltages and source currents.")}</small>
              </div>
            </label>
            <label className="sim-type-card disabled" title={tr("Coming in milestone v0.5")}>
              <input type="radio" name="sim-type" value="tran" disabled />
              <div>
                <strong>{tr("Transient Analysis (.tran)")} <span style={{color: '#0f766e', fontWeight: 600}}>(v0.5)</span></strong>
                <small>{tr("Time-domain voltage/current waveforms.")}</small>
              </div>
            </label>
            <label className="sim-type-card disabled" title={tr("Coming in milestone v0.5")}>
              <input type="radio" name="sim-type" value="ac" disabled />
              <div>
                <strong>{tr("AC Frequency Sweep (.ac)")} <span style={{color: '#0f766e', fontWeight: 600}}>(v0.5)</span></strong>
                <small>{tr("Bode plot of magnitude and phase response.")}</small>
              </div>
            </label>
          </div>

          <div className="validation-box">
            <h4>{tr("Circuit Validation Check")}</h4>
            {analysis.issues.length ? (
              <ul>
                {analysis.issues.map((issue, idx) => (
                  <li key={idx} className={issue.severity}>
                    <strong>{tr(issue.severity.toUpperCase())}:</strong> {tr(issue.message)}
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{margin: 0, color: '#166534', fontSize: 13, fontWeight: 600}}>
                {tr('✓ Circuit topology is valid for SPICE simulation.')}
              </p>
            )}
          </div>
        </div>
        <div className="dialog-foot">
          <button onClick={() => {settingsDialog.current?.close(); setSimSettingsOpen(false);}}>{tr("Cancel")}</button>
          <button
            className="btn-primary"
            onClick={() => void executeSimulation()}
            disabled={!analysis.netlist || simStatus === 'running'}
          >
            {tr(analysis.netlist ? 'Run DC Simulation' : 'Fix Errors Before Simulating')}
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
          <h2 id="netlist-title">{tr("SPICE Netlist Preview")}</h2>
          <button onClick={() => netlistDialog.current?.close()} aria-label={tr("Close netlist preview")}>✕</button>
        </div>
        <p style={{margin: '0 0 12px', fontSize: 13, color: '#64748b'}}>
          {tr('Topological SPICE netlist generated from pin IDs and wires.')}
        </p>
        <h4 style={{margin: '12px 0 6px', fontSize: 12, textTransform: 'uppercase', color: '#64748b'}}>{tr("Validation")}</h4>
        {analysis.issues.length ? (
          <ul style={{margin: 0, paddingLeft: 20, fontSize: 13}}>
            {analysis.issues.map((issue, index) => (
              <li key={index} style={{color: issue.severity === 'error' ? '#b91c1c' : '#b45309'}}>
                <strong>{tr(issue.severity)}:</strong> {tr(issue.message)}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{margin: 0, fontSize: 13, color: '#166534'}}>{tr("✓ No validation issues found.")}</p>
        )}
        <h4 style={{margin: '12px 0 6px', fontSize: 12, textTransform: 'uppercase', color: '#64748b'}}>{tr("Electrical Nets")}</h4>
        <ul style={{margin: 0, paddingLeft: 20, fontSize: 13}}>
          {analysis.nets.map((net) => (
            <li key={net.name}>
              <strong>{net.name}</strong>: {net.pins.join(', ')}
            </li>
          ))}
        </ul>
        {analysis.netlist ? (
          <>
            <h4 style={{margin: '12px 0 6px', fontSize: 12, textTransform: 'uppercase', color: '#64748b'}}>{tr("Deterministic Netlist")}</h4>
            <pre>{analysis.netlist}</pre>
            <button onClick={() => {if (analysis.netlist) download('circuit.cir', analysis.netlist, 'text/plain');}}>
              {tr('Export Netlist (.cir)')}
            </button>
          </>
        ) : (
          <p style={{color: '#b91c1c', fontSize: 13}}>{tr("Fix the errors above to generate SPICE netlist.")}</p>
        )}
      </dialog>

      {/* Main 3-column Layout */}
      <main>
        <CadToolRail items={[
          {label: tr("Select / Move"), icon: '↖', active: tool === 'select', run: () => {setTool('select'); setPending(null);}},
          {label: tr("Place Wire"), icon: '⌁', active: tool === 'wire', run: () => {setTool('wire'); setPending(null); setWireBends([]);}},
          {label: tr("Pan"), icon: '✥', active: tool === 'pan', run: () => {setTool('pan'); setPending(null);}},
          {label: tr("Place Resistor"), icon: 'R', active: tool === 'R', run: () => setTool('R')},
          {label: tr("Place Capacitor"), icon: 'C', active: tool === 'C', run: () => setTool('C')},
          {label: tr("Place Inductor"), icon: 'L', active: tool === 'L', run: () => setTool('L')},
          {label: tr("Place Voltage Source"), icon: 'V', active: tool === 'V', run: () => setTool('V')},
          {label: tr("Place Ground"), icon: '⏚', active: tool === 'G', run: () => setTool('G')},
        ]}/>
        {/* Left Column: Component Library & Tools */}
        <aside className="tools">
          <h3>{tr("Design Explorer")}</h3>
          <div className="design-explorer">
            <div className="explorer-root">{tr("▣ OpenCircuit Project")}</div>
            <button className="explorer-sheet" onClick={() => {setTool('select'); setViewport({x: 0, y: 0, zoom: 1}); setSelected(null);}}>
              {tr('└ ▤ SCHEMATIC1 / PAGE1')}
            </button>
            <small>{tr("1 active schematic sheet")}</small>
          </div>
          <h3>{tr("Drawing Tools")}</h3>
          <button
            className={tool === 'select' ? 'active' : ''}
            aria-pressed={tool === 'select'}
            onClick={() => {setTool('select'); setPending(null);}}
          >
            {tr('↖ Select / Move')}
          </button>
          <button
            className={tool === 'wire' ? 'active' : ''}
            aria-pressed={tool === 'wire'}
            onClick={() => {setTool('wire'); setPending(null);}}
          >
            {tr('⌁ Wire')}
          </button>
          <button
            className={tool === 'pan' ? 'active' : ''}
            aria-pressed={tool === 'pan'}
            onClick={() => {setTool('pan'); setPending(null);}}
          >
            {tr('✥ Pan')}
          </button>

          <h3>{tr("Component Library")}</h3>
          <input className="library-search" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder={tr("⌕ Search components...")} aria-label={tr("Search components")} />
          {kinds.filter((kind) => `${kind} ${tr(names[kind])} ${translate('th', names[kind])}`.toLowerCase().includes(libraryQuery.trim().toLowerCase())).map((kind) => (
            <button
              key={kind}
              className={tool === kind ? 'active' : ''}
              aria-pressed={tool === kind}
              onClick={() => {setTool(kind); setPending(null);}}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('application/x-opencircuit-kind', kind)}
            >
              <span className="component-symbol">{kind}</span>
              {tr(names[kind])}
            </button>
          ))}
          <div className="hint">
            • <b>{tr("Place:")}</b> {tr("Drag or click component, then canvas.")}<br/>
            • <b>{tr("Wire:")}</b> {tr("Start from any grid point, pin or wire. Click to bend, click target to connect or double-click grid to finish.")}<br/>
            • <b>{tr("Pan:")}</b> {tr("Drag canvas with middle-click or Pan tool.")}<br/>
            • <b>{tr("Edit wire:")}</b> {tr("Double-click a segment to add an orange bend handle, then drag it.")}<br/>
            • <b>{tr('Rotate:')}</b> {tr("Press 'R' or click Rotate 90°.")}<br/>
            • <b>{tr('Cancel:')}</b> {tr('Right-click or press Esc.')}
          </div>
        </aside>

        {/* Center Column: Schematic Canvas & Simulation Results Panel */}
        <section className="workspace">
          <div className="workspace-head">
            <strong><span className="document-dot">●</span> {tr("Circuit 1")} <span className="workspace-subtitle">{tr("/ Schematic")}</span></strong>
            <div className="workspace-controls">
              <button onClick={() => setShowSheet((v) => !v)} title={tr("Toggle engineering drawing sheet")} aria-pressed={showSheet}>{tr(showSheet ? '▤ Sheet A3' : '▧ Infinite Grid')}</button>
              <button onClick={() => setViewport({x: -240, y: -180, zoom: 0.58})} title={tr("Fit schematic sheet")}>{tr("Fit Sheet")}</button>
              <button onClick={() => zoomBy(1 / 1.25)} aria-label={tr("Zoom out")} title={tr("Zoom out")}>−</button>
              <span aria-label={tr("Zoom level")}>{Math.round(viewport.zoom * 100)}%</span>
              <button onClick={() => zoomBy(1.25)} aria-label={tr("Zoom in")} title={tr("Zoom in")}>+</button>
              <button onClick={() => setViewport({x: 0, y: 0, zoom: 1})} title={tr("Reset View")}>1:1</button>
            </div>
          </div>

          <div className="canvas-container">
            <svg
              ref={svg}
              role="img"
              aria-label={tr("Schematic canvas")}
              viewBox={`${viewport.x} ${viewport.y} ${viewWidth} ${viewHeight}`}
              onDoubleClick={(event) => {
                if (tool !== 'wire' || !pending) return;
                if (event.target !== svg.current &&
                    !(event.target instanceof Element && event.target.classList.contains('grid-hit'))) return;
                const location = point(event);
                if (location) finishWire({x: snap(location.x), y: snap(location.y)});
              }}
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
              onWheel={(event) => {
                event.preventDefault();
                const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
                zoomBy(factor);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (pending) {
                  setPending(null);
                  setWireBends([]);
                  setWireHoverPos(null);
                  setMessage('Wiring cancelled.');
                } else if (selected) {
                  setSelected(null);
                }
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
                } else if (tool === 'wire') {
                  const location = point(event);
                  if (location) {
                    const bend = {x: snap(location.x), y: snap(location.y)};
                    if (!pending) {
                      setPending(FREE_WIRE_START);
                      setFreeWireStart(bend);
                      setWireBends([]);
                      setMessage('Free wire started. Click to route; double-click to finish, or connect to a pin or wire.');
                    } else if (wireBends.length < 100 && !wireBends.some((p) => p.x === bend.x && p.y === bend.y)) {
                      setWireBends((points) => [...points, bend]);
                    }
                  }
                } else if (tool === 'select') setSelected(null);
              }}
              onPointerMove={(event) => {
                if (tool === 'wire' && pending) {
                  const location = point(event);
                  if (location) setWireHoverPos({x: snap(location.x), y: snap(location.y)});
                }
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
                } else if (current.type === 'bend') {
                  const location = point(event);
                  if (location) setBendPreview({wireId: current.wireId, index: current.index,
                    position: {x: snap(location.x), y: snap(location.y)}});
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
                  <circle cx="1" cy="1" r="1" fill={theme === 'dark' ? '#30435b' : '#cbd5e1'} />
                </pattern>
              </defs>
              {showSheet && <rect x="-180" y="-130" width="1260" height="840" pointerEvents="none"
                fill={theme === 'dark' ? '#172538' : '#ffffff'} stroke={theme === 'dark' ? '#324861' : '#c9d5e2'} strokeWidth="2" />}
              <rect className="grid-hit" x={viewport.x} y={viewport.y} width={viewWidth} height={viewHeight} fill="url(#dots)" />
              {showSheet && (
                <g pointerEvents="none" className="schematic-sheet">
                  <rect x="-180" y="-130" width="1260" height="840" fill="none" stroke={theme === 'dark' ? '#71869e' : '#64748b'} strokeWidth="2" />
                  <rect x="-162" y="-112" width="1224" height="804" fill="none" stroke={theme === 'dark' ? '#435872' : '#94a3b8'} strokeWidth="1" />
                  {Array.from({length: 6}, (_, i) => (
                    <g key={`sheet-col-${i}`} fill={theme === 'dark' ? '#9db0c6' : '#475569'} fontSize="12" textAnchor="middle">
                      <path d={`M${-162 + i * 204} -130 V-112 M${-162 + i * 204} 692 V710`} stroke="currentColor" opacity=".5" />
                      <text x={-60 + i * 204} y="-117">{i + 1}</text>
                      <text x={-60 + i * 204} y="706">{i + 1}</text>
                    </g>
                  ))}
                  {Array.from({length: 4}, (_, i) => (
                    <g key={`sheet-row-${i}`} fill={theme === 'dark' ? '#9db0c6' : '#475569'} fontSize="12" textAnchor="middle">
                      <path d={`M-180 ${-112 + i * 201} H-162 M1062 ${-112 + i * 201} H1080`} stroke="currentColor" opacity=".5" />
                      <text x="-171" y={-8 + i * 201}>{String.fromCharCode(65 + i)}</text>
                      <text x="1071" y={-8 + i * 201}>{String.fromCharCode(65 + i)}</text>
                    </g>
                  ))}
                  <g transform="translate(652 562)" stroke={theme === 'dark' ? '#8ca3bc' : '#64748b'} fill="none" strokeWidth="1.3">
                    <rect width="410" height="130" />
                    <path d="M0 45 H410 M0 85 H410 M255 45 V130 M335 85 V130" />
                    <g stroke="none" fill={theme === 'dark' ? '#d7e6f5' : '#334155'} fontSize="12">
                      <text x="12" y="18">{tr("OPENCIRCUIT STUDIO · ENGINEERING DRAWING")}</text>
                      <text x="12" y="36" fontSize="16" fontWeight="bold">{tr("Circuit 1 — Schematic")}</text>
                      <text x="12" y="62">{tr("DOCUMENT")}</text><text x="12" y="78">OC-SCH-001</text>
                      <text x="268" y="62">{tr("SIZE")}</text><text x="268" y="78">A3</text>
                      <text x="12" y="103">{tr("2D SCHEMATIC / SPICE")}</text>
                      <text x="268" y="103">{tr("REV")}</text><text x="268" y="120">A</text>
                      <text x="345" y="103">{tr("SHEET")}</text><text x="345" y="120">1 / 1</text>
                    </g>
                  </g>
                </g>
              )}

              {/* Orthogonal 2D Wires */}
              {project.wires.map((wire) => {
                const a = pinLocations.get(wire.from);
                const b = pinLocations.get(wire.to);
                if (!a || !b) return null;
                const isSelected = selectedWire?.id === wire.id;
                const bends = (wire.bends ?? []).map((p, i) => bendPreview?.wireId === wire.id && bendPreview.index === i ? bendPreview.position : p);
                const wirePath = orthogonalPath([a, ...bends, b]);
                return (
                  <g
                    key={wire.id}
                    onDoubleClick={(event) => {
                      if (tool !== 'select') return;
                      event.stopPropagation();
                      const location = point(event);
                      const at = location ? nearestWirePoint(wire, pinLocations, location) : null;
                      if (!at) return;
                      const adjusted = insertWireBend(wire, at, pinLocations);
                      if (!adjusted) return;
                      commit((val) => ({...val, wires: val.wires.map((entry) => entry.id === wire.id ? adjusted : entry)}));
                      setSelected({type: 'wire', id: wire.id});
                      setMessage('Wire bend inserted. Drag its orange handle to reroute.');
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      if (tool === 'wire') {
                        event.stopPropagation();
                        const location = point(event);
                        if (location) connectToWire(wire.id, location);
                      } else if (tool === 'select') {
                        event.stopPropagation();
                        setSelected({type: 'wire', id: wire.id});
                      }
                    }}
                  >
                    <path d={wirePath} stroke="transparent" strokeWidth="14" fill="none" />
                    <path
                      d={wirePath}
                      stroke={isSelected ? '#f59e0b' : '#0d9488'}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                      pointerEvents="none"
                    />
                    {project.netAliases?.[wire.from] && (
                      <text x={a.x + 8} y={a.y - 15} pointerEvents="none"
                        fontSize="13" fontWeight="700" fill={theme === 'dark' ? '#9eead6' : '#00686e'}>
                        {project.netAliases[wire.from]}
                      </text>
                    )}
                    {isSelected && bends.map((bend, index) => (
                      <circle key={index} cx={bend.x} cy={bend.y} r="7" fill="#ffffff"
                        stroke="#f59e0b" strokeWidth="2" style={{cursor: 'move'}}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.stopPropagation();
                          drag.current = {type: 'bend', pointerId: event.pointerId, wireId: wire.id,
                            index, original: bend};
                          svg.current?.setPointerCapture(event.pointerId);
                        }}/>
                    ))}
                  </g>
                );
              })}

              {/* Junction Dots: Rendered strictly where 2 or more wire connections meet */}
              {junctions.map((j, idx) => (
                <g key={`junc-${idx}`} className="junction-dot" pointerEvents="none">
                  <circle cx={j.x} cy={j.y} r="4.5" fill="#0d9488" stroke="#ffffff" strokeWidth="1.5" />
                </g>
              ))}

              {pending === FREE_WIRE_START && freeWireStart && (
                <circle cx={freeWireStart.x} cy={freeWireStart.y} r="6" fill="none" stroke="#f59e0b"
                  strokeWidth="2" pointerEvents="none" />
              )}
              {Object.entries(project.junctions ?? {}).map(([id, position]) => (
                <circle key={id} cx={position.x} cy={position.y} r="6" className="electrical-junction"
                  stroke={theme === 'dark' ? '#101a28' : '#ffffff'} strokeWidth="1.3" fill="#0d9488"
                  style={{cursor: tool === 'wire' ? 'crosshair' : 'default'}}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || tool !== 'wire') return;
                    event.stopPropagation();
                    connect(id);
                  }}/>
              ))}

              {/* Rubber-band Orthogonal Wire Preview */}
              {tool === 'wire' && pending && wireHoverPos && (() => {
                const start = pinLocations.get(pending);
                if (!start) return null;
                const previewPath = orthogonalPath([start, ...wireBends, wireHoverPos]);
                return (
                  <g pointerEvents="none">
                    <path
                      d={previewPath}
                      stroke="#f59e0b"
                      strokeWidth="2.5"
                      strokeDasharray="5 4"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx={wireHoverPos.x} cy={wireHoverPos.y} r="5" fill="#f59e0b" opacity="0.85" />
                  </g>
                );
              })()}

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
                        x={component.kind === 'O' ? -67 : -33}
                        y={component.kind === 'O' ? -65 : -31}
                        width={component.kind === 'O' ? 153 : 66}
                        height={component.kind === 'O' ? 130 : 62}
                        rx="6"
                        fill={isSelected ? (theme === 'dark' ? '#213d52' : '#e0f2fe') : (theme === 'dark' ? '#182537' : '#fff')}
                        stroke={isSelected ? '#0284c7' : 'transparent'}
                        strokeWidth="2"
                      />
                      <g
                        transform={`rotate(${placement.rotation})`}
                        stroke={theme === 'dark' ? '#e0eaf7' : '#1e293b'}
                        strokeWidth="2.5"
                        fill="none"
                        strokeLinecap="round"
                      >
                        <Symbol kind={component.kind} />
                        {component.kind !== 'G' && component.kind !== 'O' && <path d="M-40 0 H-20 M20 0 H40" />}
                      </g>
                      <text x="0" y={component.kind === 'O' ? -74 : -37} textAnchor="middle" fontSize="15" fill={theme === 'dark' ? '#e0eaf7' : '#334155'} fontWeight="600">
                        {component.id}
                      </text>
                      <text x="0" y={component.kind === 'O' ? 78 : 45} textAnchor="middle" fontSize="12" fill={theme === 'dark' ? '#a7b8cb' : '#64748b'}>
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
                            {project.netAliases?.[pin] && (
                              <text x={position.x + 10} y={position.y - 13} fontSize="13"
                                fontWeight="700" fill={theme === 'dark' ? '#7fe3d4' : '#006b71'}
                                pointerEvents="none">{project.netAliases[pin]}</text>
                            )}
                            {(component.kind === 'V' || component.kind === 'O') && (
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

          <div className="status" role="status">{tr(message)}</div>

          {/* Simulation Results Panel */}
          <div className={`results-panel ${resultsExpanded ? 'expanded' : 'collapsed'}`}>
            <div className="results-header">
              <div className="results-header-left">
                <span>{tr("Simulation Results")}</span>
                <span className={`badge badge-${simStatus}`}>
                  {simStatus === 'idle' && tr('● Idle')}
                  {simStatus === 'running' && tr('⟳ Running...')}
                  {simStatus === 'completed' && tr('✓ Completed')}
                  {simStatus === 'failed' && tr('✕ Failed')}
                </span>
                <div className="results-tabs">
                  <button className="tab-btn active">{tr("DC Operating Point")}</button>
                  <button className="tab-btn" disabled title={tr("Waveforms for transient and AC simulations will arrive in v0.5")}>
                    {tr('Waveforms (v0.5)')}
                  </button>
                </div>
              </div>
              <div style={{display: 'flex', gap: 6, alignItems: 'center'}}>
                {simStatus === 'completed' && (
                  <button className="btn-sm" onClick={() => void executeSimulation()} title="Re-run simulation">
                    {tr('Re-run')}
                  </button>
                )}
                <button
                  className="btn-sm"
                  onClick={() => setResultsExpanded(!resultsExpanded)}
                  title={resultsExpanded ? 'Collapse panel' : 'Expand panel'}
                >
                  {tr(resultsExpanded ? '▼ Collapse' : '▲ Expand')}
                </button>
              </div>
            </div>

            {resultsExpanded && (
              <div className="results-body">
                {simStatus === 'running' && (
                  <div className="empty-results">
                    <p style={{fontSize: 14, fontWeight: 600, color: '#0f766e'}}>
                      {tr('⟳ Simulating circuit in ngspice...')}
                    </p>
                    <small>{tr("Executing DC operating point analysis safely via Python backend.")}</small>
                  </div>
                )}

                {simStatus === 'failed' && (
                  <div className="alert-error">
                    <div>
                      <strong>{tr("Simulation Failed:")}</strong>
                      <p style={{margin: '4px 0'}}>{simError ? tr(simError) : null}</p>
                      {simResult?.raw_output && <pre>{simResult.raw_output}</pre>}
                    </div>
                  </div>
                )}

                {simStatus === 'completed' && simResult && (
                  <div className="results-grid">
                    {/* Node Voltages Table */}
                    <div className="results-card">
                      <h4>{tr("Node Voltages (DC Operating Point)")}</h4>
                      <table className="sim-table">
                        <thead>
                          <tr>
                            <th>{tr("Node")}</th>
                            <th>{tr("Voltage (V)")}</th>
                            <th>{tr("Formatted")}</th>
                            <th>{tr("Pins")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(simResult.node_voltages)
                            .sort(([a], [b]) => a === '0' ? -1 : b === '0' ? 1 : a.localeCompare(b, undefined, {numeric: true}))
                            .map(([node, volt]) => (
                              <tr key={node}>
                                <td><strong>{node === '0' ? tr('Node 0 (GND)') : node}</strong></td>
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
                      <h4>{tr("Source Branch Currents")}</h4>
                      {Object.keys(simResult.branch_currents).length > 0 ? (
                        <table className="sim-table">
                          <thead>
                            <tr>
                              <th>{tr("Source")}</th>
                              <th>{tr("Current (A)")}</th>
                              <th>{tr("Formatted")}</th>
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
                        <p style={{color: '#64748b', fontSize: 12}}>{tr("No branch currents reported.")}</p>
                      )}
                    </div>
                  </div>
                )}

                {simStatus === 'idle' && (
                  <div className="empty-results">
                    {tr('Click')} <strong>{tr('▶ Run Simulation')}</strong> {tr('in the top toolbar to calculate DC operating voltages and currents using ngspice.')}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Properties Panel */}
        <aside className="properties">
          <h3>{tr("Properties")}</h3>
          {selectedComponent ? (
            <>
              <label>{tr("Component")}</label>
              <p>
                <strong>{selectedComponent.id}</strong> · {tr(names[selectedComponent.kind])}
              </p>
              <label htmlFor="component-value">{tr("Value")}</label>
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
                {tr('Rotation:')} {project.schematic[selectedComponent.id]?.rotation ?? 0}°
              </p>

              <div className="pin-nodes">
                <strong style={{display: 'block', marginBottom: 4, color: '#475569'}}>{tr("Electrical Connections")}</strong>
                {selectedComponent.pins.map((pin, idx) => {
                  const node = analysis.nets.find((net) => net.pins.includes(pin))?.name ?? 'unconnected';
                  const label = pinLabels[selectedComponent.kind]?.[idx] ?? '';
                  return (
                    <div key={pin}>
                      <span>{label ? `${tr('Pin')} ${label} (${pin})` : pin}:</span>
                      <strong style={{color: node === '0' ? '#16a34a' : node === 'unconnected' ? '#dc2626' : '#0284c7'}}>
                        {node === '0' ? tr('Node 0 (GND)') : node === 'unconnected' ? tr('Not connected') : `${tr('Node')} ${node}`}
                      </strong>
                      <input className="pin-net-alias" aria-label={`${tr('Net alias for')} ${pin}`}
                        key={pin} placeholder={tr("Net alias...")} maxLength={32}
                        defaultValue={project.netAliases?.[pin] ?? ''}
                        onBlur={(event) => {
                          const next = event.currentTarget.value.trim();
                          if (next && !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(next)) {
                            setMessage('Invalid net alias: use letters, numbers or underscore.');
                            event.currentTarget.value = project.netAliases?.[pin] ?? '';
                            return;
                          }
                          if (next.toUpperCase() === (project.netAliases?.[pin] ?? '').toUpperCase()) return;
                          commit((value) => {
                            const aliases = {...value.netAliases};
                            if (next) aliases[pin] = next.toUpperCase();
                            else delete aliases[pin];
                            return {...value, netAliases: aliases};
                          });
                          setMessage(next ? `Net label ${next.toUpperCase()} assigned to ${pin}.` : `Net alias cleared from ${pin}.`);
                        }}
                        onKeyDown={(event) => {if (event.key === 'Enter') event.currentTarget.blur();}}
                      />
                    </div>
                  );
                })}
              </div>

              <div style={{display: 'flex', gap: 6, marginTop: 8}}>
                <button onClick={rotate} style={{flex: 1}}>{tr("Rotate 90°")}</button>
                <button className="danger" onClick={remove} style={{flex: 1}}>{tr("Delete")}</button>
              </div>
            </>
          ) : selectedWire ? (
            <>
              <label>{tr("Selected Wire")}</label>
              <p>ID: {selectedWire.id}</p>
              <p style={{fontSize: 12, color: '#64748b'}}>
                {tr('From:')} <code>{selectedWire.from}</code><br/>
                {tr('To:')} <code>{selectedWire.to}</code>
              </p>
              <label htmlFor="wire-net-alias">{tr("Net Alias (join same-name nets)")}</label>
              <input id="wire-net-alias" key={selectedWire.id}
                placeholder={tr("e.g. VCC, VOUT, INPUT")} maxLength={32}
                defaultValue={project.netAliases?.[selectedWire.from] ?? ''}
                onBlur={(event) => {
                  const label = event.currentTarget.value.trim();
                  if (label && !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(label)) {
                    setMessage('Invalid alias: use letters, digits and underscores, starting with a letter.');
                    event.currentTarget.value = project.netAliases?.[selectedWire.from] ?? '';
                    return;
                  }
                  const old = project.netAliases?.[selectedWire.from] ?? '';
                  if (old === label) return;
                  commit((val) => {
                    const next = {...val.netAliases};
                    if (label) next[selectedWire.from] = label.toUpperCase();
                    else delete next[selectedWire.from];
                    return {...val, netAliases: next};
                  });
                  setMessage(label ? `Net alias assigned: ${label.toUpperCase()}.` : 'Net alias removed.');
                }}
                onKeyDown={(event) => {if (event.key === 'Enter') event.currentTarget.blur();}}
              />
              <button className="danger" onClick={remove}>{tr("Delete wire")}</button>
            </>
          ) : (
            <p className="muted">{tr("Select a component or wire to inspect and edit its properties.")}</p>
          )}

          <h3>{tr("Circuit Summary")}</h3>
          <p style={{margin: '2px 0'}}>{project.components.length} {tr('components')}</p>
          <p style={{margin: '2px 0'}}>{project.wires.length} {tr('wires')}</p>
          <p style={{margin: '2px 0'}}>{analysis.nets.length} {tr('electrical nodes')}</p>
        </aside>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
