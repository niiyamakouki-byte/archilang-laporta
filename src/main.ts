import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, parse as parsePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArchilang } from './parser.js';
import { resolve as resolveModel } from './resolver.js';
import { validateBuilding, formatValidation } from './validator.js';
import { composeSvg } from './svg-composer.js';
import { escapeXml } from './svg-utils.js';
import { computeAreaSummary, areaSummaryToJson } from './area-table.js';
import { toValidationJson } from './fix-hints.js';
import { buildInspectionReport } from './inspect.js';
import { renderAsciiMap } from './ascii-map.js';
import { runSolveLoop } from './solve.js';
import { graphToYaml, graphToSpec, specToYaml } from './graph/graph-to-yaml.js';
import type { FloorplanGraph } from './graph/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'validate') {
    runValidate(args.slice(1));
  } else if (command === 'inspect') {
    runInspect(args.slice(1));
  } else if (command === 'solve') {
    runSolve(args.slice(1));
  } else if (command === 'generate') {
    runGenerate(args.slice(1));
  } else {
    runRender(args);
  }
}

// ─── render (default) ───

function runRender(args: string[]) {
  const areaTable = args.includes('--area-table');
  const filteredArgs = args.filter(a => a !== '--area-table');

  const inputPath = filteredArgs[0] || resolve(__dirname, '..', 'samples', 'basic-3room.yaml');
  const outputPath = filteredArgs[1] || resolve(__dirname, '..', 'output.svg');

  console.log(`Reading: ${inputPath}`);
  const yamlText = readFileSync(inputPath, 'utf-8');

  const spec = parseArchilang(yamlText);
  console.log(`ARCHILANG v${spec.archilang} — ${spec.building.structure}`);
  console.log(`Rooms: ${spec.geometry.rooms.length}, Openings: ${spec.geometry.openings.length}`);

  const model = resolveModel(spec);
  console.log(`Grid: ${model.totalGridX}×${model.totalGridY} (${model.moduleSize}mm module)`);
  console.log(`Walls: ${model.walls.length} (ext: ${model.walls.filter(w => w.isExternal).length}, int: ${model.walls.filter(w => !w.isExternal).length})`);
  console.log(`Resolved openings: ${model.openings.length}`);

  // Validate connectivity
  const validation = validateBuilding(model);
  console.log(formatValidation(validation));

  const svg = composeSvg(model);
  writeFileSync(outputPath, svg, 'utf-8');
  console.log(`SVG written: ${outputPath}`);

  // Also generate HTML preview
  const parsed = parsePath(outputPath);
  const htmlPath = resolve(parsed.dir, `${parsed.name}.html`);
  const html = generateHtmlPreview(svg, spec.archilang);
  writeFileSync(htmlPath, html, 'utf-8');
  console.log(`HTML preview: ${htmlPath}`);

  // Area table JSON (--area-table flag)
  if (areaTable) {
    const summary = computeAreaSummary(model);
    const jsonPath = resolve(parsed.dir, `${parsed.name}.area.json`);
    writeFileSync(jsonPath, JSON.stringify(areaSummaryToJson(summary), null, 2), 'utf-8');
    console.log(`Area table JSON: ${jsonPath}`);
  }
}

// ─── validate ───

function runValidate(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: main.js validate <file.yaml> [file2.yaml ...] [--format json]');
    console.log('       main.js validate --all [--format json]');
    process.exit(0);
  }

  // Parse flags explicitly to avoid stripping file names like "json"
  let jsonFormat = false;
  const hasAll = args.includes('--all');
  const fileArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--format' && args[i + 1] === 'json') {
      jsonFormat = true;
      i++; // skip 'json' value
    } else if (args[i] === '--all' || args[i] === '--help' || args[i] === '-h') {
      // skip flags
    } else {
      fileArgs.push(args[i]);
    }
  }

  if (fileArgs.length === 0 && !hasAll) {
    console.error('Usage: main.js validate <file.yaml> [file2.yaml ...] [--format json]');
    console.error('       main.js validate --all [--format json]');
    process.exit(1);
  }

  const files = hasAll
    ? findSampleFiles()
    : fileArgs.map(f => resolve(f));

  let hasError = false;
  const jsonResults: Array<{ file: string; validation: ReturnType<typeof toValidationJson> }> = [];

  for (const filePath of files) {
    const label = filePath.replace(process.cwd() + '/', '');
    let yamlText: string;
    try {
      yamlText = readFileSync(filePath, 'utf-8');
    } catch {
      if (jsonFormat) {
        jsonResults.push({ file: label, validation: { ok: false, errorCount: 1, warningCount: 0, issues: [{ severity: 'error', code: 'FILE_NOT_FOUND', message: `File not found: ${label}`, fix_hint: 'Check the file path', auto_fixable: false }] } });
      } else {
        console.error(`✗ ${label}: file not found`);
      }
      hasError = true;
      continue;
    }

    try {
      const spec = parseArchilang(yamlText);
      const model = resolveModel(spec);
      const result = validateBuilding(model);

      if (!result.ok) hasError = true;

      if (jsonFormat) {
        jsonResults.push({ file: label, validation: toValidationJson(result, model) });
      } else {
        console.log(`${result.ok ? '✓' : '✗'} ${label}`);
        for (const issue of result.issues) {
          const prefix = issue.severity === 'error' ? '  ERROR' : '  WARN ';
          console.log(`${prefix} [${issue.code}] ${issue.message}`);
        }
      }
    } catch (e) {
      hasError = true;
      if (jsonFormat) {
        jsonResults.push({ file: label, validation: { ok: false, errorCount: 1, warningCount: 0, issues: [{ severity: 'error', code: 'PARSE_ERROR', message: e instanceof Error ? e.message : String(e), fix_hint: 'Fix YAML syntax or schema errors', auto_fixable: false }] } });
      } else {
        console.error(`✗ ${label}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  if (jsonFormat) {
    // Single file → flat object; multiple files → array
    const output = jsonResults.length === 1
      ? { file: jsonResults[0].file, ...jsonResults[0].validation }
      : jsonResults.map(r => ({ file: r.file, ...r.validation }));
    console.log(JSON.stringify(output, null, 2));
  }

  process.exit(hasError ? 1 : 0);
}

// ─── inspect ───

function runInspect(args: string[]) {
  const asciiMap = args.includes('--ascii-map');
  const filteredArgs = args.filter(a => a !== '--ascii-map');

  const inputPath = filteredArgs[0];
  if (!inputPath) {
    console.error('Usage: main.js inspect <file.yaml> [--ascii-map]');
    process.exit(1);
  }

  const yamlText = readFileSync(resolve(inputPath), 'utf-8');
  const spec = parseArchilang(yamlText);
  const model = resolveModel(spec);
  const report = buildInspectionReport(model);

  if (asciiMap) {
    console.log(renderAsciiMap(report));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

// ─── solve ───

function runSolve(args: string[]) {
  const dryRun = args.includes('--dry-run');
  const maxIterIdx = args.indexOf('--max-iter');
  const maxIter = maxIterIdx !== -1 ? parseInt(args[maxIterIdx + 1], 10) || 5 : 5;
  const outIdx = args.indexOf('--out');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : undefined;

  const filteredArgs = args.filter((a, i) =>
    a !== '--dry-run' &&
    a !== '--max-iter' && (i === 0 || args[i - 1] !== '--max-iter') &&
    a !== '--out' && (i === 0 || args[i - 1] !== '--out')
  );

  const inputPath = filteredArgs[0];
  if (!inputPath) {
    console.error('Usage: main.js solve <file.yaml> [--dry-run] [--max-iter N] [--out fixed.yaml]');
    process.exit(1);
  }

  const yamlText = readFileSync(resolve(inputPath), 'utf-8');
  const result = runSolveLoop(yamlText, { maxIterations: maxIter, dryRun });

  console.log(`\nSolve complete: ${result.iterations} iteration(s), ${result.fixes.filter(f => f.applied).length} fix(es) applied`);
  console.log(`Final: ${result.finalErrorCount} error(s), ${result.finalWarningCount} warning(s), ok=${result.finalOk}`);

  if (outPath && !dryRun) {
    writeFileSync(resolve(outPath), result.finalYaml, 'utf-8');
    console.log(`Fixed YAML written to: ${outPath}`);
  }
}

// ─── generate (graph → yaml → render) ───

function runGenerate(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: main.js generate <graph.json> [--out output.yaml] [--render]');
    console.log('       main.js generate --prompt  (show LLM prompt template)');
    process.exit(0);
  }

  if (args.includes('--prompt')) {
    console.log(LLM_PROMPT_TEMPLATE);
    process.exit(0);
  }

  const renderFlag = args.includes('--render');
  const outIdx = args.indexOf('--out');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : undefined;
  const filteredArgs = args.filter((a, i) =>
    a !== '--render' &&
    a !== '--out' && (i === 0 || args[i - 1] !== '--out')
  );

  const inputPath = filteredArgs[0];
  if (!inputPath) {
    console.error('Usage: main.js generate <graph.json> [--out output.yaml] [--render]');
    process.exit(1);
  }

  // Read and parse graph JSON
  const jsonText = readFileSync(resolve(inputPath), 'utf-8');
  let graph: FloorplanGraph;
  try {
    graph = JSON.parse(jsonText) as FloorplanGraph;
  } catch (e) {
    console.error(`Failed to parse graph JSON: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }

  console.log(`Graph: ${graph.rooms.length} rooms, ${graph.connections.length} connections, ${graph.constraints.length} constraints`);

  // Convert graph → YAML
  const { spec, placements } = graphToSpec(graph);
  const yamlText = specToYaml(spec);

  console.log(`Placements:`);
  for (const p of placements) {
    console.log(`  ${p.id}: (${p.x},${p.y}) ${p.w}×${p.h}`);
  }

  // Write YAML
  const yamlPath = outPath || resolve(inputPath.replace(/\.json$/, '.yaml'));
  writeFileSync(yamlPath, yamlText, 'utf-8');
  console.log(`YAML written: ${yamlPath}`);

  // Validate the generated YAML
  try {
    const parsedSpec = parseArchilang(yamlText);
    const model = resolveModel(parsedSpec);
    const validation = validateBuilding(model);
    console.log(formatValidation(validation));

    if (renderFlag) {
      const svgPath = yamlPath.replace(/\.yaml$/, '.svg');
      const svg = composeSvg(model);
      writeFileSync(svgPath, svg, 'utf-8');
      console.log(`SVG written: ${svgPath}`);

      const parsed = parsePath(svgPath);
      const htmlPath = resolve(parsed.dir, `${parsed.name}.html`);
      const html = generateHtmlPreview(svg, spec.archilang);
      writeFileSync(htmlPath, html, 'utf-8');
      console.log(`HTML preview: ${htmlPath}`);
    }
  } catch (e) {
    console.error(`Validation failed: ${e instanceof Error ? e.message : e}`);
    console.error('The generated YAML may need manual adjustment.');
    process.exit(1);
  }
}

const LLM_PROMPT_TEMPLATE = `あなたは建築間取りの構造設計アシスタントです。
ユーザーの要望から「間取りグラフ」をJSON形式で出力してください。

## 重要なルール
- 座標やグリッド位置は出力しないでください。配置はシステムが自動で行います。
- 部屋の接続関係・制約・目標面積だけを出力してください。

## 出力スキーマ

\`\`\`json
{
  "meta": {
    "building_type": "木造軸組",
    "module": "shaku",
    "orientation": "south",  // 建物正面: south|north|east|west
    "stories": 1
  },
  "zones": [
    { "id": "public",  "type": "public",  "preferred_side": "south" },
    { "id": "private", "type": "private" },
    { "id": "water",   "type": "water" }
  ],
  "rooms": [
    {
      "id": "ldk",
      "type": "LDK",
      "zone": "public",
      "floor": "1F",
      "target_area_tatami": 16,
      "equipment": [{ "type": "kitchen_counter" }, { "type": "refrigerator" }],
      "windows": [{ "wall": "south", "size": "large" }]
    }
  ],
  "connections": [
    { "from": "ldk", "to": "bedroom", "type": "door" },
    { "from": "bath", "to": "wash", "type": "sliding_door" }
  ],
  "constraints": [
    { "type": "cluster",   "rooms": ["bath", "wash", "toilet"], "value": "water_cluster" },
    { "type": "entry",     "rooms": ["ldk"], "value": "south" },
    { "type": "orientation","rooms": ["ldk"], "value": "south" }
  ]
}
\`\`\`

## 部屋タイプ一覧
LDK, LD, DK, 寝室, 主寝室, 子供部屋, 和室, 浴室, 洗面脱衣, トイレ, 玄関, 廊下, WIC, クローゼット, パントリー

## 設備タイプ一覧
kitchen_counter, unit_bath, toilet, washbasin, washing_machine, refrigerator

## 接続タイプ
- door: 片開きドア
- sliding_door: 引き戸
- opening: 開口（建具なし）
- adjacent_only: 隣接のみ（開口なし）

## 制約タイプ
- orientation: 特定方位に面させる (value: south/north/east/west)
- adjacency: 2部屋を隣接
- cluster: 複数部屋をまとめる
- separation: 2部屋を離す
- entry: 玄関位置

## 窓サイズ
- large: 掃き出し窓 (2530×2000mm, FL)
- medium: 腰窓 (1690×1100mm, 高さ800mm)
- small: 小窓 (730×770mm, 高さ1000mm)
`;

function findSampleFiles(): string[] {
  const samplesDir = resolve(__dirname, '..', 'samples');
  return readdirSync(samplesDir)
    .filter(f => f.endsWith('.yaml'))
    .sort()
    .map(f => resolve(samplesDir, f));
}

// ─── helpers ───

function generateHtmlPreview(svgContent: string, version: string): string {
  const inlineSvg = svgContent.replace(/<\?xml[^?]*\?>\n?/, '');
  const safeVersion = escapeXml(version);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>ARCHILANG v${safeVersion} — Floor Plan Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f5f5;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px;
    }
    h1 {
      font-size: 18px;
      color: #333;
      margin-bottom: 16px;
    }
    .svg-container {
      background: white;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      overflow: auto;
    }
    svg { display: block; }
  </style>
</head>
<body>
  <h1>ARCHILANG v${safeVersion} — 1F Floor Plan</h1>
  <div class="svg-container">
    ${inlineSvg}
  </div>
</body>
</html>`;
}

main();
