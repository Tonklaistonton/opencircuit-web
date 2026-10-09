import {invoke, isTauri} from '@tauri-apps/api/core';
import {open, save} from '@tauri-apps/plugin-dialog';

export const desktop = isTauri();
export type OpenedProject = {contents: string; path: string};
const filters = [{name: 'OpenCircuit projects', extensions: ['json', 'ocircuit']}];

export async function openNativeProject(): Promise<OpenedProject | null> {
  const path = await open({filters, multiple: false});
  return path ? invoke<OpenedProject>('open_project', {path}) : null;
}

export async function saveNativeProject(contents: string, currentPath: string | null, as = false): Promise<string | null> {
  const path = !as && currentPath ? currentPath : await save({filters, defaultPath: currentPath ?? 'circuit.ocircuit'});
  if (!path) return null;
  return invoke<string>(as ? 'save_project_as' : 'save_project', {path, contents});
}

export async function exportNativeNetlist(netlist: string): Promise<boolean> {
  const path = await save({filters: [{name: 'SPICE netlist', extensions: ['cir']}], defaultPath: 'circuit.cir'});
  if (!path) return false;
  await invoke('export_netlist', {path, netlist});
  return true;
}
