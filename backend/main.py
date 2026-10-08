"""FastAPI application for OpenCircuit Web Studio simulation service.
"""

from __future__ import annotations

from typing import Dict, Literal, Optional
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.simulator import is_ngspice_available, simulate

app = FastAPI(
    title="OpenCircuit Simulation Service",
    description="Deterministic ngspice simulation backend for OpenCircuit Web Studio",
    version="0.4.0",
)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SimulationRequest(BaseModel):
    netlist: str = Field(..., max_length=65536, description="SPICE netlist string")
    sim_type: Literal["op"] = Field("op", description="Simulation type (v0.4 supports 'op')")


class SimulationResponse(BaseModel):
    status: Literal["success", "error"]
    analysis: str = "op"
    node_voltages: Dict[str, float] = Field(default_factory=dict)
    branch_currents: Dict[str, float] = Field(default_factory=dict)
    message: Optional[str] = None
    raw_output: Optional[str] = None


@app.get("/api/health")
def health_check() -> Dict[str, object]:
    """Health check endpoint reporting service status and ngspice readiness."""
    return {
        "status": "ok",
        "service": "OpenCircuit Simulation Service",
        "version": "0.4.0",
        "ngspice_available": is_ngspice_available(),
    }


@app.post("/api/simulate", response_model=SimulationResponse)
def run_simulation(req: SimulationRequest) -> SimulationResponse:
    """Run SPICE simulation with strict validation and isolation."""
    result = simulate(req.netlist, req.sim_type)

    if result.get("status") == "error":
        # If simulation failed due to netlist validation or engine failure,
        # return structured error in response body so frontend UI can display it
        return SimulationResponse(
            status="error",
            analysis=req.sim_type,
            message=result.get("message", "Simulation failed"),
            raw_output=result.get("raw_output"),
        )

    return SimulationResponse(
        status="success",
        analysis=result.get("analysis", req.sim_type),
        node_voltages=result.get("node_voltages", {}),
        branch_currents=result.get("branch_currents", {}),
        raw_output=result.get("raw_output"),
    )
