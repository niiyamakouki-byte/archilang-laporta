import { parseArchilang } from './parser.js';
import { resolve as resolveModel } from './resolver.js';
import { validateBuilding } from './validator.js';
import { applyAutoFixes, FixResult } from './auto-fix.js';
import { toValidationJson } from './fix-hints.js';

export interface SolveOptions {
  maxIterations: number;
  dryRun: boolean;
}

export interface SolveResult {
  iterations: number;
  fixes: FixResult[];
  finalYaml: string;
  finalOk: boolean;
  finalErrorCount: number;
  finalWarningCount: number;
}

export function runSolveLoop(yamlText: string, options: SolveOptions): SolveResult {
  const { maxIterations, dryRun } = options;
  let current = yamlText;
  const allFixes: FixResult[] = [];
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;

    let spec, model, result;
    try {
      spec = parseArchilang(current);
      model = resolveModel(spec);
      result = validateBuilding(model);
    } catch (e) {
      console.error(`Iteration ${iterations}: parse/resolve error: ${e instanceof Error ? e.message : e}`);
      break;
    }

    // Find auto-fixable issues
    const autoFixableIssues = result.issues.filter(issue =>
      issue.code === 'GRID_MISALIGNMENT' || issue.code === 'ROOM_WITHOUT_DOOR'
    );

    if (autoFixableIssues.length === 0) {
      // No more auto-fixable issues
      if (!dryRun) {
        console.log(`Iteration ${iterations}: no auto-fixable issues remaining`);
      }
      break;
    }

    const { yamlText: fixed, fixes } = applyAutoFixes(current, autoFixableIssues, model);
    const appliedFixes = fixes.filter(f => f.applied);

    if (appliedFixes.length === 0) {
      // No fixes could be applied
      if (!dryRun) {
        console.log(`Iteration ${iterations}: no fixes could be applied`);
      }
      break;
    }

    allFixes.push(...fixes);

    if (dryRun) {
      for (const fix of appliedFixes) {
        console.log(`[dry-run] Would apply: ${fix.description}`);
      }
      break;
    }

    for (const fix of appliedFixes) {
      console.log(`Iteration ${iterations}: ${fix.description}`);
    }

    current = fixed;
  }

  // Final validation
  let finalOk = false;
  let finalErrorCount = 0;
  let finalWarningCount = 0;
  try {
    const spec = parseArchilang(current);
    const model = resolveModel(spec);
    const result = validateBuilding(model);
    finalOk = result.ok;
    finalErrorCount = result.errorCount;
    finalWarningCount = result.warningCount;
  } catch {
    // Leave defaults
  }

  return {
    iterations,
    fixes: allFixes,
    finalYaml: current,
    finalOk,
    finalErrorCount,
    finalWarningCount,
  };
}
