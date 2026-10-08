/**
 * Client API for communicating with the Python FastAPI simulation service.
 */

export type SimulationStatus = 'idle' | 'running' | 'completed' | 'failed';

export type SimulationResult = {
  status: 'success' | 'error';
  analysis: 'op';
  node_voltages: Record<string, number>;
  branch_currents: Record<string, number>;
  message?: string;
  raw_output?: string;
};

const BACKEND_URL = (typeof window !== 'undefined' && (window as unknown as {__BACKEND_URL__?: string}).__BACKEND_URL__) ||
  'http://localhost:8000';

export async function checkBackendHealth(): Promise<{available: boolean; ngspiceAvailable?: boolean; message?: string}> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return {available: false, message: `Backend responded with HTTP ${res.status}`};
    const data = await res.json() as {status: string; ngspice_available?: boolean};
    return {available: data.status === 'ok', ngspiceAvailable: data.ngspice_available};
  } catch (error) {
    return {
      available: false,
      message: error instanceof Error ? error.message : 'Backend unreachable',
    };
  }
}

export async function requestSimulation(netlist: string, simType: 'op' = 'op'): Promise<SimulationResult> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}/api/simulate`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({netlist, sim_type: simType}),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    const isOffline = error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError');
    const tip = isOffline
      ? 'Cannot connect to backend service. Please ensure the server is running:\n  python -m uvicorn backend.main:app --reload --port 8000'
      : (error instanceof Error ? error.message : 'Unknown connection error');
    return {
      status: 'error',
      analysis: 'op',
      node_voltages: {},
      branch_currents: {},
      message: tip,
    };
  }

  try {
    const result = await response.json() as SimulationResult;
    return result;
  } catch {
    return {
      status: 'error',
      analysis: 'op',
      node_voltages: {},
      branch_currents: {},
      message: `Invalid server response (HTTP ${response.status}).`,
    };
  }
}
