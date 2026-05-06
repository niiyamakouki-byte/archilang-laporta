import { LaportaEstimate } from './types.js';

/** Markdown テーブルセル内の | と改行をエスケープしてテーブル崩れを防ぐ。制御文字も除去する */
function escapeTableCell(s: string): string {
  // Strip control characters (except tab which is harmless in markdown)
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** 顧客提出向け markdown 見積書を生成 */
export function estimateToMarkdown(estimate: LaportaEstimate, projectName?: string): string {
  const lines: string[] = [];
  const safeProjectName = projectName ? escapeTableCell(projectName) : undefined;
  const title = safeProjectName ? `# 見積書: ${safeProjectName}` : '# 見積書';
  lines.push(title);
  lines.push('');
  lines.push(`発行日: ${estimate.generatedAt.slice(0, 10)}`);
  lines.push(`株式会社ラポルタ (世田谷区給田5-12-12)`);
  lines.push(`単価マスタ v${estimate.version}`);
  lines.push('');

  // カテゴリ別集計
  const byCat = new Map<string, number>();
  for (const line of estimate.lines) {
    byCat.set(line.category, (byCat.get(line.category) ?? 0) + line.amount);
  }
  if (byCat.size > 0) {
    lines.push('## カテゴリ別小計');
    lines.push('');
    lines.push('| カテゴリ | 金額 |');
    lines.push('|---------|-----:|');
    for (const [cat, amount] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${escapeTableCell(cat)} | ¥${formatYen(amount)} |`);
    }
    lines.push('');
  }

  lines.push('## 内訳');
  lines.push('');
  lines.push('| 品目コード | 名称 | 数量 | 単位 | 単価 | 金額 |');
  lines.push('|---------|------|-----:|:----:|-----:|-----:|');
  for (const line of estimate.lines) {
    lines.push(
      `| ${escapeTableCell(line.code)} | ${escapeTableCell(line.name)} | ${line.qty} | ${escapeTableCell(line.unit)} | ¥${formatYen(line.unitPrice)} | ¥${formatYen(line.amount)} |`
    );
  }
  lines.push('');
  lines.push(`**小計 (税別): ¥${formatYen(estimate.subtotal)}**`);
  lines.push('');
  lines.push(`消費税 (10%): ¥${formatYen(estimate.tax)}`);
  lines.push('');
  lines.push(`## 合計 (税込): ¥${formatYen(estimate.total)}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('📍 世田谷区標準価格。現地調査後に±20%変動します。');
  lines.push('📞 無料見積もりはこちら: 03-6876-7749');

  return lines.join('\n');
}

function formatYen(value: number): string {
  return Math.round(value).toLocaleString('ja-JP');
}
