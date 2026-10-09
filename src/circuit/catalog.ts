/** Curated original schematic symbol catalogue, not scraped component imagery or vendor SPICE models.
 * Each template can be placed, rotated, wired, and saved; only six established base devices
 * currently have verified DC simulation support.
 */
export type LibraryKind = 'R' | 'C' | 'L' | 'V' | 'G' | 'O' | 'P';
export type SymbolShape =
  | 'resistor' | 'capacitor' | 'inductor' | 'source' | 'ground' | 'opamp'
  | 'diode' | 'led' | 'zener' | 'bridge' | 'npn' | 'pnp' | 'nmos' | 'pmos'
  | 'switch' | 'spdt' | 'relay' | 'transformer' | 'connector'
  | 'chip' | 'logic' | 'sensor' | 'display' | 'motor' | 'speaker'
  | 'battery' | 'fuse' | 'crystal' | 'antenna' | 'lamp' | 'optocoupler';
export type PinDefinition = {name: string; x: number; y: number};
export type LibraryPart = {
  id: string;
  name: string;
  nameTh: string;
  category: string;
  kind: LibraryKind;
  refPrefix: string;
  shape: SymbolShape;
  pins: PinDefinition[];
  defaultValue: string;
  description: string;
  descriptionTh: string;
  simulation: 'dc' | 'schematic';
};

const categories = [
  ['passives','Passive Components','อุปกรณ์พาสซีฟ'],
  ['diodes','Diodes & LEDs','ไดโอดและ LED'],
  ['transistors','Transistors & MOSFETs','ทรานซิสเตอร์และ MOSFET'],
  ['amplifiers','Amplifiers & Analog ICs','ออปแอมป์และไอซีแอนะล็อก'],
  ['logic','Digital Logic','วงจรลอจิก'],
  ['controllers','Microcontrollers & ICs','ไมโครคอนโทรลเลอร์และไอซี'],
  ['power','Power & Sources','แหล่งจ่ายไฟและอุปกรณ์กำลัง'],
  ['switches','Switches & Relays','สวิตช์และรีเลย์'],
  ['connectors','Connectors & Terminals','ขั้วต่อและคอนเนกเตอร์'],
  ['sensors','Sensors','เซนเซอร์'],
  ['displays','Displays & Indicators','จอแสดงผลและตัวบ่งชี้'],
  ['motors','Motors & Audio','มอเตอร์และเสียง'],
  ['timing','Timing & RF','วงจรกำหนดเวลาและ RF'],
  ['protection','Protection','อุปกรณ์ป้องกัน'],
  ['opto','Optoelectronics','อุปกรณ์ออปโต'],
] as const;
export const LIBRARY_CATEGORIES = categories.map(([id,name,nameTh]) => ({id,name,nameTh}));

const two = (a='1', b='2'): PinDefinition[] => [{name:a,x:-40,y:0},{name:b,x:40,y:0}];
function pinLayout(shape: SymbolShape, names?: string[]): PinDefinition[] {
  if (shape === 'ground' || shape === 'antenna') return [{name:names?.[0] ?? '1',x:0,y:-40}];
  if (shape === 'opamp') return ['IN-','IN+','OUT','V+','V-'].map((name,i) =>
    ({name,x:[-60,-60,80,0,0][i],y:[-20,20,0,-60,60][i]}));
  if (shape === 'npn' || shape === 'pnp') return ['B','C','E'].map((name,i) =>
    ({name,x:[-60,60,60][i],y:[0,-40,40][i]}));
  if (shape === 'nmos' || shape === 'pmos') return ['G','D','S'].map((name,i) =>
    ({name,x:[-60,60,60][i],y:[0,-40,40][i]}));
  if (shape === 'spdt') return ['COM','NO','NC'].map((name,i) =>
    ({name,x:[-60,60,60][i],y:[0,-25,25][i]}));
  if (shape === 'relay') return ['COIL+','COIL-','COM','NO','NC'].map((name,i) =>
    ({name,x:[-60,-60,60,60,60][i],y:[-40,40,0,-40,40][i]}));
  if (shape === 'transformer' || shape === 'bridge') return (names ?? (shape === 'bridge'?['AC1','AC2','+','-']:['PRI1','PRI2','SEC1','SEC2']))
      .map((name,i)=>({name,x:i<2?-60:60,y:i%2===0?-30:30}));
  if (shape === 'optocoupler') return ['A','K','C','E'].map((name,i)=>
    ({name,x:i<2?-60:60,y:i%2===0?-25:25}));
  if (shape === 'chip' || shape === 'logic' || shape === 'sensor' ||
      shape === 'display' || shape === 'connector') {
    const labels = names?.length ? names : ['1','2','3','4','5','6','7','8'];
    const left = Math.ceil(labels.length / 2);
    const right = labels.length-left;
    const height = Math.max(left,right,2);
    return labels.map((name,i) => {
      const leftSide = i<left;
      const count = leftSide ? left : right;
      const position = leftSide ? i : i-left;
      return {name,x:leftSide?-72:72,y:(position-(count-1)/2)*24};
    });
  }
  return two(names?.[0] ?? (shape==='diode'||shape==='zener'||shape==='led'?'A':'1'),
    names?.[1] ?? (shape==='diode'||shape==='zener'||shape==='led'?'K':'2'));
}

const parts: LibraryPart[] = [];
function add(id:string,name:string,nameTh:string,category:string,shape:SymbolShape,refPrefix:string,
  description:string,descriptionTh:string,pinNames?:string[],kind:LibraryKind='P',value?:string) {
  if (parts.some((part)=>part.id===id)) throw new Error('Duplicate library part '+id);
  const defaultValue=value ?? name;
  parts.push({id,name,nameTh,category,shape,refPrefix,description,descriptionTh,
    pins:pinLayout(shape,pinNames),kind,defaultValue,simulation:kind==='P'?'schematic':'dc'});
}
function group(category:string,shape:SymbolShape,prefix:string,rows:string,pins?:string[]) {
  for(const row of rows.trim().split('\n').map((line)=>line.trim()).filter(Boolean)) {
    const [id,name,nameTh,description,descriptionTh,pinList]=row.split('|');
    add(id,name,nameTh,category,shape,prefix,description||name,descriptionTh||nameTh,
      pinList?pinList.split(','):pins);
  }
}

add('resistor','Resistor','ตัวต้านทาน','passives','resistor','R','Linear resistor','ตัวต้านทานแบบเชิงเส้น',['1','2'],'R','1kΩ');
add('capacitor','Capacitor','ตัวเก็บประจุ','passives','capacitor','C','Linear capacitor','ตัวเก็บประจุ',['1','2'],'C','100nF');
add('inductor','Inductor','ตัวเหนี่ยวนำ','passives','inductor','L','Linear inductor','ตัวเหนี่ยวนำ',['1','2'],'L','10mH');
add('dc_source','DC Voltage Source','แหล่งจ่ายแรงดัน DC','power','source','V','DC voltage source','แหล่งจ่ายแรงดันคงที่',['-','+'],'V','5V');
add('ground','Ground','กราวด์','power','ground','G','Global SPICE ground','กราวด์ของวงจร',['GND'],'G','GND');
add('generic_opamp','Generic Op-Amp','ออปแอมป์ทั่วไป','amplifiers','opamp','U',
  'Approximate DC model; not a verified vendor chip','โมเดล DC แบบประมาณค่า ไม่ใช่รุ่นผู้ผลิต',
  ['IN-','IN+','OUT','V+','V-'],'O','Generic Op-Amp');

group('passives','resistor','R',`
potentiometer|Potentiometer|โพเทนชิโอมิเตอร์|Adjustable resistor symbol|ตัวต้านทานปรับค่าได้
thermistor_ntc|NTC Thermistor|เทอร์มิสเตอร์ NTC|Temperature-dependent resistor symbol|ตัวต้านทานไวต่ออุณหภูมิ
thermistor_ptc|PTC Thermistor|เทอร์มิสเตอร์ PTC|Positive-temperature resistor symbol|ตัวต้านทานไวต่ออุณหภูมิชนิดบวก
photoresistor|LDR / Photoresistor|ตัวต้านทานไวแสง|Light-dependent resistor|ตัวต้านทานปรับตามแสง
shunt|Current Sense Resistor|ตัวต้านทานตรวจวัดกระแส|Precision current shunt|ตัวต้านทานวัดกระแส
`);
group('passives','capacitor','C',`
electrolytic_cap|Electrolytic Capacitor|ตัวเก็บประจุอิเล็กโทรไลต์|Polarized capacitor schematic|ตัวเก็บประจุแบบมีขั้ว
ceramic_cap|Ceramic Capacitor|ตัวเก็บประจุเซรามิก|Ceramic capacitor symbol|ตัวเก็บประจุเซรามิก
variable_cap|Variable Capacitor|ตัวเก็บประจุปรับค่าได้|Tunable capacitor symbol|ตัวเก็บประจุปรับค่าได้
supercap|Supercapacitor|ซูเปอร์คาปาซิเตอร์|High-capacitance energy storage|ตัวเก็บประจุความจุสูง
`);
group('passives','inductor','L',`
ferrite_bead|Ferrite Bead|เฟอร์ไรต์บีด|Noise suppression bead|ตัวกรองสัญญาณรบกวน
choke|Common Mode Choke|คอมมอนโหมดโช้ก|Choke reference symbol|โช้กกรองสัญญาณ
variable_inductor|Variable Inductor|ตัวเหนี่ยวนำปรับค่าได้|Adjustable inductor|ตัวเหนี่ยวนำที่ปรับค่าได้
`);
group('diodes','diode','D',`
rectifier_diode|Rectifier Diode|ไดโอดเรียงกระแส|Generic semiconductor diode|ไดโอดทั่วไป
schottky_diode|Schottky Diode|ชอตกีไดโอด|Schottky barrier diode|ไดโอดชอตกี
fast_diode|Fast Recovery Diode|ไดโอดฟื้นตัวเร็ว|Fast switching rectifier|ไดโอดความเร็วสูง
signal_diode|Small Signal Diode|ไดโอดสัญญาณ|General signal diode|ไดโอดสำหรับสัญญาณ
tvs_diode|TVS Diode|ไดโอดป้องกันไฟกระชาก|Transient-voltage suppression|อุปกรณ์ป้องกันไฟกระชาก
`);
group('diodes','zener','D',`
zener_diode|Zener Diode|ซีเนอร์ไดโอด|Voltage reference clamp|ไดโอดรักษาระดับแรงดัน
avalanche_diode|Avalanche Diode|อะวาแลนช์ไดโอด|Avalanche breakdown diode|ไดโอดอะวาแลนช์
varicap|Varactor Diode|วาริแคป|Voltage-variable capacitance|ไดโอดค่าความจุปรับตามแรงดัน
`);
group('diodes','led','D',`
led|LED|หลอด LED|Light emitting diode|ไดโอดเปล่งแสง
rgb_led|RGB LED (2-pin representative)|LED RGB (สัญลักษณ์แทน)|Two-terminal representative; not actual RGB pins|สัญลักษณ์ตัวแทน ไม่ใช่ขาจริงของ RGB
ir_led|Infrared LED|LED อินฟราเรด|Infrared emitter|ไดโอดปล่อยแสงอินฟราเรด
photodiode|Photodiode|โฟโตไดโอด|Light-sensitive diode|ไดโอดไวแสง
`);
group('diodes','bridge','BR',`
bridge_rectifier|Bridge Rectifier|บริดจ์เรียงกระแส|Four terminal rectifier|วงจรเรียงกระแสแบบบริดจ์
`,['AC1','AC2','+','-']);
group('transistors','npn','Q',`
bjt_npn|NPN BJT|ทรานซิสเตอร์ NPN|Generic NPN transistor|ทรานซิสเตอร์ชนิด NPN
darlington_npn|Darlington NPN|ดาร์ลิงตัน NPN|NPN Darlington pair symbol|ทรานซิสเตอร์ดาร์ลิงตัน
phototransistor|NPN Phototransistor|โฟโตทรานซิสเตอร์|Optical NPN transistor|ทรานซิสเตอร์ไวแสง
`);
group('transistors','pnp','Q',`
bjt_pnp|PNP BJT|ทรานซิสเตอร์ PNP|Generic PNP transistor|ทรานซิสเตอร์ชนิด PNP
darlington_pnp|Darlington PNP|ดาร์ลิงตัน PNP|PNP Darlington pair|ทรานซิสเตอร์ดาร์ลิงตัน
`);
group('transistors','nmos','Q',`
nmos|N-Channel MOSFET|มอสเฟตชนิด N|Generic enhancement NMOS|ทรานซิสเตอร์ MOSFET ชนิด N
nmos_power|Power NMOS|มอสเฟตกำลัง N|High current N-MOSFET|มอสเฟตกำลัง
n_jfet|N-Channel JFET|เจเฟตชนิด N|Junction FET symbol|ทรานซิสเตอร์ JFET
igbt|IGBT (3-pin symbol)|ไอจีบีที|Insulated gate bipolar transistor|ทรานซิสเตอร์กำลัง IGBT
`);
group('transistors','pmos','Q',`
pmos|P-Channel MOSFET|มอสเฟตชนิด P|Generic PMOS|ทรานซิสเตอร์ MOSFET ชนิด P
p_jfet|P-Channel JFET|เจเฟตชนิด P|Junction FET symbol|ทรานซิสเตอร์ JFET ชนิด P
`);
group('amplifiers','opamp','U',`
dual_opamp_unit|Op-Amp Unit|ออปแอมป์ยูนิต|Five-terminal generic amplifier symbol|สัญลักษณ์ออปแอมป์ห้าขา
comparator|Comparator|คอมพาเรเตอร์|Analog comparator symbol|วงจรเปรียบเทียบแรงดัน
instrumentation_amp|Instrumentation Amplifier|เครื่องขยายวัดสัญญาณ|Precision differential amplifier symbol|วงจรขยายสัญญาณวัด
audio_amp|Audio Amplifier|เครื่องขยายเสียง|Audio amplifier schematic block|วงจรขยายเสียง
transimpedance_amp|Transimpedance Amplifier|เครื่องขยายกระแสเป็นแรงดัน|Current-to-voltage amplifier|วงจรขยายแบบกระแสเป็นแรงดัน
`);
group('amplifiers','chip','U',`
voltage_regulator|3-Pin Voltage Regulator|ไอซีควบคุมแรงดัน|Generic three terminal regulator|เรกูเลเตอร์แรงดัน|IN,GND,OUT
buck_converter|Buck Converter IC|ไอซีลดแรงดัน|Generic 6-pin DC-DC converter block|ตัวแปลงไฟ DC-DC แบบลดแรงดัน|VIN,GND,SW,FB,EN,VOUT
boost_converter|Boost Converter IC|ไอซีเพิ่มแรงดัน|Generic DC-DC step-up converter|ตัวแปลงไฟเพิ่มแรงดัน|VIN,GND,SW,FB,EN,VOUT
adc|ADC (8-pin generic)|ไอซี ADC|Analog-to-digital converter block|ไอซีแปลงแอนะล็อกเป็นดิจิทัล|VCC,GND,AIN,REF,D0,D1,D2,D3
dac|DAC (8-pin generic)|ไอซี DAC|Digital-to-analog converter block|ไอซีแปลงดิจิทัลเป็นแอนะล็อก|VCC,GND,D0,D1,D2,D3,REF,VOUT
`);
group('logic','logic','U',`
and2|AND Gate (2 input)|ลอจิก AND|Generic two-input AND gate|เกต AND|A,B,Y
nand2|NAND Gate (2 input)|ลอจิก NAND|Generic two-input NAND gate|เกต NAND|A,B,Y
or2|OR Gate (2 input)|ลอจิก OR|Generic two-input OR gate|เกต OR|A,B,Y
nor2|NOR Gate (2 input)|ลอจิก NOR|Generic two-input NOR gate|เกต NOR|A,B,Y
xor2|XOR Gate (2 input)|ลอจิก XOR|Generic two-input XOR gate|เกต XOR|A,B,Y
xnor2|XNOR Gate (2 input)|ลอจิก XNOR|Generic two-input XNOR gate|เกต XNOR|A,B,Y
not|Inverter / NOT|อินเวอร์เตอร์ NOT|Single-input inverter|เกต NOT|A,Y
buffer|Digital Buffer|บัฟเฟอร์ดิจิทัล|Digital signal buffer|บัฟเฟอร์สัญญาณ|A,Y
flipflop_d|D Flip-Flop|ดีฟลิปฟลอป|Generic D-type flip-flop|วงจรความจำหนึ่งบิต|D,CLK,Q,QBAR,VCC,GND
mux2|2:1 Multiplexer|มัลติเพล็กเซอร์|Two-to-one digital multiplexer|วงจรเลือกสัญญาณ|A,B,SEL,Y
`);
group('controllers','chip','U',`
microcontroller8|Microcontroller (8 pin)|ไมโครคอนโทรลเลอร์ 8 ขา|Generic unverified 8-pin MCU symbol|สัญลักษณ์ทั่วไป ขาไม่อ้างอิงรุ่น|VCC,GND,IO0,IO1,IO2,IO3,RESET,CLK
microcontroller16|Microcontroller (16 pin)|ไมโครคอนโทรลเลอร์ 16 ขา|Generic unverified 16-pin MCU symbol|สัญลักษณ์ทั่วไป ขาไม่อ้างอิงรุ่น|VCC,GND,IO0,IO1,IO2,IO3,IO4,IO5,IO6,IO7,RESET,CLK,TX,RX,SDA,SCL
eeprom|EEPROM Memory (8 pin)|อีอีพรอม|Generic EEPROM symbol|หน่วยความจำถาวร|VCC,GND,SDA,SCL,A0,A1,A2,WP
sram|SRAM Memory (8 pin)|เอสแรม|Generic SRAM simplified symbol|หน่วยความจำ SRAM แบบย่อ|VCC,GND,A0,A1,D0,D1,WE,OE
timer555|555 Timer (8 pin)|ไอซี 555|Functional pin names; symbol only|ไอซีตั้งเวลา 555|GND,TRIG,OUT,RESET,CTRL,THR,DISCH,VCC
clock_ic|Clock Generator (8 pin)|ไอซีกำเนิดสัญญาณนาฬิกา|Generic clock generator|ไอซีกำเนิดสัญญาณนาฬิกา|VCC,GND,CLKOUT,ENABLE,FREQ,REF,P1,P2
`);
group('power','battery','BT',`
battery|Battery Cell|แบตเตอรี่|Single cell supply|เซลล์แบตเตอรี่
battery_pack|Battery Pack|ชุดแบตเตอรี่|Multi-cell battery symbol|ชุดแบตเตอรี่หลายเซลล์
solar_cell|Solar Cell|เซลล์แสงอาทิตย์|Photovoltaic cell symbol|แผงโซลาร์เซลล์
`,['-','+']);
group('power','source','V',`
ac_source|AC Voltage Source (symbol)|แหล่งจ่าย AC|Schematic only; not yet a SPICE AC source|แหล่งจ่ายไฟสลับยังไม่จำลอง
current_source|Current Source (symbol)|แหล่งจ่ายกระแส|Schematic only; no SPICE current source yet|แหล่งจ่ายกระแสยังไม่จำลอง
`,['-','+']);
group('switches','switch','SW',`
switch_spst|SPST Switch|สวิตช์ SPST|Single-pole single-throw|สวิตช์หนึ่งทาง
pushbutton|Push Button NO|ปุ่มกดปกติเปิด|Momentary push button|ปุ่มกดชั่วขณะ
pushbutton_nc|Push Button NC|ปุ่มกดปกติปิด|Normally closed button|ปุ่มกดปกติปิด
reed_switch|Reed Switch|รีดสวิตช์|Magnetically operated switch|สวิตช์แม่เหล็ก
dip_switch|DIP Switch (1 pole)|ดิปสวิตช์|Single DIP-switch pole|สวิตช์ DIP
`);
group('switches','spdt','SW',`
switch_spdt|SPDT Switch|สวิตช์ SPDT|Single pole double throw|สวิตช์สองทาง
`);
group('switches','relay','K',`
relay_spdt|SPDT Relay|รีเลย์ SPDT|Coil with changeover contacts|รีเลย์ที่มีคอยล์และหน้าสัมผัส
solid_state_relay|Solid State Relay (5-pin symbol)|โซลิดสเตตรีเลย์|Generic five terminal SSR symbol|สัญลักษณ์ SSR ห้าขา
`);
group('connectors','connector','J',`
header2|2-pin Header|ขั้วต่อ 2 ขา|Generic two-pin connector|ขั้วต่อสองขา|1,2
header3|3-pin Header|ขั้วต่อ 3 ขา|Generic three-pin connector|ขั้วต่อสามขา|1,2,3
header4|4-pin Header|ขั้วต่อ 4 ขา|Generic four-pin connector|ขั้วต่อสี่ขา|1,2,3,4
header6|6-pin Header|ขั้วต่อ 6 ขา|Generic six-pin connector|ขั้วต่อหกขา|1,2,3,4,5,6
header8|8-pin Header|ขั้วต่อ 8 ขา|Generic eight-pin connector|ขั้วต่อแปดขา|1,2,3,4,5,6,7,8
header16|16-pin Header|ขั้วต่อ 16 ขา|Generic 16-pin connector|ขั้วต่อสิบหกขา|1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16
terminal2|Screw Terminal (2-pin)|ขั้วต่อสกรู 2 ขา|Two terminal screw block|เทอร์มินัลสกรูสองขา|1,2
usb_connector|USB Connector (simplified)|ขั้วต่อ USB|Simplified generic USB symbol; not a footprint|สัญลักษณ์ USB แบบย่อ|VBUS,D-,D+,GND
rj45_connector|RJ45 Connector (8-pin)|ขั้วต่อ RJ45|Generic Ethernet port symbol|สัญลักษณ์ RJ45|1,2,3,4,5,6,7,8
jack_audio|Audio Jack (3-pin)|แจ็กเสียง|Audio plug with tip/ring/sleeve|ขั้วต่อสัญญาณเสียง|TIP,RING,SLEEVE
`);
group('sensors','sensor','S',`
temp_sensor|Temperature Sensor|เซนเซอร์อุณหภูมิ|Generic digital temperature sensor|เซนเซอร์วัดอุณหภูมิ|VCC,GND,OUT
light_sensor|Light Sensor|เซนเซอร์วัดแสง|Generic light sensor|เซนเซอร์วัดความสว่าง|VCC,GND,OUT
humidity_sensor|Humidity Sensor|เซนเซอร์ความชื้น|Generic humidity sensor|เซนเซอร์วัดความชื้น|VCC,GND,DATA
pressure_sensor|Pressure Sensor|เซนเซอร์ความดัน|Generic pressure sensor|เซนเซอร์วัดความดัน|VCC,GND,OUT
hall_sensor|Hall Effect Sensor|เซนเซอร์ฮอลล์|Hall magnetic sensor|เซนเซอร์สนามแม่เหล็ก|VCC,GND,OUT
ultrasonic_sensor|Ultrasonic Sensor|เซนเซอร์อัลตราโซนิก|Generic trigger echo ultrasonic sensor|เซนเซอร์วัดระยะทาง|VCC,TRIG,ECHO,GND
accelerometer|Accelerometer|เซนเซอร์ความเร่ง|Generic I2C accelerometer|เซนเซอร์วัดความเร่ง|VCC,GND,SDA,SCL,INT
gas_sensor|Gas Sensor|เซนเซอร์แก๊ส|Generic gas sensor|เซนเซอร์ตรวจจับแก๊ส|VCC,GND,OUT
`);
group('displays','display','DIS',`
seven_segment|7-segment Display (generic)|จอ 7 เซกเมนต์|Generic 8-pin simplified display|จอแสดงผลตัวเลขแบบย่อ|A,B,C,D,E,F,G,DP
lcd1602|LCD 1602 (simplified)|จอ LCD 1602|Generic eight signal symbol; no real pinout|สัญลักษณ์ LCD แบบย่อ ไม่ใช่ขาจริง|VSS,VDD,RS,RW,E,D4,D5,D6
oled_i2c|I2C OLED Display|จอ OLED I2C|Four pin display connection|จอภาพ OLED แบบ I2C|VCC,GND,SDA,SCL
led_matrix|LED Matrix (8-pin representative)|LED เมทริกซ์|Simplified eight pin representative|สัญลักษณ์ LED เมทริกซ์แบบย่อ|R1,R2,R3,R4,C1,C2,C3,C4
`);
group('motors','motor','M',`
dc_motor|DC Motor|มอเตอร์ DC|Two terminal DC motor|มอเตอร์กระแสตรง
vibration_motor|Vibration Motor|มอเตอร์สั่น|Vibration motor|มอเตอร์สร้างแรงสั่น
`);
group('motors','chip','M',`
stepper_motor|Stepper Motor (4-wire)|สเต็ปเปอร์มอเตอร์|Simplified bipolar stepper terminals|มอเตอร์สเต็ปเปอร์แบบย่อ|A+,A-,B+,B-
servo_motor|Servo Motor (3-wire)|เซอร์โวมอเตอร์|Power ground signal servo|มอเตอร์เซอร์โว|VCC,GND,SIG
`);
group('motors','speaker','SP',`
speaker|Loudspeaker|ลำโพง|Loudspeaker load|ลำโพง
buzzer|Buzzer|บัซเซอร์|Audible buzzer|อุปกรณ์เสียงเตือน
microphone|Microphone|ไมโครโฟน|Microphone input symbol|ไมโครโฟน
`);
group('timing','crystal','Y',`
crystal|Quartz Crystal|คริสตัลควอตซ์|Quartz resonator|อุปกรณ์กำหนดความถี่
ceramic_resonator|Ceramic Resonator|เซรามิกเรโซเนเตอร์|Ceramic timing resonator|ตัวกำหนดความถี่เซรามิก
`);
group('timing','antenna','ANT',`
antenna|Antenna|เสาอากาศ|Antenna symbol|เสาอากาศ
`);
group('timing','chip','U',`
rf_transceiver|RF Transceiver (8-pin generic)|ไอซีรับส่ง RF|Generic radio block, pinout not verified|ไอซีรับส่งสัญญาณวิทยุ|VCC,GND,TX,RX,ANT,EN,SCLK,CS
`);
group('protection','fuse','F',`
fuse|Fuse|ฟิวส์|Overcurrent safety fuse|ฟิวส์ป้องกันกระแสเกิน
resettable_fuse|Resettable Fuse PTC|ฟิวส์รีเซ็ตได้|Resettable polymer PTC fuse|ฟิวส์ชนิดคืนสภาพ
`);
group('protection','resistor','RV',`
varistor|MOV / Varistor|วาริสเตอร์|Transient voltage clamp element|ตัวต้านทานป้องกันแรงดันกระชาก
`);
group('opto','optocoupler','U',`
optocoupler|Optocoupler (4 pin)|ออปโตคัปเปลอร์|Optically isolated input/output|วงจรแยกสัญญาณด้วยแสง
`);
group('opto','lamp','LMP',`
incandescent_lamp|Lamp|หลอดไฟ|Filament lamp symbol|หลอดไฟ
neon_lamp|Neon Lamp|หลอดนีออน|Indicator lamp symbol|หลอดแสดงสถานะ
`);
group('opto','display','U',`
seven_segment_driver|7-Segment Decoder / Driver|ไอซีขับจอ 7 เซกเมนต์|Generic display driver symbol|วงจรขับจอ|A,B,C,D,OE,OUT1,OUT2,OUT3
`);
group('power','transformer','T',`
transformer|Transformer|หม้อแปลงไฟฟ้า|Two winding transformer symbol|หม้อแปลงสองขดลวด
`);

export const PART_LIBRARY: readonly LibraryPart[] = Object.freeze(parts);
export const PART_BY_ID: ReadonlyMap<string,LibraryPart> = new Map(parts.map((part)=>[part.id,part]));
export function findLibraryPart(id:string): LibraryPart|undefined {return PART_BY_ID.get(id);}
export function searchLibrary(query:string, category='all'): LibraryPart[] {
  const words=query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return PART_LIBRARY.filter((part)=>(category==='all'||part.category===category) &&
    words.every((term)=>[part.name,part.nameTh,part.id,part.category,part.refPrefix,
      part.description,part.descriptionTh,...part.pins.map((pin)=>pin.name)]
      .some((text)=>text.toLocaleLowerCase().includes(term))));
}
