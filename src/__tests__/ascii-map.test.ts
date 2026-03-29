import { describe, it, expect } from 'vitest';
import { resolve } from '../resolver.js';
import { parseArchilang } from '../parser.js';
import { buildInspectionReport } from '../inspect.js';
import { renderAsciiMap } from '../ascii-map.js';
import { readFileSync } from 'fs';
import { resolve as pathResolve } from 'path';

const samplesDir = pathResolve(import.meta.dirname, '../../samples');

function loadAsciiMap(name: string): string {
  const yaml = readFileSync(`${samplesDir}/${name}.yaml`, 'utf-8');
  const model = resolve(parseArchilang(yaml));
  const report = buildInspectionReport(model);
  return renderAsciiMap(report);
}

describe('renderAsciiMap', () => {
  it('produces non-empty output', () => {
    const map = loadAsciiMap('basic-3room');
    expect(map.length).toBeGreaterThan(0);
  });

  it('contains room labels', () => {
    const map = loadAsciiMap('basic-3room');
    expect(map).toContain('ldk');
    expect(map).toContain('bedr'); // bedroom shortened
    expect(map).toContain('bath'); // bath_area shortened
  });

  it('contains grid coordinate labels', () => {
    const map = loadAsciiMap('basic-3room');
    // X axis header
    expect(map).toContain('0');
    expect(map).toContain('7');
    // Y axis labels
    expect(map).toContain(' 0 ');
    expect(map).toContain(' 6 ');
  });

  it('shows wall boundaries with | and +', () => {
    const map = loadAsciiMap('basic-3room');
    expect(map).toContain('|');
    expect(map).toContain('+');
  });

  it('handles L-shaped plans with empty areas', () => {
    const map = loadAsciiMap('l-shaped-plan');
    // L-shaped should have rooms in some cells and empty space in others
    expect(map).toContain('ldk');
    expect(map).toContain('bedr');
    // Upper-right should be empty (no room there)
    const lines = map.split('\n');
    const topDataLine = lines.find(l => l.includes(' 8 '));
    expect(topDataLine).toBeDefined();
    // stud should be in left part, right part should be blank
    expect(topDataLine).toContain('stud');
  });
});
