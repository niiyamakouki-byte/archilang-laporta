import { describe, expect, it } from 'vitest';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { estimateToPdf, mdToHtmlBody } from '../laporta/estimate-pdf.js';
import type { LaportaEstimate } from '../laporta/types.js';

const baseEstimate: LaportaEstimate = {
  version: '2.7.0',
  generatedAt: '2026-05-06T10:30:00Z',
  archilangVersion: '0.2',
  lines: [
    {
      code: 'IN-009',
      name: 'フローリング（複合）',
      unit: '㎡',
      qty: 24,
      unitPrice: 8000,
      amount: 192000,
      category: 'interior',
      source: 'room',
      sourceId: 'ldk',
    },
    {
      code: 'FX-016',
      name: 'アルミサッシ引違い窓',
      unit: '組',
      qty: 1,
      unitPrice: 38000,
      amount: 38000,
      category: 'fixtures',
      source: 'opening',
      sourceId: 'W1',
    },
  ],
  subtotal: 230000,
  tax: 23000,
  total: 253000,
};

describe('estimateToPdf', () => {
  it('PDFファイルを書き出し、1KB以上であること', async () => {
    const outDir = resolve('/tmp/archilang-pdf-test');
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, 'estimate-test.pdf');

    const buf = await estimateToPdf(baseEstimate, 'テスト物件', outPath);

    // ファイルが存在し、サイズ > 1KB
    expect(existsSync(outPath)).toBe(true);
    expect(statSync(outPath).size).toBeGreaterThan(1024);

    // 返り値 Buffer も 1KB 超
    expect(buf.length).toBeGreaterThan(1024);

    // PDF シグネチャ確認
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
  }, 30000); // Chrome 起動を考慮して 30 秒

  it('outPath 省略時は Buffer のみ返し、ファイルを作成しない', async () => {
    const buf = await estimateToPdf(baseEstimate);
    expect(buf.length).toBeGreaterThan(1024);
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
  }, 30000);
});

describe('mdToHtmlBody (HTML escape)', () => {
  it('テーブルセル内の < > & を HTML エスケープする', () => {
    const md = '| コード | <script>xss</script> | 1 |\n|---|---|---|\n| A & B | foo | 2 |';
    const html = mdToHtmlBody(md);
    // XSS ペイロードがそのまま残らない
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('A & B');
    expect(html).toContain('A &amp; B');
  });

  it('段落内の特殊文字を HTML エスケープする', () => {
    const html = mdToHtmlBody('価格は 1 < 2 です & 注意');
    expect(html).not.toContain('1 < 2');
    expect(html).toContain('1 &lt; 2');
    expect(html).toContain('&amp; 注意');
  });

  it('**bold** 内の特殊文字もエスケープする', () => {
    const html = mdToHtmlBody('**<重要>**');
    expect(html).toContain('<strong>&lt;重要&gt;</strong>');
    expect(html).not.toContain('<重要>');
  });
});
