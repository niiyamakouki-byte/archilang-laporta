import { describe, expect, it } from 'vitest';
import { estimateToMarkdown } from '../laporta/estimate-markdown.js';
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
      code: 'IN-005',
      name: 'クロス張り（量産品）',
      unit: '㎡',
      qty: 57.6,
      unitPrice: 1200,
      amount: 69120,
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
  subtotal: 299120,
  tax: 29912,
  total: 329032,
};

describe('estimateToMarkdown', () => {
  it('出力にラポルタ社名・住所・単価マスタ版を含む', () => {
    const md = estimateToMarkdown(baseEstimate);
    expect(md).toContain('株式会社ラポルタ (世田谷区給田5-12-12)');
    expect(md).toContain('単価マスタ v2.7.0');
  });

  it('発行日は generatedAt の YYYY-MM-DD 部分のみ抜く', () => {
    const md = estimateToMarkdown(baseEstimate);
    expect(md).toContain('発行日: 2026-05-06');
    // タイムゾーンや時分秒が混入していないこと
    expect(md).not.toContain('2026-05-06T');
  });

  it('プロジェクト名つきタイトルを生成する', () => {
    const md = estimateToMarkdown(baseEstimate, 'demo-house');
    expect(md.split('\n')[0]).toBe('# 見積書: demo-house');
  });

  it('プロジェクト名なしのタイトルにする', () => {
    const md = estimateToMarkdown(baseEstimate);
    expect(md.split('\n')[0]).toBe('# 見積書');
  });

  it('カテゴリ別小計を金額降順で出力する', () => {
    const md = estimateToMarkdown(baseEstimate);
    const interiorIdx = md.indexOf('| interior |');
    const fixturesIdx = md.indexOf('| fixtures |');
    expect(interiorIdx).toBeGreaterThan(0);
    expect(fixturesIdx).toBeGreaterThan(interiorIdx); // interior > fixtures (¥261k vs ¥38k)
  });

  it('内訳テーブルに各行を出力する', () => {
    const md = estimateToMarkdown(baseEstimate);
    expect(md).toContain('| IN-009 | フローリング（複合） | 24 | ㎡ | ¥8,000 | ¥192,000 |');
    expect(md).toContain('| FX-016 | アルミサッシ引違い窓 | 1 | 組 | ¥38,000 | ¥38,000 |');
  });

  it('小計・消費税・合計を表示する', () => {
    const md = estimateToMarkdown(baseEstimate);
    expect(md).toContain('**小計 (税別): ¥299,120**');
    expect(md).toContain('消費税 (10%): ¥29,912');
    expect(md).toContain('## 合計 (税込): ¥329,032');
  });

  it('金額は桁区切りカンマつきで日本語ロケール表記', () => {
    const big: LaportaEstimate = {
      ...baseEstimate,
      lines: [
        { ...baseEstimate.lines[0], amount: 1234567, unitPrice: 1234567 },
      ],
      subtotal: 1234567,
      tax: 123457,
      total: 1358024,
    };
    const md = estimateToMarkdown(big);
    expect(md).toContain('¥1,234,567');
    expect(md).toContain('¥1,358,024');
  });

  it('小数の金額も整数に丸めて表示する', () => {
    const fractional: LaportaEstimate = {
      ...baseEstimate,
      lines: [
        { ...baseEstimate.lines[0], amount: 1104614.5 },
      ],
      subtotal: 1104614.5,
      tax: 110461.45,
      total: 1215075.95,
    };
    const md = estimateToMarkdown(fractional);
    expect(md).toContain('¥1,104,615');   // 0.5 切り上げ
    expect(md).toContain('¥110,461');     // 0.45 切り捨て
    expect(md).toContain('¥1,215,076');   // 0.95 切り上げ
  });

  it('行が0件でも内訳ヘッダ行と合計を出力する (categoryセクションは省略)', () => {
    const empty: LaportaEstimate = {
      ...baseEstimate,
      lines: [],
      subtotal: 0,
      tax: 0,
      total: 0,
    };
    const md = estimateToMarkdown(empty);
    expect(md).toContain('## 内訳');
    expect(md).toContain('| 品目コード | 名称 | 数量 | 単位 | 単価 | 金額 |');
    expect(md).toContain('## 合計 (税込): ¥0');
    expect(md).not.toContain('## カテゴリ別小計');
  });

  it('世田谷区フッタと電話番号を末尾に含む', () => {
    const md = estimateToMarkdown(baseEstimate);
    expect(md).toContain('📍 世田谷区標準価格。現地調査後に±20%変動します。');
    expect(md).toContain('📞 無料見積もりはこちら: 03-6876-7749');
  });
});
