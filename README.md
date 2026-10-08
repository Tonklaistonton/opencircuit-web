# OpenCircuit Web Studio v0.1

A beginner-friendly React + TypeScript schematic editor prototype.

## Requirements
- Node.js 20.19+ or 22.12+

## Run
```bash
npm install
npm run dev
```
Open the local URL printed by Vite (usually http://localhost:5173).

## Features
- Place R, C, L, V, Ground symbols
- Drag components on a grid
- Click two terminal dots in Wire mode to connect them
- Select and delete components or wires
- Edit displayed component values
- Save/load project JSON

## Limitations
This is **not** an electrical simulator yet. It does not calculate electrical nodes or run ngspice. Wires are simple right-angle paths and may overlap; dragging components moves their connected endpoints. The JSON loader only checks basic array shape and should not be used with untrusted files in production.

## Next steps
Separate the data model from the rendering code, implement net extraction (union-find), validate component values, build SPICE netlists, then add a sandboxed FastAPI/ngspice service. Add a separate breadboard layout keyed by component and pin IDs.
