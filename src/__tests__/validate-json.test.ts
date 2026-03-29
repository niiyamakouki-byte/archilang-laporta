import { describe, it, expect } from 'vitest';
import { resolve } from '../resolver.js';
import { parseArchilang } from '../parser.js';
import { validateBuilding } from '../validator.js';
import { toValidationJson, getFixHint } from '../fix-hints.js';
import { readFileSync } from 'fs';
import { resolve as pathResolve } from 'path';

const samplesDir = pathResolve(import.meta.dirname, '../../samples');

function loadAndValidate(name: string) {
  const yaml = readFileSync(`${samplesDir}/${name}.yaml`, 'utf-8');
  const spec = parseArchilang(yaml);
  const model = resolve(spec);
  const result = validateBuilding(model);
  return { model, result };
}

describe('toValidationJson', () => {
  it('produces valid JSON structure for clean sample', () => {
    const { model, result } = loadAndValidate('basic-3room');
    const json = toValidationJson(result, model);

    expect(json.ok).toBe(true);
    expect(json.errorCount).toBe(0);
    expect(json.issues).toBeInstanceOf(Array);
  });

  it('includes fix_hint and auto_fixable for each issue', () => {
    const { model, result } = loadAndValidate('custom-walls-invalid');
    const json = toValidationJson(result, model);

    expect(json.ok).toBe(false);
    expect(json.issues.length).toBeGreaterThan(0);

    for (const issue of json.issues) {
      expect(issue).toHaveProperty('fix_hint');
      expect(issue).toHaveProperty('auto_fixable');
      expect(typeof issue.fix_hint).toBe('string');
      expect(typeof issue.auto_fixable).toBe('boolean');
      expect(issue.fix_hint.length).toBeGreaterThan(0);
    }
  });

  it('marks GRID_MISALIGNMENT as auto_fixable', () => {
    const { model, result } = loadAndValidate('custom-walls-invalid');
    const json = toValidationJson(result, model);

    const gridIssue = json.issues.find(i => i.code === 'GRID_MISALIGNMENT');
    expect(gridIssue).toBeDefined();
    expect(gridIssue!.auto_fixable).toBe(true);
    expect(gridIssue!.fix_hint).toContain('Snap');
  });

  it('marks UNREACHABLE_ROOM as not auto_fixable', () => {
    const { model, result } = loadAndValidate('custom-walls-invalid');
    const json = toValidationJson(result, model);

    const unreachable = json.issues.find(i => i.code === 'UNREACHABLE_ROOM');
    expect(unreachable).toBeDefined();
    expect(unreachable!.auto_fixable).toBe(false);
  });

  it('preserves optional fields (roomIds, wallId, openingId)', () => {
    const { model, result } = loadAndValidate('custom-walls-invalid');
    const json = toValidationJson(result, model);

    const gridIssue = json.issues.find(i => i.code === 'GRID_MISALIGNMENT');
    expect(gridIssue!.wallId).toBe('w_custom_ext');

    const unreachable = json.issues.find(i => i.code === 'UNREACHABLE_ROOM');
    expect(unreachable!.roomIds).toContain('living');
  });
});

describe('getFixHint', () => {
  it('generates ROOM_WITHOUT_DOOR hint with neighbor info', () => {
    const yaml = `
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
    const spec = parseArchilang(yaml);
    const model = resolve(spec);
    const result = validateBuilding(model);

    const noDoorsA = result.issues.find(i => i.code === 'ROOM_WITHOUT_DOOR' && i.roomIds?.includes('roomA'));
    expect(noDoorsA).toBeDefined();

    const { hint, autoFixable } = getFixHint(noDoorsA!, model);
    expect(hint).toContain('roomA');
    expect(hint).toContain('roomB');
    expect(autoFixable).toBe(true);
  });
});
