"""Automated tests for OpenCircuit simulation backend.
"""

import unittest
from fastapi.testclient import TestClient

from backend.main import app


class TestSimulationBackend(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_endpoint(self):
        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data.get("status"), "ok")
        self.assertEqual(data.get("version"), "0.4.0")
        self.assertTrue(data.get("ngspice_available"))

    def test_voltage_divider_dc_operating_point(self):
        netlist = (
            "OpenCircuit schematic\n"
            "V1 n1 0 DC 10\n"
            "R1 n1 n2 1000\n"
            "R2 n2 0 1000\n"
            ".op\n"
            ".end\n"
        )
        resp = self.client.post("/api/simulate", json={"netlist": netlist, "sim_type": "op"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data.get("status"), "success")
        self.assertEqual(data.get("analysis"), "op")

        voltages = data.get("node_voltages", {})
        self.assertAlmostEqual(voltages.get("0", -1), 0.0, places=4)
        self.assertAlmostEqual(voltages.get("n1", 0), 10.0, places=4)
        self.assertAlmostEqual(voltages.get("n2", 0), 5.0, places=4)

        currents = data.get("branch_currents", {})
        self.assertIn("V1", currents)
        self.assertAlmostEqual(currents["V1"], -0.005, places=5)

    def test_rc_lowpass_dc_steady_state(self):
        netlist = (
            "OpenCircuit schematic\n"
            "C1 n1 0 1e-7\n"
            "R1 n2 n1 1000\n"
            "V1 n2 0 DC 5\n"
            ".op\n"
            ".end\n"
        )
        resp = self.client.post("/api/simulate", json={"netlist": netlist, "sim_type": "op"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data.get("status"), "success")

        voltages = data.get("node_voltages", {})
        self.assertAlmostEqual(voltages.get("0", -1), 0.0, places=4)
        self.assertAlmostEqual(voltages.get("n2", 0), 5.0, places=4)
        self.assertAlmostEqual(voltages.get("n1", 0), 5.0, places=4)

        currents = data.get("branch_currents", {})
        self.assertIn("V1", currents)
        self.assertAlmostEqual(currents["V1"], 0.0, places=5)

    def test_malicious_or_forbidden_netlist_rejected(self):
        forbidden_cases = [
            "OpenCircuit schematic\n.system calc\n.end",
            "OpenCircuit schematic\nR1 n1 0 1000; rm -rf /\n.end",
            "OpenCircuit schematic\n.include /etc/passwd\n.end",
            "",
            "   \n\n  ",
        ]
        for bad in forbidden_cases:
            resp = self.client.post("/api/simulate", json={"netlist": bad, "sim_type": "op"})
            # May be 422 (pydantic validation) or 200 with status="error"
            if resp.status_code == 200:
                data = resp.json()
                self.assertEqual(data.get("status"), "error")
                self.assertIsNotNone(data.get("message"))
            else:
                self.assertEqual(resp.status_code, 422)


if __name__ == "__main__":
    unittest.main()
