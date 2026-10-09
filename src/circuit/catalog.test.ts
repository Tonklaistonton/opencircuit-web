import {strict as assert} from 'node:assert';
import test from 'node:test';
import {LIBRARY_CATEGORIES, PART_LIBRARY, findLibraryPart, searchLibrary} from './catalog.ts';
import {createComponent, parseProject, pinPosition} from './model.ts';
import {analyzeCircuit, extractNets} from './engine.ts';
import type {Project} from './model.ts';

test('Library has 100+ distinct schematic components across diverse categories',()=>{
  assert.ok(PART_LIBRARY.length >= 100);
  assert.ok(LIBRARY_CATEGORIES.length >= 12);
  const categories=new Set(LIBRARY_CATEGORIES.map((category)=>category.id));
  const seen=new Set<string>();
  for(const part of PART_LIBRARY){
    assert.ok(!seen.has(part.id),'duplicate: '+part.id);
    seen.add(part.id);
    assert.ok(categories.has(part.category),part.id+' has invalid category');
    assert.ok(part.pins.length>0 && part.pins.length<=32);
    assert.ok(part.pins.every((pin)=>pin.name.length>0 && Number.isFinite(pin.x)&&Number.isFinite(pin.y)));
    assert.ok(part.refPrefix.match(/^[A-Za-z]{1,4}$/));
    assert.ok(part.name&&part.nameTh&&part.description&&part.descriptionTh);
    assert.equal(findLibraryPart(part.id)?.id,part.id);
  }
});

test('Thai/English names and filtering discover components without needing part IDs',()=>{
  assert.ok(searchLibrary('MOSFET').some((part)=>part.id==='nmos'));
  assert.ok(searchLibrary('มอสเฟต').some((part)=>part.id==='pmos'));
  assert.ok(searchLibrary('LED').some((part)=>part.id==='led'));
  assert.ok(searchLibrary('ตัวต้านทาน').some((part)=>part.id==='resistor'));
  assert.ok(searchLibrary('resistor','passives').every((part)=>part.category==='passives'));
  assert.ok(searchLibrary('led','connectors').length===0);
  assert.equal(searchLibrary('').length,PART_LIBRARY.length);
  assert.equal(searchLibrary('unlikely_unknown_xyz').length,0);
});

test('Every generic library part round-trips JSON with exact stable pins and catalog reference',()=>{
  for(const part of PART_LIBRARY.filter((part)=>part.kind==='P')){
    const component=createComponent('P',part.refPrefix+'1',part.id);
    assert.equal(component.value,part.defaultValue);
    assert.equal(component.partId,part.id);
    assert.equal(component.pins.length,part.pins.length);
    const project:Project={version:2,components:[component],wires:[],
      schematic:{[component.id]:{x:100,y:100,rotation:0}}};
    const parsed=parseProject(JSON.stringify(project));
    assert.deepEqual(parsed.components,[component]);
    assert.deepEqual(parsed.schematic[component.id],project.schematic[component.id]);
    part.pins.forEach((pin,i)=>{
      assert.deepEqual(pinPosition(component,project.schematic[component.id],component.pins[i]),
        {x:100+pin.x,y:100+pin.y});
    });
  }
});

test('Schematic library device can rotate and connect electrically but cannot fake SPICE',()=>{
  const mosfet=createComponent('P','Q1','nmos');
  const resistor=createComponent('R','R1');
  const ground=createComponent('G','G1');
  assert.deepEqual(pinPosition(mosfet,{x:100,y:100,rotation:90},'Q1:0'),
    {x:100,y:40}); // gate (-60,0) rotated 90 degrees
  const schematic={Q1:{x:100,y:100,rotation:0 as const},R1:{x:300,y:100,rotation:0 as const},
    G1:{x:300,y:300,rotation:0 as const}};
  const project:Project={version:2,components:[mosfet,resistor,ground],schematic,
    wires:[{id:'w1',from:'Q1:1',to:'R1:0'},{id:'w2',from:'R1:1',to:'G1:0'}]};
  const net=extractNets(project);
  assert.equal(net.nodeByPin.get('Q1:1'),net.nodeByPin.get('R1:0'));
  const result=analyzeCircuit(project);
  assert.equal(result.netlist,null);
  assert.ok(result.issues.some((issue)=>issue.severity==='error'&&
    issue.message.includes('schematic-only')&&issue.message.includes('Q1')));
});

test('Importer rejects malicious or unknown catalog references and forged pins',()=>{
  assert.throws(()=>createComponent('P','X1','unknown_fake'));
  const diode=createComponent('P','D1','rectifier_diode');
  const project:Project={version:2,components:[diode],wires:[],
    schematic:{D1:{x:100,y:100,rotation:0}}};
  assert.throws(()=>parseProject(JSON.stringify({...project,components:[{...diode,partId:'evil'}]})));
  assert.throws(()=>parseProject(JSON.stringify({...project,components:[{...diode,pins:['D1:0','D1:999']}]})));
  assert.throws(()=>parseProject(JSON.stringify({...project,components:[{...diode,partId:undefined}]})));
});

test('Original supported R/C/L/V/G and Generic Op-Amp remain recognized and sim-enabled',()=>{
  assert.deepEqual(PART_LIBRARY.filter((part)=>part.simulation==='dc').map((part)=>part.kind).sort(),
    ['C','G','L','O','R','V'].sort());
  const source=createComponent('V','V1');
  const r=createComponent('R','R1');
  const g=createComponent('G','G1');
  const circuit:Project={version:2,components:[source,r,g],
    wires:[{id:'w1',from:'V1:1',to:'R1:0'},{id:'w2',from:'R1:1',to:'G1:0'},
      {id:'w3',from:'V1:0',to:'G1:0'}],
    schematic:{V1:{x:100,y:100,rotation:0},R1:{x:300,y:100,rotation:0},G1:{x:300,y:300,rotation:0}}};
  assert.ok(analyzeCircuit(circuit).netlist?.includes('R1 n1 0 1000'));
});
