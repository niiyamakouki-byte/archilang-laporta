import { writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, normalize, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { LaportaEstimate } from './types.js';
import { estimateToMarkdown } from './estimate-markdown.js';

/** markdown → HTML → PDF via puppeteer-core + system Chrome */
export async function estimateToPdf(
  estimate: LaportaEstimate,
  projectName?: string,
  outPath?: string
): Promise<Buffer> {
  const md = estimateToMarkdown(estimate, projectName);
  const html = wrapHtml(md, projectName);

  // Dynamic import to avoid startup cost when PDF is not needed
  const puppeteer = await import('puppeteer-core');
  const chromePath = findChromePath();

  const LAUNCH_TIMEOUT_MS = 30_000;
  const launchPromise = puppeteer.default.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    timeout: LAUNCH_TIMEOUT_MS,
  });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('PDF browser launch timed out after 30s')), LAUNCH_TIMEOUT_MS)
  );
  const browser = await Promise.race([launchPromise, timeoutPromise]);

  try {
    const page = await browser.newPage();
    // Use 'load' instead of 'networkidle0': the HTML is fully self-contained
    // (no external resources), so 'networkidle0' waits 500ms for activity that
    // never happens and effectively hangs until LAUNCH_TIMEOUT_MS.
    await page.setContent(html, { waitUntil: 'load', timeout: LAUNCH_TIMEOUT_MS });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
    });

    if (outPath) {
      const safePath = resolvePdfPath(outPath);
      // Atomic write: write to tmp then rename
      const tmp = resolve(tmpdir(), `archilang-pdf-${randomBytes(8).toString('hex')}.pdf.tmp`);
      writeFileSync(tmp, pdfBuffer);
      renameSync(tmp, safePath);
    }
    return Buffer.from(pdfBuffer);
  } finally {
    // Race browser.close() against a 5s timeout: puppeteer-core occasionally
    // hangs in close() when the underlying Chrome takes too long to release
    // its CDP socket, which would otherwise keep the Node event loop alive
    // indefinitely. We've already saved the PDF, so dropping the browser
    // mid-shutdown is safe — the Chrome child process will exit when the
    // parent does (or via the OS reaper).
    const CLOSE_TIMEOUT_MS = 5_000;
    await Promise.race([
      browser.close().catch(() => { /* ignore close errors */ }),
      new Promise<void>(resolve => setTimeout(resolve, CLOSE_TIMEOUT_MS)),
    ]);
  }
}

/**
 * Resolves the PDF output path to an absolute path.
 * Path traversal enforcement is the caller's responsibility (see main.ts assertSafePath).
 */
function resolvePdfPath(rawPath: string): string {
  return normalize(isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath));
}

function findChromePath(): string {
  // macOS system Chrome
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  // Linux paths
  const linuxPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];

  if (existsSync(macChrome)) return macChrome;
  for (const p of linuxPaths) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    'Chrome/Chromium not found. Install Google Chrome or set CHROME_PATH env var.'
  );
}

/** markdown を簡易 HTML に変換 (marked 不要の最小実装) */
function wrapHtml(md: string, projectName?: string): string {
  const title = projectName ? `見積書: ${projectName}` : '見積書';
  const body = mdToHtmlBody(md);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${escHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans CJK JP",
                   "Yu Gothic", "Meiryo", sans-serif;
      font-size: 11pt;
      color: #1a1a1a;
      line-height: 1.7;
      padding: 0;
    }
    h1 { font-size: 18pt; margin: 0 0 12px; border-bottom: 2px solid #2c5f2e; padding-bottom: 6px; }
    h2 { font-size: 13pt; margin: 16px 0 8px; color: #2c5f2e; }
    p { margin: 4px 0; }
    hr { border: none; border-top: 1px solid #ccc; margin: 12px 0; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 10pt; }
    th, td { border: 1px solid #bbb; padding: 5px 8px; }
    th { background: #f0f4f0; font-weight: 600; }
    td:last-child { text-align: right; }
    td:nth-child(3) { text-align: right; }
    td:nth-child(5) { text-align: right; }
    strong { font-weight: 700; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

/** 最小 markdown → HTML 変換 (table / heading / bold / hr / p のみ)
 * @internal exported for unit testing only
 */
export function mdToHtmlBody(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inTable = false;
  let tableHeaderDone = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Heading
    if (line.startsWith('### ')) {
      if (inTable) { out.push('</table>'); inTable = false; tableHeaderDone = false; }
      out.push(`<h3>${escHtml(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith('## ')) {
      if (inTable) { out.push('</table>'); inTable = false; tableHeaderDone = false; }
      out.push(`<h2>${escHtml(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith('# ')) {
      if (inTable) { out.push('</table>'); inTable = false; tableHeaderDone = false; }
      out.push(`<h1>${escHtml(line.slice(2))}</h1>`);
      continue;
    }

    // HR
    if (line.trim() === '---') {
      if (inTable) { out.push('</table>'); inTable = false; tableHeaderDone = false; }
      out.push('<hr>');
      continue;
    }

    // Table rows
    if (line.startsWith('|')) {
      // Separator row (e.g. |---|---:|)
      if (/^\|[-| :]+\|$/.test(line.trim())) {
        tableHeaderDone = true;
        continue;
      }
      if (!inTable) {
        out.push('<table>');
        inTable = true;
        tableHeaderDone = false;
      }
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      const tag = tableHeaderDone ? 'td' : 'th';
      const row = cells
        .map(c => `<${tag}>${renderInline(c)}</${tag}>`)
        .join('');
      out.push(`<tr>${row}</tr>`);
      continue;
    }

    // End table if we were in one
    if (inTable) {
      out.push('</table>');
      inTable = false;
      tableHeaderDone = false;
    }

    // Empty line
    if (line.trim() === '') {
      continue;
    }

    // Paragraph
    out.push(`<p>${renderInline(line)}</p>`);
  }

  if (inTable) out.push('</table>');
  return out.join('\n');
}

/** インライン要素 (bold / escape) */
function renderInline(text: string): string {
  // Split on **bold** markers, escape each segment, then wrap bold parts with <strong>
  const parts = text.split(/\*\*(.+?)\*\*/g);
  // parts alternates: [plain, bold, plain, bold, ...]
  return parts.map((part, idx) => {
    const escaped = escHtml(part);
    return idx % 2 === 1 ? `<strong>${escaped}</strong>` : escaped;
  }).join('');
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
