import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArchilang } from '../parser.js';
import { resolve } from '../resolver.js';
import { loadCostMaster } from '../laporta/cost-master.js';
import { emitEstimate } from '../laporta/estimate-emitter.js';

// Minimal YAML helpers for opening-deduction unit tests
const MINIMAL_HEADER = `
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
      y_spans: [3, 3]
  rooms:
    - id: ldk
      floor: 1F
      type: LDK
      grid_rect: { x: 0, y: 0, w: 6, h: 6 }
`;

async function buildEstimateFromYaml(yaml: string) {
  const spec = parseArchilang(yaml);
  const model = Object.assign(resolve(spec), { archilangVersion: spec.archilang });
  const db = await loadCostMaster();
  return emitEstimate(model, db);
}

const samplesDir = pathResolve(import.meta.dirname, '../../samples');
const samplePath = `${samplesDir}/laporta-30sqm-renovation.yaml`;

async function buildEstimate() {
  const yaml = readFileSync(samplePath, 'utf-8');
  const spec = parseArchilang(yaml);
  const model = Object.assign(resolve(spec), { archilangVersion: spec.archilang });
  const db = await loadCostMaster();
  return emitEstimate(model, db);
}

describe('emitEstimate', () => {
  it('generates estimate lines from the laporta sample', async () => {
    const estimate = await buildEstimate();

    expect(estimate.lines.length).toBeGreaterThanOrEqual(5);
    expect(estimate.subtotal).toBeGreaterThan(0);
    expect(estimate.archilangVersion).toBe('0.2');
  });

  it('calculates tax at 10 percent of subtotal', async () => {
    const estimate = await buildEstimate();

    expect(estimate.tax).toBe(estimate.subtotal * 0.1);
    expect(estimate.total).toBe(estimate.subtotal + estimate.tax);
  });

  it('includes room and opening derived lines', async () => {
    const estimate = await buildEstimate();
    const sources = new Set(estimate.lines.map(line => line.source));

    expect(sources.has('room')).toBe(true);
    expect(sources.has('opening')).toBe(true);
    expect(estimate.lines.some(line => line.code === 'IN-001')).toBe(true);
    expect(estimate.lines.some(line => line.code === 'FX-016')).toBe(true);
  });
});

describe('emitEstimate: opening deduction', () => {
  it('壁仕上げ qty が開口部面積分だけ減少し、注記が付く', async () => {
    // 1室 + 1窓 (1.86m²) → 壁仕上げ qty が控除される
    const yaml = MINIMAL_HEADER + `
  openings:
    - id: W1
      type: AW
      style: 引違い窓
      room: ldk
      wall: south
      position: center
      size: { w: 1690, h: 1100 }
      sill: 800
`;
    const withWindow = await buildEstimateFromYaml(yaml);
    const withoutWindow = await buildEstimateFromYaml(MINIMAL_HEADER + `
  openings: []
`);

    const wallLineWith = withWindow.lines.find(l => l.source === 'room' && l.name.includes('wall'));
    const wallLineWithout = withoutWindow.lines.find(l => l.source === 'room' && l.name.includes('wall'));

    expect(wallLineWith).toBeDefined();
    expect(wallLineWithout).toBeDefined();

    // 窓あり の qty < 窓なし の qty
    expect(wallLineWith!.qty).toBeLessThan(wallLineWithout!.qty);

    // 注記が含まれる
    expect(wallLineWith!.name).toContain('開口部');
    expect(wallLineWith!.name).toContain('m² 控除');

    // 窓なし の行には注記が無い
    expect(wallLineWithout!.name).not.toContain('控除');
  });

  it('0.5m² 未満の小窓は壁仕上げ qty を控除しない', async () => {
    // 小窓: 600×800 = 0.48m² < 0.5m² → 控除されない
    const yamlSmall = MINIMAL_HEADER + `
  openings:
    - id: SW1
      type: AW
      style: 引違い窓
      room: ldk
      wall: south
      position: center
      size: { w: 600, h: 800 }
      sill: 800
`;
    const withSmallWindow = await buildEstimateFromYaml(yamlSmall);
    const withoutWindow = await buildEstimateFromYaml(MINIMAL_HEADER + `
  openings: []
`);

    const wallLineSmall = withSmallWindow.lines.find(l => l.source === 'room' && l.name.includes('wall'));
    const wallLineNone = withoutWindow.lines.find(l => l.source === 'room' && l.name.includes('wall'));

    expect(wallLineSmall).toBeDefined();
    expect(wallLineNone).toBeDefined();

    // 小窓は控除されないので qty が同じ
    expect(wallLineSmall!.qty).toBe(wallLineNone!.qty);

    // 注記も付かない
    expect(wallLineSmall!.name).not.toContain('控除');
  });
});
