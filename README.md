# OpenCircuit Web Studio v0.4 — GUI-First Circuit Simulation

A beginner-friendly browser-based circuit design and SPICE simulation application with a modern 2D schematic editor, electrical net extraction, and Python FastAPI + ngspice simulation backend.

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
# Run Frontend Node.js unit tests (14 test cases)
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
- **T-junctions:** Wires connect pin-to-pin; intermediate branch junctions on wires are planned for a future layout milestone.
