import type {LibraryPart, SymbolShape} from './circuit/catalog.ts';

/** Schematic symbols are original SVG primitives; every exposed circle uses a catalog pin. */
export function LibrarySymbol({part}: {part:LibraryPart}) {
  const shape: SymbolShape = part.shape;
  const style = {stroke:'currentColor',strokeWidth:2.2,fill:'none',strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  if (shape==='resistor') return <g {...style}>
    <path d="M-40 0 H-20 L-15 -9 L-6 9 L3 -9 L12 9 L20 0 H40"/>
    {(part.id.includes('variable')||part.id.includes('potentiometer'))&&<path d="M-10 28 L8 6 M0 12 L8 6 L7 16"/>}
  </g>;
  if (shape==='capacitor') return <g {...style}>
    <path d="M-40 0 H-7 M7 0 H40 M-7 -18 V18 M7 -18 V18"/>
    {part.id.includes('electrolytic')&&<text x="12" y="-8" stroke="none" fill="currentColor" fontSize="12">+</text>}
  </g>;
  if (shape==='inductor') return <g {...style}><path d="M-40 0 H-25 Q-20 -23 -15 0 Q-10 -23 -5 0 Q0 -23 5 0 Q10 -23 15 0 H40"/></g>;
  if (shape==='ground') return <g {...style}><path d="M0 -40 V0 M-18 0 H18 M-12 7 H12 M-6 14 H6"/></g>;
  if (shape==='opamp') return <g {...style}>
    <path d="M-20 -48 L60 0 L-20 48 Z M-60 -20 H-20 M-60 20 H-20 M60 0 H80 M0 -60 V-36 M0 36 V60"/>
    <text x="-13" y="-14" fontSize="15" fill="currentColor" stroke="none">−</text>
    <text x="-13" y="24" fontSize="15" fill="currentColor" stroke="none">+</text>
  </g>;
  if (shape==='diode'||shape==='zener'||shape==='led') return <g {...style}>
    <path d="M-40 0 H-18 M18 0 H40 M-18 -14 L17 0 L-18 14 Z M18 -17 V17"/>
    {shape==='zener'&&<path d="M12 -17 H23 M12 17 H23"/>}
    {shape==='led'&&<path d="M0 -24 L18 -42 M8 -42 H18 V-32 M15 -28 L33 -46 M23 -46 H33 V-36"/>}
  </g>;
  if (shape==='source'||shape==='battery') return <g {...style}>
    <path d="M-40 0 H-22 M22 0 H40"/>
    {shape==='source'?<><circle r="22"/><text x="-9" y="5" fill="currentColor" stroke="none" fontSize="13">−</text>
      <text x="8" y="5" fill="currentColor" stroke="none" fontSize="13">+</text></>
      :<path d="M-8 -23 V23 M4 -14 V14 M-8 0 H4"/>}
  </g>;
  if (shape==='npn'||shape==='pnp'||shape==='nmos'||shape==='pmos') {
    const bjt=shape==='npn'||shape==='pnp';
    const inward=shape==='pnp'||shape==='pmos';
    return <g {...style}><circle r="32"/>
      <path d="M-60 0 H-13 M-13 -23 V23 M-13 -12 L22 -40 M-13 12 L22 40 M22 -40 H60 M22 40 H60"/>
      {bjt?<path d={inward?'M-10 12 L12 22 L6 10':'M9 22 L22 40 L4 37'}/>:<path d="M-24 -20 V20" strokeDasharray="3 5"/>}
    </g>;
  }
  if (shape==='switch'||shape==='spdt') return <g {...style}>
    <path d={shape==='spdt'?'M-60 0 H-24 M-24 0 L28 -25 H60 M34 25 H60':'M-40 0 H-18 M18 0 H40 M-18 0 L14 -20'}/>
    <circle cx={shape==='spdt'?-24:-18} cy="0" r="3"/>
    <circle cx={shape==='spdt'?34:18} cy={shape==='spdt'?-25:0} r="3"/>
  </g>;
  if (shape==='transformer') return <g {...style}>
    <path d="M-60 -30 H-38 Q-16 -22 -38 -12 Q-16 -2 -38 8 Q-16 18 -38 30 H-60"/>
    <path d="M60 -30 H38 Q16 -22 38 -12 Q16 -2 38 8 Q16 18 38 30 H60 M-5 -34 V34 M5 -34 V34"/>
  </g>;
  if (shape==='bridge') return <g {...style}>
    <path d="M-60 -30 H-28 M-60 30 H-28 M28 -30 H60 M28 30 H60 M0 -35 L35 0 L0 35 L-35 0 Z"/>
    <text x="-8" y="-4" stroke="none" fill="currentColor" fontSize="14">~</text>
    <text x="11" y="-4" stroke="none" fill="currentColor" fontSize="14">+</text>
  </g>;
  if (shape==='fuse') return <g {...style}><path d="M-40 0 H-20 M20 0 H40 M-20 -11 H20 V11 H-20 Z"/></g>;
  if (shape==='crystal') return <g {...style}><path d="M-40 0 H-14 M14 0 H40 M-14 -20 V20 M14 -20 V20 M-7 -13 H7 V13 H-7 Z"/></g>;
  if (shape==='antenna') return <g {...style}><path d="M0 -40 V10 L-28 -17 M0 10 L28 -17 M-28 -17 L0 -43 L28 -17"/></g>;
  if (shape==='speaker'||shape==='motor'||shape==='lamp') return <g {...style}>
    <path d="M-40 0 H-23 M23 0 H40"/><circle r="23"/>
    {shape==='motor'?<text x="-13" y="8" fontSize="21" fill="currentColor" stroke="none">M</text>:
      shape==='speaker'?<path d="M-13 -12 H-5 L10 -25 V25 L-5 12 H-13 Z"/>:<path d="M-14 -14 L14 14 M14 -14 L-14 14"/>}
  </g>;
  if (shape==='relay') return <g {...style}>
    <rect x="-42" y="-47" width="84" height="94" rx="4" strokeDasharray="4 3"/>
    <path d="M-60 -40 H-30 Q-14 -28 -30 -16 Q-14 -4 -30 8 Q-14 20 -30 40 H-60"/>
    <path d="M60 -40 H40 M60 40 H40 M60 0 H20 L36 -34"/>
  </g>;
  if (shape==='optocoupler') return <g {...style}>
    <rect x="-46" y="-45" width="92" height="90" rx="4" strokeDasharray="4 3"/>
    <path d="M-60 -25 H-32 L-8 -25 L-32 -8 Z M-8 -32 V-2 M-32 25 L-4 7 M-12 15 L-4 7 L-16 7"/>
    <path d="M60 -25 H28 M60 25 H28 M28 -25 L15 0 L28 25"/>
  </g>;
  if (shape==='sensor'||shape==='chip'||shape==='connector'||shape==='logic'||shape==='display') {
    const maxY=Math.max(36,...part.pins.map((pin)=>Math.abs(pin.y)+14));
    const badge=shape==='logic'?'GATE':shape==='sensor'?'SENSOR':shape==='display'?'DISPLAY':
      shape==='connector'?'CONN':'IC';
    return <g {...style}>
      <rect x="-48" y={-maxY} width="96" height={maxY*2} rx={shape==='connector'?2:6}/>
      {part.pins.map((pin,i)=><path key={i} d={pin.x<0?'M'+pin.x+' '+pin.y+' H-48':'M48 '+pin.y+' H'+pin.x}/>)}
      <text x="0" y="-3" stroke="none" fill="currentColor" fontSize="12" textAnchor="middle">{badge}</text>
      <text x="0" y="13" stroke="none" fill="currentColor" fontSize="8" textAnchor="middle">{part.name.slice(0,15)}</text>
    </g>;
  }
  return <g {...style}><rect x="-27" y="-24" width="54" height="48"/></g>;
}
