/**
 * Rule-based auto-fix for validation issues.
 * Operates on YAML text (string manipulation) to preserve formatting.
 */

import { parseArchilang } from './parser.js';
import { resolve as resolveModel } from './resolver.js';
import { validateBuilding, ValidationIssue } from './validator.js';
import { BuildingModel } from './types.js';

export interface FixResult {
  applied: boolean;
  description: string;
  code: string;
}

/**
 * Attempt to fix GRID_MISALIGNMENT by snapping wall endpoints to nearest grid.
 */
export function fixGridMisalignment(
  yamlText: string,
  issue: ValidationIssue,
  model: BuildingModel,
): { yamlText: string; fix: FixResult } {
  const wallId = issue.wallId;
  if (!wallId) return { yamlText, fix: { applied: false, description: 'No wallId', code: issue.code } };

  const wall = model.walls.find(w => w.id === wallId);
  if (!wall || wall.hasOffset) {
    return { yamlText, fix: { applied: false, description: 'Wall has offset or not found', code: issue.code } };
  }

  const mod = model.moduleSize;
  const maxSnapDist = mod / 2; // 455mm for 910mm module — snap to nearest grid within half a module

  const snap = (c: number): number | null => {
    const snapped = Math.round(c / mod) * mod;
    return Math.abs(snapped - c) <= maxSnapDist ? snapped : null;
  };

  // Find the wall segment in YAML by its id and replace coordinate values
  // We look for the pattern: - id: <wallId> ... from: { x: <val>, y: <val> } ... to: { x: <val>, y: <val> }
  const replacements: Array<{ field: string; axis: string; original: number; snapped: number }> = [];
  for (const [original, field, axis] of [
    [wall.x1, 'from', 'x'], [wall.y1, 'from', 'y'],
    [wall.x2, 'to', 'x'], [wall.y2, 'to', 'y'],
  ] as Array<[number, string, string]>) {
    const snapped = snap(original);
    if (snapped !== null && snapped !== original) {
      replacements.push({ field, axis, original, snapped });
    }
  }

  let modified = yamlText;
  const changes: string[] = [];

  // Find the wall segment block by id
  const wallIdIdx = modified.indexOf(`id: ${wallId}`);
  if (wallIdIdx === -1) return { yamlText, fix: { applied: false, description: 'Wall id not found in YAML', code: issue.code } };

  // Find the end of this segment (next segment starting with "- id:" or end of segments section)
  const afterId = modified.slice(wallIdIdx);
  const nextSegMatch = afterId.match(/\n\s+- id:/);
  const segEnd = nextSegMatch?.index ?? afterId.length;
  let segBlock = afterId.slice(0, segEnd);

  for (const { field, axis, original, snapped } of replacements) {
    // In the segment block, find "from:" or "to:" then the axis value
    const fieldIdx = segBlock.indexOf(`${field}:`);
    if (fieldIdx === -1) continue;

    const afterField = segBlock.slice(fieldIdx);
    // Match "x: 2500" or "y: 0" pattern
    const pattern = new RegExp(`(${axis}:\\s*)${original}(?=\\s|,|\\}|$)`);
    const match = afterField.match(pattern);
    if (match) {
      const replaced = match[0].replace(String(original), String(snapped));
      const absFieldIdx = fieldIdx + (match.index ?? 0);
      segBlock = segBlock.slice(0, absFieldIdx) + replaced + segBlock.slice(absFieldIdx + match[0].length);
      changes.push(`${original}→${snapped}`);
    }
  }

  modified = modified.slice(0, wallIdIdx) + segBlock + modified.slice(wallIdIdx + segEnd);

  if (changes.length === 0) {
    return { yamlText, fix: { applied: false, description: 'No coordinates to snap (snap distance too large)', code: issue.code } };
  }

  return {
    yamlText: modified,
    fix: { applied: true, description: `Snapped wall "${wallId}" to grid: ${changes.join(', ')}`, code: issue.code },
  };
}

/**
 * Attempt to fix ROOM_WITHOUT_DOOR by adding a door to a shared wall.
 */
export function fixRoomWithoutDoor(
  yamlText: string,
  issue: ValidationIssue,
  model: BuildingModel,
): { yamlText: string; fix: FixResult } {
  const roomId = issue.roomIds?.[0];
  if (!roomId) return { yamlText, fix: { applied: false, description: 'No roomId', code: issue.code } };

  // Find a shared wall with another room
  const sharedWall = model.walls
    .filter(w => w.rooms.includes(roomId) && w.rooms.length >= 2)
    .sort((a, b) => {
      // Prefer internal walls, then longest wall
      if (a.isExternal !== b.isExternal) return a.isExternal ? 1 : -1;
      const lenA = Math.abs(a.x2 - a.x1) + Math.abs(a.y2 - a.y1);
      const lenB = Math.abs(b.x2 - b.x1) + Math.abs(b.y2 - b.y1);
      return lenB - lenA;
    })[0];

  if (!sharedWall) {
    return { yamlText, fix: { applied: false, description: `No shared wall found for room "${roomId}"`, code: issue.code } };
  }

  const neighbor = sharedWall.rooms.find(r => r !== roomId)!;
  const doorId = `D_auto_${roomId}`;

  // Check if there are existing openings on this wall
  const existingOnWall = model.openings.filter(o => o.wallId === sharedWall.id);
  if (existingOnWall.length > 0) {
    return { yamlText, fix: { applied: false, description: `Wall "${sharedWall.id}" already has openings`, code: issue.code } };
  }

  // Add door to YAML openings section
  const doorYaml = `
    - id: ${doorId}
      type: WD
      style: 片開き
      connects: [${roomId}, ${neighbor}]
      position: center
      size: { w: 800, h: 2000 }`;

  // Find the openings section and append
  const openingsIdx = yamlText.indexOf('openings:');
  if (openingsIdx === -1) {
    return { yamlText, fix: { applied: false, description: 'No openings section found in YAML', code: issue.code } };
  }

  // Find the end of the openings list (next top-level key or end of geometry block)
  // Simple approach: insert after the last opening entry
  const afterOpenings = yamlText.slice(openingsIdx);
  const nextSectionMatch = afterOpenings.match(/\n\s{0,2}\w+:/);
  let insertIdx: number;
  if (nextSectionMatch && nextSectionMatch.index !== undefined) {
    insertIdx = openingsIdx + nextSectionMatch.index;
  } else {
    insertIdx = yamlText.length;
  }

  const modified = yamlText.slice(0, insertIdx) + doorYaml + '\n' + yamlText.slice(insertIdx);

  return {
    yamlText: modified,
    fix: {
      applied: true,
      description: `Added door "${doorId}" connecting "${roomId}" to "${neighbor}" on wall "${sharedWall.id}"`,
      code: issue.code,
    },
  };
}

/**
 * Apply all auto-fixable rules to the given YAML.
 */
export function applyAutoFixes(
  yamlText: string,
  issues: ValidationIssue[],
  model: BuildingModel,
): { yamlText: string; fixes: FixResult[] } {
  const fixes: FixResult[] = [];
  let current = yamlText;

  // Apply GRID_MISALIGNMENT fixes first (doesn't change structure)
  for (const issue of issues.filter(i => i.code === 'GRID_MISALIGNMENT')) {
    const result = fixGridMisalignment(current, issue, model);
    current = result.yamlText;
    fixes.push(result.fix);
  }

  // Apply ROOM_WITHOUT_DOOR fixes (adds openings)
  for (const issue of issues.filter(i => i.code === 'ROOM_WITHOUT_DOOR')) {
    // Re-parse after previous fixes to get updated model
    try {
      const spec = parseArchilang(current);
      const updatedModel = resolveModel(spec);
      const result = fixRoomWithoutDoor(current, issue, updatedModel);
      current = result.yamlText;
      fixes.push(result.fix);
    } catch {
      fixes.push({ applied: false, description: `Failed to re-parse after previous fix`, code: issue.code });
    }
  }

  return { yamlText: current, fixes };
}
