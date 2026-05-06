import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArchilang } from '../parser.js';
import { resolve } from '../resolver.js';
import { loadCostMaster } from '../laporta/cost-master.js';
import { emitEstimate } from '../laporta/estimate-emitter.js';

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
