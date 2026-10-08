# OpenCircuit Web Studio v0.2

A beginner-friendly React + TypeScript **visual schematic editor**. No electrical simulation yet.

## Requirements
- Node.js 22.12+ (required for the built-in TypeScript test runner)

## Run
```bash
npm install
npm run dev
```
Open the local URL printed by Vite (usually http://localhost:5173).

## Test and build
```bash
npm test
npm run build
```
`npm test` checks project-file validation, v0.1 migration and rotated pin coordinates. `npm run build` checks TypeScript and produces the Vite build.

## Editor controls
1. Click R, C, L, V or G in the component library, then click the canvas; or drag a component from the library onto the canvas. Placement snaps to the 20-unit grid.
2. Select **Wire**, then click two pin dots. Select a component and drag it; its connected wire follows the pin.
3. Select a component to edit **Value**, rotate it by 90°, or delete it. Click a wire to select/delete it. **Delete** also works outside inputs.
4. Use **Pan** and drag the canvas (or middle-drag); use **+ / −** to zoom from 50% to 300%.
5. Use **Undo / Redo** or **Ctrl+Z / Ctrl+Y** (Cmd on macOS). Editing a value commits one undo step when its field loses focus. Press **Esc** to cancel a pending wire or drag.
6. Use **Save JSON / Open JSON**. Version 2 projects separate `components` with stable `pins` and `wires` from `schematic` placements. Existing version 1 JSON files load through migration; saved files use version 2. Opening an invalid file leaves the current project unchanged.

## Limitations
- This draws a circuit; it does **not** extract electrical nets, validate electrical values, generate a SPICE netlist, simulate, plot waveforms or provide a breadboard view.
- Wires are single right-angle paths between pins. They may overlap; bends and junctions are not editable or connected.
- Undo/Redo covers project edits, not zoom/pan. It keeps up to 100 undo steps; opening a file starts a new history.
- Project import checks version, IDs, types, placement, references, duplicates and file size. It does not yet parse electrical units or implement migrations beyond v0.1.

## Next steps
Add wire junctions and segment routing, then electrical net extraction and unit validation before SPICE export. A future simulation service must isolate ngspice and enforce resource limits.
