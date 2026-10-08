import {createComponent} from './model.ts';
import type {Project} from './model.ts';

// Editable, electrically connected demonstration of a non-inverting amplifier.
// This example uses the built-in Generic Op-Amp approximation, NOT a verified uA741 model.
export function opAmpExampleProject(): Project {
  const components = [
    createComponent('O', 'U1'),
    createComponent('V', 'V1'), createComponent('V', 'V2'), createComponent('V', 'V3'),
    createComponent('R', 'R1'), createComponent('R', 'R2'), createComponent('R', 'R3'),
    createComponent('G', 'G1'), createComponent('G', 'G2'),
  ];
  for (const c of components) {
    if (c.id === 'V1') c.value = '1V';
    if (c.id === 'V2') c.value = '15V';
    if (c.id === 'V3') c.value = '15V';
    if (c.id === 'R2') c.value = '2kΩ';
    if (c.id === 'R3') c.value = '1kΩ';
  }
  return {
    version: 2,
    components,
    junctions: {J1: {x: 420, y: 220}},
    netAliases: {'U1:3': 'VCC', 'V2:1': 'VCC', 'U1:4': 'VEE', 'V3:0': 'VEE', 'U1:2': 'VOUT'},
    schematic: {
      U1: {x: 500, y: 240, rotation: 0},
      V1: {x: 170, y: 260, rotation: 0},
      V2: {x: 730, y: 200, rotation: 0},
      V3: {x: 730, y: 300, rotation: 0},
      R1: {x: 330, y: 260, rotation: 0},
      R2: {x: 500, y: 390, rotation: 0},
      R3: {x: 320, y: 160, rotation: 0},
      G1: {x: 130, y: 400, rotation: 0},
      G2: {x: 730, y: 410, rotation: 0},
    },
    wires: [
      {id: 'w1', from: 'V1:1', to: 'R1:0'},
      {id: 'w2', from: 'R1:1', to: 'U1:1'},
      {id: 'w3', from: 'V1:0', to: 'G1:0', bends: [{x: 130, y: 370}]},
      {id: 'w4', from: 'U1:0', to: 'J1'},
      {id: 'w5', from: 'J1', to: 'R3:1', bends: [{x: 420, y: 160}]},
      {id: 'w6', from: 'J1', to: 'R2:0', bends: [{x: 420, y: 390}]},
      {id: 'w7', from: 'R3:0', to: 'G1:0', bends: [{x: 150, y: 160}, {x: 150, y: 370}]},
      {id: 'w8', from: 'U1:2', to: 'R2:1', bends: [{x: 620, y: 240}, {x: 620, y: 390}]},
      {id: 'w9', from: 'V2:0', to: 'G2:0', bends: [{x: 670, y: 200}, {x: 670, y: 380}]},
      {id: 'w10', from: 'V3:1', to: 'G2:0', bends: [{x: 810, y: 300}, {x: 810, y: 380}]},
    ],
  };
}
