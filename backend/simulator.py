"""Simulation engine interface for OpenCircuit Web Studio.

Safely validates SPICE netlists and runs ngspice simulation
with strict timeouts and resource limits.
"""

from __future__ import annotations

import ctypes
import os
import re
import shutil
import subprocess
import sys
from typing import Any, Dict, List, Optional, Tuple

MAX_NETLIST_BYTES = 64 * 1024
MAX_NETLIST_LINES = 500
TIMEOUT_SECONDS = 5.0

ALLOWED_LINE_PATTERN = re.compile(
    r"^(\s*|"
    r"\*.*|"
    r"OpenCircuit\s+schematic.*|"
    r"[rR]\w+\s+\w+\s+\w+\s+[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|"
    r"[cC]\w+\s+\w+\s+\w+\s+[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|"
    r"[lL]\w+\s+\w+\s+\w+\s+[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|"
    r"[vV]\w+\s+\w+\s+\w+(?:\s+[dD][cC])?\s+[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|"
    r"\.op|"
    r"\.end)"
    r"\s*$",
    re.IGNORECASE,
)

FORBIDDEN_PATTERNS = [
    re.compile(r"\b(system|shell|exec|include|lib|load|codemodel|source)\b", re.IGNORECASE),
    re.compile(r"[;`$|&><]"),
]


def find_ngspice_library() -> Optional[str]:
    """Find ngspice shared library or return None."""
    env_path = os.environ.get("NGSPICE_LIB_PATH")
    if env_path and os.path.exists(env_path):
        return env_path

    search_paths = [
        r"C:\Program Files\KiCad\10.0\bin\ngspice.dll",
        r"C:\Program Files\KiCad\9.0\bin\ngspice.dll",
        r"C:\Program Files\KiCad\8.0\bin\ngspice.dll",
        r"C:\Program Files\KiCad\bin\ngspice.dll",
        r"C:\Program Files\Spice\bin\ngspice.dll",
        r"C:\Program Files (x86)\Spice\bin\ngspice.dll",
        "/usr/lib/x86_64-linux-gnu/libngspice.so",
        "/usr/local/lib/libngspice.so",
        "/opt/homebrew/lib/libngspice.dylib",
        "/usr/local/lib/libngspice.dylib",
    ]
    for path in search_paths:
        if os.path.exists(path):
            return path

    return None


def find_ngspice_executable() -> Optional[str]:
    """Find ngspice binary executable in PATH."""
    env_path = os.environ.get("NGSPICE_BIN_PATH")
    if env_path and os.path.exists(env_path):
        return env_path
    return shutil.which("ngspice")


def is_ngspice_available() -> bool:
    """Check if either ngspice library or executable is available."""
    return find_ngspice_library() is not None or find_ngspice_executable() is not None


def validate_netlist(netlist: str, sim_type: str = "op") -> Tuple[bool, Optional[str]]:
    """Strictly validate netlist to prevent command injection and malformed inputs."""
    if sim_type != "op":
        return False, f"Unsupported simulation type '{sim_type}'. v0.4 only supports 'op'."

    if not isinstance(netlist, str) or not netlist.strip():
        return False, "Netlist cannot be empty."

    if len(netlist.encode("utf-8")) > MAX_NETLIST_BYTES:
        return False, f"Netlist exceeds maximum allowed size ({MAX_NETLIST_BYTES} bytes)."

    lines = netlist.strip().splitlines()
    if len(lines) > MAX_NETLIST_LINES:
        return False, f"Netlist exceeds maximum allowed line count ({MAX_NETLIST_LINES} lines)."

    for forbidden in FORBIDDEN_PATTERNS:
        if forbidden.search(netlist):
            return False, "Netlist contains forbidden directives or characters."

    has_component = False
    has_end = False

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("*"):
            continue
        if not ALLOWED_LINE_PATTERN.match(stripped):
            return False, f"Invalid or disallowed netlist statement: '{stripped}'"
        first = stripped[0].upper()
        if first in ("R", "C", "L", "V"):
            has_component = True
        if stripped.lower() == ".end":
            has_end = True

    if not has_component:
        return False, "Netlist contains no components."

    return True, None


def run_op_simulation_worker(netlist: str, lib_path: str) -> Dict[str, Any]:
    """Execute DC operating point using ngspice shared library in-process."""
    dll = ctypes.cdll.LoadLibrary(lib_path)

    SENDCHAR = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p)
    STAT = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p)
    CONTROL = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_int, ctypes.c_void_p)

    output_lines: List[str] = []

    def cb_char(msg: bytes, _id: int, _user: Any) -> int:
        if msg:
            output_lines.append(msg.decode("utf-8", errors="ignore"))
        return 0

    c_cb_char = SENDCHAR(cb_char)
    c_cb_stat = STAT(lambda m, i, u: 0)
    c_cb_ctrl = CONTROL(lambda code, u: 0)

    # Initialize ngspice
    dll.ngSpice_Init(c_cb_char, c_cb_stat, c_cb_ctrl, None, None, None, None)

    # Prepare netlist lines, ensuring .op is present before .end
    lines = [line.strip() for line in netlist.strip().splitlines() if line.strip()]
    cleaned: List[str] = []
    has_op = False
    for line in lines:
        if line.lower() == ".op":
            has_op = True
        elif line.lower() == ".end":
            continue
        cleaned.append(line)

    if not has_op:
        cleaned.append(".op")
    cleaned.append(".end")

    cir_bytes = [line.encode("utf-8") for line in cleaned] + [None]
    cir_array = (ctypes.c_char_p * len(cir_bytes))(*cir_bytes)

    ret_circ = dll.ngSpice_Circ(cir_array)
    if ret_circ != 0:
        return {
            "status": "error",
            "message": f"ngspice failed to parse circuit (error code {ret_circ})",
            "raw_output": "".join(output_lines),
        }

    ret_run = dll.ngSpice_Command(b"run")
    if ret_run != 0:
        return {
            "status": "error",
            "message": f"ngspice failed to execute simulation (error code {ret_run})",
            "raw_output": "".join(output_lines),
        }

    dll.ngSpice_CurPlot.restype = ctypes.c_char_p
    plot_name = dll.ngSpice_CurPlot()
    if not plot_name:
        return {
            "status": "error",
            "message": "ngspice produced no active plot.",
            "raw_output": "".join(output_lines),
        }

    dll.ngSpice_AllVecs.restype = ctypes.POINTER(ctypes.c_char_p)
    vecs_ptr = dll.ngSpice_AllVecs(plot_name)

    class VectorInfo(ctypes.Structure):
        _fields_ = [
            ("v_name", ctypes.c_char_p),
            ("v_type", ctypes.c_int),
            ("v_flags", ctypes.c_short),
            ("v_realdata", ctypes.POINTER(ctypes.c_double)),
            ("v_compdata", ctypes.c_void_p),
            ("v_length", ctypes.c_int),
        ]

    dll.ngGet_Vec_Info.restype = ctypes.POINTER(VectorInfo)

    node_voltages: Dict[str, float] = {"0": 0.0}
    branch_currents: Dict[str, float] = {}

    idx = 0
    while vecs_ptr and vecs_ptr[idx]:
        vec_name_bytes = vecs_ptr[idx]
        vec_name = vec_name_bytes.decode("utf-8", errors="ignore")
        idx += 1

        info_ptr = dll.ngGet_Vec_Info(vec_name_bytes)
        if not info_ptr:
            continue
        info = info_ptr.contents
        if not info.v_realdata or info.v_length < 1:
            continue

        val = float(info.v_realdata[0])

        if "#branch" in vec_name.lower() or "#i" in vec_name.lower():
            # e.g. v1#branch -> V1
            comp_id = re.sub(r"#(branch|i)$", "", vec_name, flags=re.IGNORECASE).upper()
            branch_currents[comp_id] = val
        else:
            # e.g. n1, n2, vout -> node voltage
            node_voltages[vec_name] = val

    return {
        "status": "success",
        "analysis": "op",
        "node_voltages": node_voltages,
        "branch_currents": branch_currents,
        "raw_output": "".join(output_lines),
    }


def simulate(netlist: str, sim_type: str = "op") -> Dict[str, Any]:
    """Top-level simulation function with validation and isolated subprocess execution."""
    valid, err = validate_netlist(netlist, sim_type)
    if not valid:
        return {"status": "error", "message": err or "Invalid netlist."}

    lib_path = find_ngspice_library()
    if not lib_path:
        # Check CLI fallback
        cli_path = find_ngspice_executable()
        if not cli_path:
            return {
                "status": "error",
                "message": (
                    "ngspice simulation engine is not available on the server. "
                    "Please install ngspice or KiCad."
                ),
            }
        return simulate_via_cli(netlist, cli_path)

    # Run in isolated worker script using subprocess for process isolation and strict timeout
    worker_script = (
        "import json, sys\n"
        "from backend.simulator import run_op_simulation_worker\n"
        "try:\n"
        "    data = json.loads(sys.stdin.read())\n"
        "    res = run_op_simulation_worker(data['netlist'], data['lib_path'])\n"
        "    print(json.dumps(res))\n"
        "except Exception as e:\n"
        "    print(json.dumps({'status': 'error', 'message': str(e)}))\n"
    )

    try:
        proc = subprocess.run(
            [sys.executable, "-c", worker_script],
            input=__import__("json").dumps({"netlist": netlist, "lib_path": lib_path}),
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
        )
        if proc.returncode != 0:
            return {
                "status": "error",
                "message": f"Simulation process crashed (exit code {proc.returncode}): {proc.stderr.strip()}",
                "raw_output": proc.stdout,
            }
        import json
        return json.loads(proc.stdout.strip())
    except subprocess.TimeoutExpired:
        return {
            "status": "error",
            "message": f"Simulation timed out after {TIMEOUT_SECONDS} seconds.",
        }
    except Exception as e:
        return {"status": "error", "message": f"Simulation execution error: {str(e)}"}


def simulate_via_cli(netlist: str, cli_path: str) -> Dict[str, Any]:
    """Fallback runner using ngspice CLI batch mode without shell=True."""
    import tempfile
    import json

    with tempfile.NamedTemporaryFile("w", suffix=".cir", delete=False) as f:
        f.write(netlist)
        if ".op" not in netlist.lower():
            f.write("\n.op\n")
        temp_name = f.name

    try:
        proc = subprocess.run(
            [cli_path, "-b", temp_name],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
        )
        output = proc.stdout + "\n" + proc.stderr
        # Parse standard ngspice CLI .op output
        # Node voltages: e.g. "n1 = 5.000000e+00" or tabular format
        node_voltages: Dict[str, float] = {"0": 0.0}
        branch_currents: Dict[str, float] = {}

        for line in output.splitlines():
            # Match e.g. "v(n1) = 5.000000e+00" or "n1 = 5.000000e+00"
            m_v = re.match(r"^\s*(?:v\()?(\w+)\)?\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)", line, re.I)
            if m_v:
                node, val = m_v.group(1), float(m_v.group(2))
                if "#branch" in node.lower() or "#i" in node.lower():
                    comp_id = re.sub(r"#(branch|i)$", "", node, flags=re.I).upper()
                    branch_currents[comp_id] = val
                else:
                    node_voltages[node] = val

            # Match e.g. "i(v1) = -5.000000e-03"
            m_i = re.match(r"^\s*i\((\w+)\)\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)", line, re.I)
            if m_i:
                comp, val = m_i.group(1).upper(), float(m_i.group(2))
                branch_currents[comp] = val

        return {
            "status": "success",
            "analysis": "op",
            "node_voltages": node_voltages,
            "branch_currents": branch_currents,
            "raw_output": output,
        }
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": f"Simulation timed out after {TIMEOUT_SECONDS}s."}
    except Exception as e:
        return {"status": "error", "message": f"CLI execution error: {str(e)}"}
    finally:
        if os.path.exists(temp_name):
            try:
                os.remove(temp_name)
            except OSError:
                pass
