from backend.simulator import run_op_simulation_worker,find_ngspice_library
base = """OpenCircuit opamp test
VCC VCC 0 DC 15
VEE 0 VEE DC 15
VIN INP 0 DC 1
RF OUT INM 2000
RG INM 0 1000
XU1 INP INM VCC VEE OUT OC_OPAMP
.subckt OC_OPAMP INP INM VP VN OUT
Bdrv core 0 V=FUNCTION(100000*(v(INP)-v(INM)),v(VN)+1.5,v(VP)-1.5)
Rout core OUT 50
Rin INP INM 1e9
.ends OC_OPAMP
.op
.end
"""
for fn in ["limit","minmax","tanh"]:
  if fn=="limit": expr="limit"
  elif fn=="minmax": expr="min(max"
  else: expr="tanh"
  if fn=="limit": line="limit(100000*(v(INP)-v(INM)),v(VN)+1.5,v(VP)-1.5)"
  if fn=="minmax": line="min(max(100000*(v(INP)-v(INM)),v(VN)+1.5),v(VP)-1.5)"
  if fn=="tanh": line="(v(VP)-v(VN))*0.5*tanh(50000*(v(INP)-v(INM)))+(v(VP)+v(VN))*0.5"
  circuit=base.replace("FUNCTION(100000*(v(INP)-v(INM)),v(VN)+1.5,v(VP)-1.5)",line)
  try:
    result=run_op_simulation_worker(circuit,find_ngspice_library())
    print(fn, result.get("status"),result.get("node_voltages",{}).get("out"),result.get("message"))
    print("LOG",result.get("raw_output","")[-900:])
  except Exception as ex:
    print(fn,type(ex).__name__,str(ex))
