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
import { runWatch } from './watcher.js';
import { loadCostMaster } from './laporta/cost-master.js';
import { emitEstimate } from './laporta/estimate-emitter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'validate') {
    runValidate(args.slice(1));
  } else if (command === 'inspect') {
    runInspect(args.slice(1));
  } else if (command === 'solve') {
    runSolve(args.slice(1));
  } else if (command === 'estimate') {
    await runEstimate(args.slice(1));
  } else if (command === 'watch') {
    runWatch(args.slice(1));
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

  renderToFiles(inputPath, outputPath, { areaTable });
}

export function renderToFiles(
  inputPath: string,
  outputPath: string,
  opts: { areaTable: boolean }
): void {
  console.log(`Reading: ${inputPath}`);
  const yamlText = readFileSync(inputPath, 'utf-8');

  const spec = parseArchilang(yamlText);
  console.log(`ARCHILANG v${spec.archilang} — ${spec.building.structure}`);
  console.log(`Rooms: ${spec.geometry.rooms.length}, Openings: ${spec.geometry.openings.length}`);

  const model = resolveModel(spec);
  console.log(`Grid: ${model.totalGridX}×${model.totalGridY} (${model.moduleSize}mm module)`);
  console.log(`Walls: ${model.walls.length} (ext: ${model.walls.filter(w => w.isExternal).length}, int: ${model.walls.filter(w => !w.isExternal).length})`);
  console.log(`Resolved openings: ${model.openings.length}`);

  const validation = validateBuilding(model);
  console.log(formatValidation(validation));

  const svg = composeSvg(model);
  writeFileSync(outputPath, svg, 'utf-8');
  console.log(`SVG written: ${outputPath}`);

  const parsed = parsePath(outputPath);
  const htmlPath = resolve(parsed.dir, `${parsed.name}.html`);
  const html = generateHtmlPreview(svg, spec.archilang);
  writeFileSync(htmlPath, html, 'utf-8');
  console.log(`HTML preview: ${htmlPath}`);

  if (opts.areaTable) {
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

async function runEstimate(args: string[]) {
  const inputPath = args[0];
  const outPath = args[1];

  if (!inputPath) {
    console.error('Usage: main.js estimate <file.yaml> [out.json]');
    process.exit(1);
  }

  const yamlText = readFileSync(resolve(inputPath), 'utf-8');
  const spec = parseArchilang(yamlText);
  const model = Object.assign(resolveModel(spec), { archilangVersion: spec.archilang });
  const db = await loadCostMaster();
  const estimate = emitEstimate(model, db);
  const output = JSON.stringify(estimate, null, 2);

  if (outPath) {
    writeFileSync(resolve(outPath), output, 'utf-8');
    console.log(`Estimate JSON written: ${outPath}`);
    return;
  }

  process.stdout.write(`${output}\n`);
}

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

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
