import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { resolve as pathResolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArchilang } from '../parser.js';
import { resolve } from '../resolver.js';
import { emitVwPython } from '../laporta/vw-marionette-emitter.js';

const samplesDir = pathResolve(import.meta.dirname, '../../samples');
const samplePath = `${samplesDir}/laporta-30sqm-renovation.yaml`;

function buildScript() {
  const yaml = readFileSync(samplePath, 'utf-8');
  const spec = parseArchilang(yaml);
  const model = Object.assign(resolve(spec), { archilangVersion: spec.archilang });
  return emitVwPython(model);
}

describe('emitVwPython', () => {
  it('generates a Vectorworks Python script from the laporta sample', () => {
    const script = buildScript();

    expect(script.pythonCode).toContain('import vs');
    expect(script.pythonCode).toContain("vs.Layer(\"平面-1F\")");
    expect(script.meta.wallCount).toBeGreaterThan(0);
    expect(script.meta.doorCount + script.meta.windowCount).toBeGreaterThan(0);
  });

  it('produces UTF-8 safe output', () => {
    const script = buildScript();
    const roundTrip = Buffer.from(script.pythonCode, 'utf8').toString('utf8');

    expect(roundTrip).toBe(script.pythonCode);
  });
});
