import { describe, it, expect } from 'vitest';
import { resolve } from '../resolver.js';
import { parseArchilang } from '../parser.js';
import { buildInspectionReport } from '../inspect.js';
import { readFileSync } from 'fs';
import { resolve as pathResolve } from 'path';

const samplesDir = pathResolve(import.meta.dirname, '../../samples');

function loadAndInspect(name: string) {
  const yaml = readFileSync(`${samplesDir}/${name}.yaml`, 'utf-8');
  const model = resolve(parseArchilang(yaml));
  return buildInspectionReport(model);
}

describe('buildInspectionReport', () => {
  it('returns grid info', () => {
    const report = loadAndInspect('basic-3room');
    expect(report.grid.moduleSize).toBe(910);
    expect(report.grid.totalX).toBe(8);
    expect(report.grid.totalY).toBe(7);
  });

  it('returns rooms with area and neighbors', () => {
    const report = loadAndInspect('basic-3room');
    const ldk = report.rooms.find(r => r.id === 'ldk')!;
    expect(ldk).toBeDefined();
    expect(ldk.area_m2).toBeGreaterThan(0);
    expect(ldk.tatami).toBeGreaterThan(0);
    expect(ldk.neighbors).toContain('bedroom');
    expect(ldk.neighbors).toContain('bath_area');
  });

  it('builds adjacency graph from door connections', () => {
    const report = loadAndInspect('basic-3room');
    expect(report.adjacency['ldk']).toContain('bedroom');
    expect(report.adjacency['bedroom']).toContain('ldk');
  });

  it('populates occupancy grid correctly', () => {
    const report = loadAndInspect('basic-3room');
    // basic-3room: ldk at (3,0,5,7), bedroom at (0,3,3,4), bath_area at (0,0,3,3)
    expect(report.occupancyGrid[0][0]).toBe('bath_area');
    expect(report.occupancyGrid[0][3]).toBe('ldk');
    expect(report.occupancyGrid[3][0]).toBe('bedroom');
    expect(report.occupancyGrid[6][4]).toBe('ldk');
  });

  it('leaves empty cells for unused grid positions', () => {
    const report = loadAndInspect('l-shaped-plan');
    // L-shaped plan should have empty cells in the concave area
    const hasEmpty = report.occupancyGrid.some(row => row.some(cell => cell === ''));
    expect(hasEmpty).toBe(true);
  });

  it('includes wall and opening info', () => {
    const report = loadAndInspect('basic-3room');
    expect(report.walls.length).toBeGreaterThan(0);
    expect(report.openings.length).toBeGreaterThan(0);
    expect(report.openings[0]).toHaveProperty('id');
    expect(report.openings[0]).toHaveProperty('wallId');
  });
});
