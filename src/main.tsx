import React, {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

type Kind='R'|'C'|'L'|'V'|'G';
type Part={id:string;kind:Kind;x:number;y:number;value:string};
type Wire={id:string;from:string;to:string};
type Circuit={version:number;parts:Part[];wires:Wire[]};
const GRID=20;
const snap=(v:number)=>Math.round(v/GRID)*GRID;
const defaults:Record<Kind,string>={R:'1kΩ',C:'100nF',L:'10mH',V:'5V',G:'GND'};
const names:Record<Kind,string>={R:'Resistor',C:'Capacitor',L:'Inductor',V:'Voltage',G:'Ground'};
const terminals=(p:Part)=>p.kind==='G'?[{id:`${p.id}:0`,x:p.x,y:p.y-30}]:[{id:`${p.id}:0`,x:p.x-40,y:p.y},{id:`${p.id}:1`,x:p.x+40,y:p.y}];
function Symbol({kind}:{kind:Kind}){
  if(kind==='R')return <path d="M-20 0 l5 -10 10 20 10 -20 10 20 5 -10"/>;
  if(kind==='C')return <><path d="M-6 -15 V15 M6 -15 V15"/><path d="M-20 0 H-6 M6 0 H20"/></>;
  if(kind==='L')return <path d="M-20 0 q5 -20 10 0 q5 -20 10 0 q5 -20 10 0 q5 -20 10 0"/>;
  if(kind==='V')return <><circle r="19"/><path d="M-8 0 H8 M0 -8 V8"/></>;
  return <path d="M0 -20 V0 M-18 0 H18 M-12 7 H12 M-6 14 H6"/>;
}
function App(){
 const [parts,setParts]=useState<Part[]>([{id:'V1',kind:'V',x:160,y:180,value:'5V'},{id:'R1',kind:'R',x:360,y:180,value:'1kΩ'},{id:'C1',kind:'C',x:560,y:180,value:'100nF'},{id:'G1',kind:'G',x:560,y:340,value:'GND'}]);
 const [wires,setWires]=useState<Wire[]>([]);
 const [tool,setTool]=useState<'select'|'wire'|Kind>('select');
 const [pending,setPending]=useState<string|null>(null);
 const [selected,setSelected]=useState<string|null>(null);
 const [drag,setDrag]=useState<string|null>(null);
 const [message,setMessage]=useState('Choose a component, then click the canvas to place it.');
 const svg=useRef<SVGSVGElement>(null);
 const upload=useRef<HTMLInputElement>(null);
 const getPoint=(e:React.PointerEvent<SVGSVGElement>)=>{const rect=svg.current!.getBoundingClientRect();return {x:snap((e.clientX-rect.left)*900/rect.width),y:snap((e.clientY-rect.top)*540/rect.height)}};
 const byTerminal=(id:string)=>parts.flatMap(terminals).find(t=>t.id===id);
 const onCanvas=(e:React.PointerEvent<SVGSVGElement>)=>{if(e.target!==svg.current && !(e.target as Element).classList.contains('grid-hit'))return; if('RCLVG'.includes(tool)&&tool.length===1){const pos=getPoint(e);const kind=tool as Kind;let n=1;while(parts.some(p=>p.id===`${kind}${n}`))n++;const id=`${kind}${n}`;setParts([...parts,{id,kind,...pos,value:defaults[kind]}]);setSelected(id);setMessage(`Placed ${id}.`);}else if(tool==='select')setSelected(null);};
 const connect=(id:string)=>{if(tool!=='wire')return;if(!pending){setPending(id);setMessage('Select a second pin to complete the wire.');return;}if(pending!==id&&!wires.some(w=>(w.from===pending&&w.to===id)||(w.from===id&&w.to===pending))){setWires([...wires,{id:`w${Date.now()}`,from:pending,to:id}]);setMessage('Wire connected.');}setPending(null);};
 const remove=()=>{if(!selected)return;if(selected.startsWith('w'))setWires(wires.filter(w=>w.id!==selected));else {setParts(parts.filter(p=>p.id!==selected));setWires(wires.filter(w=>!w.from.startsWith(selected+':')&&!w.to.startsWith(selected+':')));}setSelected(null);};
 const save=()=>{const blob=new Blob([JSON.stringify({version:1,parts,wires},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='circuit.json';a.click();URL.revokeObjectURL(url);};
 const load=async(file?:File)=>{if(!file)return;try{const data=JSON.parse(await file.text()) as Circuit;if(!Array.isArray(data.parts)||!Array.isArray(data.wires))throw Error('Invalid format');setParts(data.parts);setWires(data.wires);setSelected(null);setMessage('Project loaded.');}catch{setMessage('Cannot open project: invalid JSON.');}};
 return <div className="app"><header><div className="brand">◈ <b>OpenCircuit</b> <span>Web Studio</span></div><div className="actions"><button onClick={save}>Save JSON</button><button onClick={()=>upload.current?.click()}>Open JSON</button><input ref={upload} type="file" accept=".json,application/json" hidden onChange={e=>load(e.target.files?.[0])}/><button className="primary" onClick={()=>setMessage('Simulation is planned for v0.2 with ngspice.')} >▶ Simulate (soon)</button></div></header><main><aside><h3>Tools</h3><button className={tool==='select'?'active':''} onClick={()=>{setTool('select');setPending(null)}}>↖ Select / Move</button><button className={tool==='wire'?'active':''} onClick={()=>{setTool('wire');setPending(null)}}>⌁ Wire</button><h3>Components</h3>{(Object.keys(names) as Kind[]).map(k=><button key={k} className={tool===k?'active':''} onClick={()=>{setTool(k);setPending(null)}}><span className="component-symbol">{k}</span>{names[k]}</button>)}<div className="hint">Click a component to choose it, then click the canvas. Select Wire and click two terminal dots.</div></aside><section className="workspace"><div className="workspace-head"><strong>Schematic Editor</strong><span>900 × 540 · Grid 20</span></div><svg ref={svg} viewBox="0 0 900 540" onPointerDown={onCanvas} onPointerMove={e=>{if(drag){const pt=getPoint(e);setParts(ps=>ps.map(p=>p.id===drag?{...p,...pt}:p));}}} onPointerUp={()=>setDrag(null)} onPointerCancel={()=>setDrag(null)}><defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#cbd5e1"/></pattern></defs><rect className="grid-hit" width="900" height="540" fill="url(#dots)"/>{wires.map(w=>{const a=byTerminal(w.from),b=byTerminal(w.to);if(!a||!b)return null;return <g key={w.id} onPointerDown={e=>{e.stopPropagation();if(tool==='select')setSelected(w.id)}}><path d={`M${a.x} ${a.y} H${b.x} V${b.y}`} stroke="transparent" strokeWidth="14" fill="none"/><path d={`M${a.x} ${a.y} H${b.x} V${b.y}`} stroke={selected===w.id?'#f59e0b':'#0d9488'} strokeWidth="3" fill="none" pointerEvents="none"/></g>})}{parts.map(p=><g key={p.id}><g transform={`translate(${p.x} ${p.y})`} onPointerDown={e=>{e.stopPropagation();if(tool==='select'){setSelected(p.id);setDrag(p.id);e.currentTarget.setPointerCapture(e.pointerId)}}} onPointerUp={()=>setDrag(null)} style={{cursor:tool==='select'?'grab':'default'}}><rect x="-33" y="-31" width="66" height="62" rx="6" fill={selected===p.id?'#e0f2fe':'#fff'} stroke={selected===p.id?'#0284c7':'transparent'} strokeWidth="2"/><g stroke="#1e293b" strokeWidth="2.5" fill="none" strokeLinecap="round"><Symbol kind={p.kind}/>{p.kind!=='G'&&<path d="M-40 0 H-20 M20 0 H40"/>}</g><text x="0" y="-37" textAnchor="middle" fontSize="15" fill="#334155" fontWeight="600">{p.id}</text><text x="0" y="45" textAnchor="middle" fontSize="12" fill="#64748b">{p.value}</text></g>{terminals(p).map(t=><circle key={t.id} cx={t.x} cy={t.y} r="6" fill={pending===t.id?'#f59e0b':'#fff'} stroke="#0284c7" strokeWidth="2.5" onPointerDown={e=>{e.stopPropagation();connect(t.id)}} style={{cursor:tool==='wire'?'crosshair':'default'}}/>)}</g>)}</svg><div className="status">{message}</div></section><aside className="properties"><h3>Properties</h3>{selected&&parts.find(p=>p.id===selected)?<><label>Component</label><p>{selected}</p><label>Value</label><input value={parts.find(p=>p.id===selected)!.value} onChange={e=>setParts(ps=>ps.map(p=>p.id===selected?{...p,value:e.target.value}:p))}/><button className="danger" onClick={remove}>Delete selected</button></>:selected?<><p>Selected wire</p><button className="danger" onClick={remove}>Delete wire</button></>:<p className="muted">Select a component to edit its value.</p>}<h3>Project</h3><p>{parts.length} components</p><p>{wires.length} wires</p><div className="hint">Electrical connectivity and simulation will be added next. This is a visual editor prototype.</div></aside></main></div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
