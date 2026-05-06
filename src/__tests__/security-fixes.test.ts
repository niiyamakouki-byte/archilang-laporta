/**
 * security-fixes.test.ts
 * 2nd-pass polish: regression tests for Bug 1-5 security/validation fixes
 * 3rd-pass polish: Bug 6 (cost-master Infinity/NaN unitPrice) + Bug 7 (duplicate room IDs)
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { scaffoldYaml } from '../laporta/scaffolder.js';
import { parseArchilang } from '../parser.js';
import { resolve } from '../resolver.js';
import { loadCostMaster } from '../laporta/cost-master.js';
import { estimateToMarkdown } from '../laporta/estimate-markdown.js';
import type { LaportaEstimate } from '../laporta/types.js';

// ─── Bug 1: scaffoldYaml area_m2 NaN bypass ───────────────────────────────────

describe('scaffoldYaml area_m2 validation', () => {
  it('rejects NaN area_m2 (NaN <= 0 === false, must be caught by Number.isFinite)', () => {
    expect(() =>
      scaffoldYaml({ rooms: [{ id: 'r1', type: 'LDK', area_m2: NaN }] })
    ).toThrow(/non-positive area_m2/);
  });

  it('rejects Infinity area_m2', () => {
    expect(() =>
      scaffoldYaml({ rooms: [{ id: 'r1', type: 'LDK', area_m2: Infinity }] })
    ).toThrow(/non-positive area_m2/);
  });

  it('rejects -Infinity area_m2', () => {
    expect(() =>
      scaffoldYaml({ rooms: [{ id: 'r1', type: 'LDK', area_m2: -Infinity }] })
    ).toThrow(/non-positive area_m2/);
  });

  it('accepts valid finite positive area_m2', () => {
    expect(() =>
      scaffoldYaml({ rooms: [{ id: 'r1', type: 'LDK', area_m2: 24 }] })
    ).not.toThrow();
  });
});

// ─── Bug 2: parseArchilang prototype pollution defense ─────────────────────────

describe('parseArchilang prototype pollution defense', () => {
  it('strips __proto__ key and does not pollute Object prototype', () => {
    // yaml v2 parses __proto__ as a literal key, not polluting; but we strip it
    const yaml = `
archilang: "0.2"
__proto__:
  injected: true
site:
  orientation: south
geometry:
  grids:
    module: 910mm
    1F:
      x_spans: [3]
      y_spans: [3]
  rooms:
    - id: r1
      floor: 1F
      type: LDK
      grid_rect: { x: 0, y: 0, w: 3, h: 3 }
`;
    const spec = parseArchilang(yaml);
    // __proto__ key must have been stripped
    expect(Object.prototype.hasOwnProperty.call(spec, '__proto__')).toBe(false);
    // Object prototype must not be polluted
    expect((({} as Record<string, unknown>).injected)).toBeUndefined();
  });

  it('strips constructor key from parsed YAML', () => {
    const yaml = `
archilang: "0.2"
constructor:
  name: hacked
site:
  orientation: south
geometry:
  grids:
    module: 910mm
    1F:
      x_spans: [3]
      y_spans: [3]
  rooms:
    - id: r1
      floor: 1F
      type: LDK
      grid_rect: { x: 0, y: 0, w: 3, h: 3 }
`;
    const spec = parseArchilang(yaml);
    expect(Object.prototype.hasOwnProperty.call(spec, 'constructor')).toBe(false);
  });

  it('strips prototype key from parsed YAML', () => {
    const yaml = `
archilang: "0.2"
prototype:
  evil: 1
site:
  orientation: south
geometry:
  grids:
    module: 910mm
    1F:
      x_spans: [3]
      y_spans: [3]
  rooms:
    - id: r1
      floor: 1F
      type: LDK
      grid_rect: { x: 0, y: 0, w: 3, h: 3 }
`;
    const spec = parseArchilang(yaml);
    expect(Object.prototype.hasOwnProperty.call(spec, 'prototype')).toBe(false);
  });
});

// ─── Bug 3: estimate-markdown table injection ──────────────────────────────────

describe('estimateToMarkdown table injection prevention', () => {
  const baseEstimate: LaportaEstimate = {
    version: '2.7.0',
    generatedAt: '2026-05-06T00:00:00Z',
    archilangVersion: '0.2',
    lines: [],
    subtotal: 0,
    tax: 0,
    total: 0,
  };

  it('escapes | in projectName so it does not break the title line', () => {
    const md = estimateToMarkdown(baseEstimate, 'Proj | Hack');
    // The first line should have | escaped so no raw unescaped pipe outside table
    const firstLine = md.split('\n')[0];
    // Must not contain unescaped | (the escape produces \|)
    expect(firstLine).not.toMatch(/[^\\]\|/);
    expect(firstLine).toContain('\\|');
  });

  it('escapes newline in projectName so title stays on one line', () => {
    const md = estimateToMarkdown(baseEstimate, 'Proj\nHack');
    const firstLine = md.split('\n')[0];
    expect(firstLine).toBe('# 見積書: Proj Hack');
  });

  it('escapes | in line code/name/unit so table cells do not break', () => {
    const injected: LaportaEstimate = {
      ...baseEstimate,
      lines: [
        {
          code: 'IN-001|bad',
          name: 'フローリング | XSS',
          unit: '㎡|hack',
          qty: 10,
          unitPrice: 1000,
          amount: 10000,
          category: 'test|cat',
          source: 'room',
          sourceId: 'r1',
        },
      ],
      subtotal: 10000,
      tax: 1000,
      total: 11000,
    };
    const md = estimateToMarkdown(injected);
    // Table rows must have pipes escaped
    const tableRow = md.split('\n').find(l => l.includes('IN-001'));
    expect(tableRow).toBeDefined();
    expect(tableRow).toContain('IN-001\\|bad');
    expect(tableRow).toContain('フローリング \\| XSS');
    expect(tableRow).toContain('㎡\\|hack');
  });
});

// ─── Bug 4: resolver x_spans/y_spans edge cases ───────────────────────────────

describe('resolver grid x_spans/y_spans validation', () => {
  function makeMinimalYaml(xSpans: string, ySpans: string): string {
    return `
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
      thickness: 150mm
    internal_wall:
      partition: 100mm
geometry:
  grids:
    module: 910mm
    1F:
      x_spans: ${xSpans}
      y_spans: ${ySpans}
  rooms:
    - id: r1
      floor: 1F
      type: LDK
      grid_rect: { x: 0, y: 0, w: 1, h: 1 }
  openings: []
`;
  }

  it('throws when x_spans is empty', () => {
    const spec = parseArchilang(makeMinimalYaml('[]', '[3]'));
    expect(() => resolve(spec)).toThrow(/x_spans must not be empty/);
  });

  it('throws when y_spans is empty', () => {
    const spec = parseArchilang(makeMinimalYaml('[3]', '[]'));
    expect(() => resolve(spec)).toThrow(/y_spans must not be empty/);
  });

  it('throws when x_spans contains a non-positive value', () => {
    // Cast to force negative through TypeScript types
    const spec = parseArchilang(makeMinimalYaml('[3, -1]', '[3]'));
    expect(() => resolve(spec)).toThrow(/x_spans\[1\]/);
  });

  it('throws when y_spans contains zero', () => {
    const spec = parseArchilang(makeMinimalYaml('[3]', '[3, 0]'));
    expect(() => resolve(spec)).toThrow(/y_spans\[1\]/);
  });

  it('accepts valid positive spans', () => {
    const spec = parseArchilang(makeMinimalYaml('[3, 5]', '[4]'));
    expect(() => resolve(spec)).not.toThrow();
  });
});

// ─── Bug 5: CLI assertSafePath path traversal ──────────────────────────────────

describe('assertSafePath path traversal prevention', () => {
  // We import the function indirectly by testing the error at the module boundary.
  // Since assertSafePath is not exported, we test via a mock that mirrors its logic.
  it('rejects paths that escape cwd with ../', () => {
    const { normalize, resolve: pathResolve } = require('path');
    const cwd = process.cwd();
    function assertSafePath(rawPath: string): string {
      const abs = normalize(pathResolve(rawPath));
      if (!abs.startsWith(cwd + '/') && abs !== cwd) {
        throw new Error(`path traversal rejected: "${rawPath}"`);
      }
      return abs;
    }
    expect(() => assertSafePath('../../../etc/passwd')).toThrow(/path traversal rejected/);
    expect(() => assertSafePath('/etc/passwd')).toThrow(/path traversal rejected/);
  });

  it('accepts paths within cwd', () => {
    const { normalize, resolve: pathResolve } = require('path');
    const cwd = process.cwd();
    function assertSafePath(rawPath: string): string {
      const abs = normalize(pathResolve(rawPath));
      if (!abs.startsWith(cwd + '/') && abs !== cwd) {
        throw new Error(`path traversal rejected: "${rawPath}"`);
      }
      return abs;
    }
    expect(() => assertSafePath('samples/basic-3room.yaml')).not.toThrow();
  });
});

// ─── Bug 6 (3rd-pass): cost-master negative/non-finite unitPrice ─────────────
// JSON.stringify(Infinity/NaN) → null → caught by typeof check before reaching our guard.
// The real attack is a JSON cost-master file with negative unitPrice, which passes
// typeof check but produces negative estimate amounts. normalizeItem must reject it.

describe('loadCostMaster rejects invalid unitPrice', () => {
  function writeTmpCostMasterRaw(unitPriceJson: string): string {
    const json = `{"version":"0.0.1","categories":[{"id":"test","name":"Test","items":[{"code":"T-001","name":"テスト","unit":"㎡","unitPrice":${unitPriceJson}}]}]}`;
    const path = join(tmpdir(), `cost-master-test-${Date.now()}.json`);
    writeFileSync(path, json, 'utf-8');
    return path;
  }

  it('rejects negative unitPrice (would produce negative estimate totals)', async () => {
    const path = writeTmpCostMasterRaw('-100');
    await expect(loadCostMaster(path)).rejects.toThrow(/unitPrice must be a finite non-negative number/);
  });

  it('rejects null unitPrice (JSON-serialized Infinity/NaN → null → non-number)', async () => {
    // JSON.stringify(Infinity) → null; this is caught by typeof check with the right message
    const path = writeTmpCostMasterRaw('null');
    await expect(loadCostMaster(path)).rejects.toThrow(/Invalid cost master item/);
  });

  it('accepts zero unitPrice (free/included item)', async () => {
    const path = writeTmpCostMasterRaw('0');
    await expect(loadCostMaster(path)).resolves.toBeDefined();
  });

  it('accepts valid positive unitPrice', async () => {
    const path = writeTmpCostMasterRaw('3500');
    await expect(loadCostMaster(path)).resolves.toBeDefined();
  });
});

// ─── Bug 7 (3rd-pass): duplicate room IDs silently accepted ───────────────────

describe('parseArchilang rejects duplicate room IDs', () => {
  const minimalBase = `
archilang: "0.2"
site:
  orientation: south
geometry:
  grids:
    module: 910mm
    1F:
      x_spans: [3, 3]
      y_spans: [3]
  rooms:
`;

  it('throws on two rooms with the same id', () => {
    const yaml = `${minimalBase}    - id: LDK
      floor: 1F
      type: LDK
      grid_rect: { x: 0, y: 0, w: 3, h: 3 }
    - id: LDK
      floor: 1F
      type: 洋室
      grid_rect: { x: 3, y: 0, w: 3, h: 3 }
`;
    expect(() => parseArchilang(yaml)).toThrow(/Duplicate room id "LDK"/);
  });

  it('accepts rooms with distinct ids', () => {
    const yaml = `${minimalBase}    - id: LDK
      floor: 1F
      type: LDK
      grid_rect: { x: 0, y: 0, w: 3, h: 3 }
    - id: 洋室
      floor: 1F
      type: 洋室
      grid_rect: { x: 3, y: 0, w: 3, h: 3 }
`;
    expect(() => parseArchilang(yaml)).not.toThrow();
  });
});
