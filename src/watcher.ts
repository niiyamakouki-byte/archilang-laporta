import chokidar from 'chokidar';
import { resolve, parse as parsePath } from 'node:path';
import { renderToFiles } from './main.js';

function timestamp(): string {
  return new Date().toLocaleTimeString();
}

function logRender(inputPath: string, outputPath: string, opts: { areaTable: boolean }): void {
  try {
    renderToFiles(inputPath, outputPath, opts);
    console.log(`[${timestamp()}] ✓ Render OK`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[${timestamp()}] ✗ Render failed: ${message}`);
    console.error(`[${timestamp()}] Watching continues. Fix the file to retry.`);
  }
}

export function runWatch(args: string[]): void {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: main.js watch <file.yaml> [output.svg] [--area-table]');
    process.exit(0);
  }

  const areaTable = args.includes('--area-table');
  const filteredArgs = args.filter(a => a !== '--area-table');

  const inputArg = filteredArgs[0];
  if (!inputArg) {
    console.error('Usage: main.js watch <file.yaml> [output.svg] [--area-table]');
    process.exit(1);
  }

  const inputPath = resolve(inputArg);
  const outputPath = filteredArgs[1]
    ? resolve(filteredArgs[1])
    : (() => {
        const p = parsePath(inputPath);
        return resolve(p.dir, `${p.name}.svg`);
      })();

  console.log(`[${timestamp()}] Initial render of ${inputPath}`);
  logRender(inputPath, outputPath, { areaTable });

  const watcher = chokidar.watch(inputPath, {
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 30 },
    ignoreInitial: true,
  });

  watcher.on('change', () => {
    console.log(`[${timestamp()}] Change detected → rendering...`);
    logRender(inputPath, outputPath, { areaTable });
  });

  watcher.on('error', err => {
    console.error(`[${timestamp()}] Watcher error: ${err instanceof Error ? err.message : String(err)}`);
  });

  console.log(`[${timestamp()}] Watching ${inputPath} (Ctrl+C to stop)`);

  const shutdown = () => {
    console.log(`\n[${timestamp()}] Stopping watcher...`);
    watcher.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
