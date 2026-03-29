import { describe, it, expect } from 'vitest';
import { parseArchilang } from '../parser.js';
import { resolve } from '../resolver.js';
import { validateBuilding } from '../validator.js';
import { fixGridMisalignment, fixRoomWithoutDoor, applyAutoFixes } from '../auto-fix.js';
import { runSolveLoop } from '../solve.js';
import { readFileSync } from 'fs';
import { resolve as pathResolve } from 'path';

const samplesDir = pathResolve(import.meta.dirname, '../../samples');

const GRID_MISALIGN_YAML = `
archilang: "0.2"
site:
  orientation: south
building:
  structure: 木造軸組
  module: shaku
  stories: 1
  defaults:
    ceiling_height: 2400mm
    external_wall:
      thickness: 130mm
    internal_wall:
      partition: 90mm
geometry:
  grids:
    module: 910mm
    1F:
      x_spans: [4]
      y_spans: [4]
  rooms:
    - id: room1
      floor: 1F
      type: Room
      grid_rect: { x: 0, y: 0, w: 4, h: 4 }
  walls:
    segments:
      - id: w_offgrid
        floor: 1F
        from: { x: 2500, y: 0 }
        to: { x: 2500, y: 3640 }
        type: internal
  openings: []
`;

const NO_DOOR_YAML = `
archilang: "0.2"
site:
  orientation: south
building:
  structure: 木造軸組
  module: shaku
  stories: 1
  defaults:
    ceiling_height: 2400mm
    external_wall:
      thickness: 130mm
    internal_wall:
      partition: 90mm
geometry:
  grids:
    module: 910mm
    1F:
      x_spans: [3, 3]
      y_spans: [3]
  rooms:
    - id: roomA
      floor: 1F
      type: Room A
      grid_rect: { x: 0, y: 0, w: 3, h: 3 }
    - id: roomB
      floor: 1F
      type: Room B
      grid_rect: { x: 3, y: 0, w: 3, h: 3 }
  openings: []
`;

describe('fixGridMisalignment', () => {
  it('snaps off-grid wall coordinates to nearest grid', () => {
    const spec = parseArchilang(GRID_MISALIGN_YAML);
    const model = resolve(spec);
    const result = validateBuilding(model);
    const gridIssue = result.issues.find(i => i.code === 'GRID_MISALIGNMENT')!;
    expect(gridIssue).toBeDefined();

    const { yamlText, fix } = fixGridMisalignment(GRID_MISALIGN_YAML, gridIssue, model);
    expect(fix.applied).toBe(true);
    expect(fix.description).toContain('2500');
    expect(fix.description).toContain('2730');
    expect(yamlText).toContain('2730');
    expect(yamlText).not.toContain('x: 2500');
  });
});

describe('fixRoomWithoutDoor', () => {
  it('adds a door connecting rooms without doors', () => {
    const spec = parseArchilang(NO_DOOR_YAML);
    const model = resolve(spec);
    const result = validateBuilding(model);
    const noDoor = result.issues.find(i => i.code === 'ROOM_WITHOUT_DOOR')!;
    expect(noDoor).toBeDefined();

    const { yamlText, fix } = fixRoomWithoutDoor(NO_DOOR_YAML, noDoor, model);
    expect(fix.applied).toBe(true);
    expect(yamlText).toContain('D_auto_');
    expect(yamlText).toContain('connects:');
  });
});

describe('runSolveLoop', () => {
  it('fixes GRID_MISALIGNMENT in solve loop', () => {
    const result = runSolveLoop(GRID_MISALIGN_YAML, { maxIterations: 3, dryRun: false });
    expect(result.fixes.some(f => f.applied && f.code === 'GRID_MISALIGNMENT')).toBe(true);
    // After fix, the GRID_MISALIGNMENT should be gone
    expect(result.finalYaml).toContain('2730');
  });

  it('dry-run does not modify YAML', () => {
    const result = runSolveLoop(GRID_MISALIGN_YAML, { maxIterations: 3, dryRun: true });
    expect(result.finalYaml).toBe(GRID_MISALIGN_YAML);
  });

  it('adds doors in solve loop', () => {
    const result = runSolveLoop(NO_DOOR_YAML, { maxIterations: 3, dryRun: false });
    expect(result.fixes.some(f => f.applied && f.code === 'ROOM_WITHOUT_DOOR')).toBe(true);
    expect(result.finalYaml).toContain('D_auto_');
  });
});
