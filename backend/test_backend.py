"""Automated tests for OpenCircuit simulation backend.
"""

import unittest
from fastapi.testclient import TestClient

from backend.main import app
from backend.simulator import OPAMP_MACRO_LINES, validate_netlist


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


    @staticmethod
    def opamp_circuit(vin: float = 1.0) -> str:
        """Closed-loop non-inverting gain ~= 3 with +/-15 V supply rails."""
        return (
            "OpenCircuit schematic\n"
            f"VIN INP 0 DC {vin}\n"
            "VCC VCC 0 DC 15\n"
            "VEE 0 VEE DC 15\n"
            "RF OUT INM 2000\n"
            "RG INM 0 1000\n"
            "XOP1 INP INM VCC VEE OUT OC_OPAMP\n"
            + "\n".join(OPAMP_MACRO_LINES) + "\n.op\n.end\n"
        )

    def test_generic_opamp_dc_closed_loop_gain(self):
        netlist = self.opamp_circuit()
        self.assertEqual(validate_netlist(netlist), (True, None))
        response = self.client.post("/api/simulate", json={"netlist": netlist, "sim_type": "op"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("status"), "success", data.get("message"))
        voltages = data["node_voltages"]
        self.assertAlmostEqual(voltages["out"], 3.0, delta=0.025)
        self.assertAlmostEqual(voltages["vcc"], 15.0, places=3)
        self.assertAlmostEqual(voltages["vee"], -15.0, places=3)

    def test_generic_opamp_negative_input_and_supply_rail_limit(self):
        negative = self.client.post("/api/simulate", json={
            "netlist": self.opamp_circuit(-1.0), "sim_type": "op"}).json()
        self.assertEqual(negative["status"], "success", negative.get("message"))
        self.assertAlmostEqual(negative["node_voltages"]["out"], -3.0, delta=0.025)

        saturated = self.client.post("/api/simulate", json={
            "netlist": self.opamp_circuit(10.0), "sim_type": "op"}).json()
        self.assertEqual(saturated["status"], "success", saturated.get("message"))
        output = saturated["node_voltages"]["out"]
        self.assertGreater(output, 12.0)
        self.assertLess(output, 13.6)

    def test_opamp_macro_requires_exact_reviewed_model(self):
        correct = self.opamp_circuit()
        malicious = [
            correct.replace("100000*", "999999*"),
            correct.replace("OC_OPAMP INP INM", "OC_OTHER INP INM"),
            correct.replace("Rin INP INM 1e9", "Rin INP INM 1e9\n.system calc"),
            correct.replace("Rin INP INM 1e9\n", ""),
            correct.replace(".ends OC_OPAMP\n", ""),
            correct.replace("XOP1 INP INM VCC VEE OUT OC_OPAMP\n", ""),
            correct.replace(".subckt OC_OPAMP", ".subckt OTHER"),
            correct + ".include /etc/passwd\n",
        ]
        for idx, netlist in enumerate(malicious):
            with self.subTest(case=idx):
                valid, _ = validate_netlist(netlist)
                self.assertFalse(valid)
                response = self.client.post("/api/simulate", json={"netlist": netlist, "sim_type": "op"})
                self.assertEqual(response.json()["status"], "error")


if __name__ == "__main__":
    unittest.main()
