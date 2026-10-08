# OpenCircuit Studio — OrCAD Modernized CAD Editor (v0.4 simulation base)

A beginner-friendly browser-based circuit design and SPICE simulation application with a modern 2D schematic editor, electrical net extraction, and Python FastAPI + ngspice simulation backend.


## OrCAD Modernized — Current CAD editor additions (October 2026)
The app now boots into an **editable Op-Amp schematic example**, rather than the old four-component starter view. Use **File → Open RC Starter Example** for the legacy circuit, or **New** for a blank schematic.

- **Modern CAD chrome:** File / Edit / Place / View / PSpice menus, vertical tool rail, project explorer, component search, Dark/Light toggle and CAD sheet with border/title block.
- **Op-Amp simulation:** Five-pin symbol (IN−, IN+, OUT, V+, V−) now supports a **Generic Op-Amp** approximate DC behavioral macro-model (gain 100,000, output limited to rails ±1.5 V of headroom, 50 Ω output resistance, 1 GΩ differential input resistance). SPICE deck includes an allowlisted built-in `.subckt` and `.op`; the backend validates the exact macro. **This is NOT the manufacturer's uA741 model.**
- **Wire routing:** choose Wire; click a pin, existing wire, or empty grid to start. Click grid points to lay orthogonal bends. Click a pin/existing wire to finish and create a real T-junction when needed. Double-click empty grid to finish with a dangling electrical endpoint. Press Esc or right-click to cancel. Select a wire, double-click a straight segment to add an editable bend, and drag orange handles to reroute.
- **Net Alias:** select wire and edit alias in Properties, or select a component and edit aliases per pin. Pins with the same valid alias are connected electrically even without a drawn wire. Aliases appear on the schematic.
- **Electrical integrity:** explicit junction endpoints are stored in optional `junctions` along with optional `netAliases` in backwards-compatible v2 project JSON. Wire intersections without an explicit junction **do not** short nets; save/open supports new data.
- **Testing:** `npm test` for model/routing/aliases, `npm run test:backend` for Python safety and backend tests, `npm run build` for TypeScript/Vite.

**Still not implemented:** authentic vendor uA741 SPICE models, importable symbol/model libraries, true multiple schematic sheets, comprehensive ERC, and advanced routing. **Generic Op-Amp DC approximation is now simulated using ngspice, but is not a precise uA741 model.**

## Requirements
- **Frontend:** Node.js 22.12+ (supports built-in TypeScript test runner)
- **Backend:** Python 3.10+ with `fastapi`, `uvicorn`, and `pydantic`
- **SPICE Engine:** `ngspice` (supports KiCad shared library `ngspice.dll` or standalone `ngspice` CLI in PATH)

## Quick Start

### 1. Start the Simulation Backend (Terminal 1)
```bash
# Start FastAPI backend on http://localhost:8000
npm run backend
# or: python -m uvicorn backend.main:app --reload --port 8000
```

### 2. Start the Web Frontend (Terminal 2)
```bash
npm install
npm run dev
```
Open the URL shown by Vite (typically http://localhost:5173).

## Testing and Verification
```bash
# Run Frontend Node.js unit tests (CAD model, junctions, aliases and routes)
npm test

# Run Backend Python test suite (4 test cases)
npm run test:backend

# Verify TypeScript typecheck and production build
npm run build
```

## Features in v0.4

### 1. GUI-First Layout
- **Top Toolbar:**
  - `＋ New`: Clear canvas to start a new circuit.
  - `⇪ Open` / `⤓ Save`: Open and save versioned JSON project files (`v2`).
  - `↶ Undo` / `↷ Redo`: 100-step immutable history stack (Ctrl+Z / Ctrl+Y).
  - `▶ Run Simulation`: Opens the Simulation Settings dialog.
  - `Preview Netlist`: Inspect generated SPICE netlist and download `.cir` files.
  - Backend status badge: Real-time indication of backend connectivity.
- **Left Panel (Library & Tools):**
  - Select / Move tool, Wire tool, and Pan tool.
  - R, C, L, V, and Ground components with click-to-place and drag-and-drop.
- **Center Canvas:**
  - 20-unit snap-to-grid SVG canvas.
  - Wires dynamically tracking component translations and 90° rotations.
  - Polarized Voltage Source symbols with clear `+` and `−` terminal indicators.
  - Zoom controls (50% to 300%) and pan.
- **Right Properties Panel:**
  - Live value editing with SI prefix support (`1kΩ`, `100nF`, `10mH`, `5V`).
  - Pin-to-Node electrical breakdown for each selected component.
  - Rotation and deletion controls.
- **Bottom Simulation Results Panel:**
  - Collapsible/expandable panel with tabs.
  - Status indicators: `Idle`, `Running...`, `Completed`, `Failed`.
  - **Node Voltages Table:** Node name, voltage in volts, humanized SI notation, and connected pins.
  - **Branch Currents Table:** Voltage source branch currents in amperes and humanized SI notation.
  - Clear error reporting for connection failures or invalid circuits.
  - Future Waveform Viewer tab placeholder (`v0.5`).

### 2. Simulation Backend (FastAPI + ngspice)
- Endpoint `GET /api/health`: Service health and ngspice detection.
- Endpoint `POST /api/simulate`:
  - Strict input validation: size limit (64 KB), line limit (500 lines), regex-whitelisted SPICE statements only.
  - No `shell=True` execution; sandboxed subprocess with a strict 5.0-second timeout.
  - Real calculations via ngspice (no hardcoded outputs).
  - Correct voltage source polarity mapping from pin definitions (`pin 1 = +`, `pin 0 = −`).

## Verified Test Cases
1. **Voltage Divider (10V, R1=1kΩ, R2=1kΩ):**
   - V(0) = 0.000 V (Ground)
   - V(n1) = 10.000 V
   - V(n2) = 5.000 V (Vout)
   - I(V1) = -0.005 A (-5 mA)
2. **RC Low-Pass Filter at DC Steady State (5V, R1=1kΩ, C1=100nF):**
   - V(0) = 0.000 V
   - V(n1) = 5.000 V
   - V(n2) = 5.000 V
   - I(V1) = 0.000 A (capacitor acts as an open circuit in DC steady state)
3. **Backend Unavailable / Disconnected:**
   - Graceful error banner with instructions to run `npm run backend`.

## Current Limitations & Next Steps (v0.5)
- **v0.4:** Supports DC Operating Point (`.op`) simulation.
- **v0.5 (Planned):** Transient analysis (`.tran`), AC frequency response (`.ac`), and interactive waveform charts.
- **T-junctions:** Explicit electrical junctions and branching from an existing wire are implemented. Geometric crossings stay disconnected unless intentionally joined.

## User Communication Rules (Mandatory)

### Language
- Always communicate with the user in Thai.
- All explanations, questions, progress summaries, implementation reports, and troubleshooting instructions must be written in Thai.
- Technical terms, code, filenames, API names, and command names may remain in English where appropriate.
- Use clear and beginner-friendly Thai explanations.

### Asking Questions
- **Whenever you need to ask the user a question, you MUST use the `AskUserQuestion` tool if it is available.**
- All questions submitted through `AskUserQuestion` MUST be written in Thai.
- All answer choices, descriptions, and clarification text in the tool MUST also be written in Thai.
- Do not ask clarification questions through ordinary chat messages when `AskUserQuestion` is available.
- Ask only questions that are necessary for implementation decisions or missing requirements.
- Prefer presenting 2–4 clear choices with a recommended default when the tool supports choices.
- Do not ask the user to make minor technical decisions that can be resolved safely from the existing code or project requirements.
- If `AskUserQuestion` is unavailable, ask a concise question in Thai through the normal conversation.

### Project Direction
- OpenCircuit Web Studio is a GUI-first, 2D electronic schematic editor and circuit simulator.
- Prioritize a traditional 2D schematic interface with electronic symbols, orthogonal wires, junction dots, grid snapping, and intuitive mouse interactions.
- Do not introduce 3D rendering, 3D components, or Breadboard View unless the user explicitly requests them.
- Users must be able to design and simulate circuits through the GUI without manually writing SPICE commands.
- Preserve existing functionality and test changes before reporting completion.

### Before Making Major Changes
- Read `CLAUDE.md` and inspect the current codebase.
- If requirements are ambiguous and different choices would materially change the implementation, ask the user through `AskUserQuestion` in Thai before proceeding.
- If requirements are clear, proceed without unnecessary questions.
- Never claim a feature has been tested unless the relevant test was actually executed.
- Clearly distinguish implemented features, tested features, and planned features.

### Reporting Results
- Summarize completed work in Thai.
- List important files changed.
- Report actual test commands and results.
- Explain remaining limitations and the next recommended step.
- Be transparent about anything that could not be verified.

## ภาษาไทย / English UI
- OpenCircuit เปิดหน้าใหม่เป็น **ภาษาไทย** โดยค่าเริ่มต้น และมีปุ่ม **EN · English** บน Toolbar เพื่อสลับเป็นอังกฤษ
- เมื่อเลือกภาษาอังกฤษ ปุ่มเปลี่ยนเป็น **TH · ไทย** กดเพื่อกลับมาใช้ภาษาไทยได้ทันทีโดยไม่ต้องโหลดหน้าใหม่
- ภาษาและธีมเก็บไว้ใน Browser Local Storage (`opencircuit-language`, `opencircuit-theme`)
- แปลเฉพาะข้อความ UI เมนู เครื่องมือ Properties และคำเตือน; ชื่อ Net (เช่น VCC/VOUT), ค่าอุปกรณ์, SPICE Netlist และ JSON ยังคงเดิมเสมอ
- การแปล UI อยู่ที่ `src/i18n.ts`; เพิ่มคำแปลโดยเพิ่ม key ภาษาอังกฤษและคำภาษาไทยใน `thai`
