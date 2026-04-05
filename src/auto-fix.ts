/**
 * Rule-based auto-fix for validation issues.
 * Operates on YAML text (string manipulation) to preserve formatting.
 */

import { parseArchilang } from './parser.js';
import { resolve as resolveModel } from './resolver.js';
import { validateBuilding, ValidationIssue } from './validator.js';
import { BuildingModel, ResolvedEquipment, ResolvedOpening, WallEdge, Rect } from './types.js';
import { EQUIPMENT_PRESETS } from './equipment-presets.js';

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
  let workingYaml = yamlText;
  // Normalize flow-style empty openings: "openings: []" → "openings:"
  workingYaml = workingYaml.replace(/openings:\s*\[\s*\]/, 'openings:');

  const openingsIdx = workingYaml.indexOf('openings:');
  if (openingsIdx === -1) {
    return { yamlText, fix: { applied: false, description: 'No openings section found in YAML', code: issue.code } };
  }

  // Find the end of the openings list (next top-level key or end of geometry block)
  const afterOpenings = workingYaml.slice(openingsIdx);
  const nextSectionMatch = afterOpenings.match(/\n\s{0,2}\w+:/);
  let insertIdx: number;
  if (nextSectionMatch && nextSectionMatch.index !== undefined) {
    insertIdx = openingsIdx + nextSectionMatch.index;
  } else {
    insertIdx = workingYaml.length;
  }

  const modified = workingYaml.slice(0, insertIdx) + doorYaml + '\n' + workingYaml.slice(insertIdx);

  return {
    yamlText: modified,
    fix: {
      applied: true,
      description: `Added door "${doorId}" connecting "${roomId}" to "${neighbor}" on wall "${sharedWall.id}"`,
      code: issue.code,
    },
  };
}

// ─── YAML position rewrite helper ───

/**
 * Rewrite an equipment's position in YAML text.
 * Handles both `position: center` and `position: { offset: N }` formats.
 */
function rewriteEquipmentPosition(
  yamlText: string,
  equipmentId: string,
  newOffset: number,
): string {
  const eqIdIdx = yamlText.indexOf(`id: ${equipmentId}`);
  if (eqIdIdx === -1) return yamlText;

  // Find the block for this equipment entry (until next "- id:" or section end)
  const afterId = yamlText.slice(eqIdIdx);
  const nextEntryMatch = afterId.match(/\n\s+- id:/);
  const blockEnd = nextEntryMatch?.index ?? afterId.length;
  let block = afterId.slice(0, blockEnd);

  // Replace position: center or position: { offset: N }
  const centerPattern = /position:\s*center/;
  const offsetPattern = /position:\s*\{\s*offset:\s*\d+\s*\}/;

  const replacement = `position: { offset: ${Math.round(newOffset)} }`;
  if (centerPattern.test(block)) {
    block = block.replace(centerPattern, replacement);
  } else if (offsetPattern.test(block)) {
    block = block.replace(offsetPattern, replacement);
  } else {
    return yamlText; // unknown format
  }

  return yamlText.slice(0, eqIdIdx) + block + yamlText.slice(eqIdIdx + blockEnd);
}

/**
 * Rewrite an opening's position in YAML text.
 */
function rewriteOpeningPosition(
  yamlText: string,
  openingId: string,
  newOffset: number,
): string {
  const idIdx = yamlText.indexOf(`id: ${openingId}`);
  if (idIdx === -1) return yamlText;

  const afterId = yamlText.slice(idIdx);
  const nextEntryMatch = afterId.match(/\n\s+- id:/);
  const blockEnd = nextEntryMatch?.index ?? afterId.length;
  let block = afterId.slice(0, blockEnd);

  const centerPattern = /position:\s*center/;
  const offsetPattern = /position:\s*\{\s*offset:\s*\d+\s*\}/;

  const replacement = `position: { offset: ${Math.round(newOffset)} }`;
  if (centerPattern.test(block)) {
    block = block.replace(centerPattern, replacement);
  } else if (offsetPattern.test(block)) {
    block = block.replace(offsetPattern, replacement);
  } else {
    return yamlText;
  }

  return yamlText.slice(0, idIdx) + block + yamlText.slice(idIdx + blockEnd);
}

const EPS = 0.5;

// ─── OPENING_OVERLAP auto-fix ───

/**
 * Fix overlapping openings on the same wall by adjusting offset of the later one.
 */
export function fixOpeningOverlap(
  yamlText: string,
  issue: ValidationIssue,
  model: BuildingModel,
): { yamlText: string; fix: FixResult } {
  const openingId = issue.openingId;
  if (!openingId) return { yamlText, fix: { applied: false, description: 'No openingId', code: issue.code } };

  const opening = model.openings.find(o => o.id === openingId);
  if (!opening) return { yamlText, fix: { applied: false, description: 'Opening not found', code: issue.code } };

  const wall = model.walls.find(w => w.id === opening.wallId);
  if (!wall) return { yamlText, fix: { applied: false, description: 'Wall not found', code: issue.code } };

  const isHoriz = Math.abs(wall.y1 - wall.y2) < EPS;

  // Find all openings on same wall
  const sameWallOpenings = model.openings
    .filter(o => o.wallId === opening.wallId)
    .sort((a, b) => {
      const posA = isHoriz ? a.cx : a.cy;
      const posB = isHoriz ? b.cx : b.cy;
      return posA - posB;
    });

  // Find the opening this one overlaps with (the previous one in sorted order)
  const idx = sameWallOpenings.findIndex(o => o.id === openingId);
  if (idx <= 0) return { yamlText, fix: { applied: false, description: 'No preceding opening to avoid', code: issue.code } };

  const prev = sameWallOpenings[idx - 1];
  const prevEnd = (isHoriz ? prev.cx : prev.cy) + prev.w / 2;
  const gap = 100; // 100mm minimum gap

  // New center position for the overlapping opening
  const newCenter = prevEnd + gap + opening.w / 2;

  // Convert to wall-relative offset
  const wallStart = isHoriz
    ? Math.min(wall.x1, wall.x2)
    : Math.min(wall.y1, wall.y2);
  const newOffset = newCenter - opening.w / 2 - wallStart;

  // Find the room for this opening to compute room-relative offset
  const roomId = opening.connectedRooms?.[0] ?? wall.rooms[0];
  const room = model.rooms.find(r => r.id === roomId);
  if (!room) return { yamlText, fix: { applied: false, description: 'Room not found', code: issue.code } };

  const roomStart = isHoriz ? room.boundingRect.x : room.boundingRect.y;
  const roomRelOffset = newCenter - opening.w / 2 - roomStart;

  const modified = rewriteOpeningPosition(yamlText, openingId, Math.max(0, roomRelOffset));

  if (modified === yamlText) {
    return { yamlText, fix: { applied: false, description: 'Could not rewrite position', code: issue.code } };
  }

  return {
    yamlText: modified,
    fix: { applied: true, description: `Moved opening "${openingId}" to offset ${Math.round(Math.max(0, roomRelOffset))} to avoid overlap`, code: issue.code },
  };
}

// ─── EQUIPMENT_OVERLAP auto-fix ───

/**
 * Fix overlapping equipment on the same wall by spacing them with sequential offsets.
 */
export function fixEquipmentOverlap(
  yamlText: string,
  issue: ValidationIssue,
  model: BuildingModel,
): { yamlText: string; fix: FixResult } {
  // issue.message contains both equipment IDs
  const match = issue.message.match(/Equipment "([^"]+)" and "([^"]+)" overlap/);
  if (!match) return { yamlText, fix: { applied: false, description: 'Cannot parse equipment IDs', code: issue.code } };

  const [, eqId1, eqId2] = match;
  const eq1 = model.equipment.find(e => e.id === eqId1);
  const eq2 = model.equipment.find(e => e.id === eqId2);
  if (!eq1 || !eq2) return { yamlText, fix: { applied: false, description: 'Equipment not found', code: issue.code } };

  // Both must be in same room and on same wall side
  if (eq1.roomId !== eq2.roomId || eq1.wallSide !== eq2.wallSide) {
    return { yamlText, fix: { applied: false, description: 'Different rooms or walls', code: issue.code } };
  }

  const room = model.rooms.find(r => r.id === eq1.roomId);
  if (!room) return { yamlText, fix: { applied: false, description: 'Room not found', code: issue.code } };

  const isHoriz = eq1.wallSide === 'north' || eq1.wallSide === 'south';
  const br = room.boundingRect;
  const wallStart = isHoriz ? br.x : br.y;
  const gap = 100;

  // Sort the two by current position
  const sorted = [eq1, eq2].sort((a, b) => {
    const posA = isHoriz ? a.x : a.y;
    const posB = isHoriz ? b.x : b.y;
    return posA - posB;
  });

  // Keep first in place, move second after first + gap
  const firstEnd = isHoriz
    ? (sorted[0].x + sorted[0].w)
    : (sorted[0].y + sorted[0].h);
  const secondNewPos = firstEnd + gap;
  const secondOffset = secondNewPos - wallStart;

  const modified = rewriteEquipmentPosition(yamlText, sorted[1].id, secondOffset);
  if (modified === yamlText) {
    return { yamlText, fix: { applied: false, description: 'Could not rewrite position', code: issue.code } };
  }

  return {
    yamlText: modified,
    fix: { applied: true, description: `Moved equipment "${sorted[1].id}" to offset ${Math.round(secondOffset)} to avoid overlap with "${sorted[0].id}"`, code: issue.code },
  };
}

// ─── EQUIPMENT_OPENING_WALL_OVERLAP auto-fix ───

/**
 * Fix equipment overlapping a door/window on the same wall by shifting the equipment.
 */
export function fixEquipmentOpeningWallOverlap(
  yamlText: string,
  issue: ValidationIssue,
  model: BuildingModel,
): { yamlText: string; fix: FixResult } {
  const eqId = issue.equipmentId;
  const openingId = issue.openingId;
  if (!eqId || !openingId) return { yamlText, fix: { applied: false, description: 'Missing IDs', code: issue.code } };

  const eq = model.equipment.find(e => e.id === eqId);
  const opening = model.openings.find(o => o.id === openingId);
  if (!eq || !opening) return { yamlText, fix: { applied: false, description: 'Equipment or opening not found', code: issue.code } };

  const room = model.rooms.find(r => r.id === eq.roomId);
  if (!room) return { yamlText, fix: { applied: false, description: 'Room not found', code: issue.code } };

  const isHoriz = eq.wallSide === 'north' || eq.wallSide === 'south';
  const br = room.boundingRect;
  const wallStart = isHoriz ? br.x : br.y;
  const wallLength = isHoriz ? br.w : br.h;
  const eqDim = isHoriz ? eq.w : eq.h;

  // Opening range on wall
  const oCenter = isHoriz ? opening.cx : opening.cy;
  const oHalf = opening.w / 2;
  const oStart = oCenter - oHalf;
  const oEnd = oCenter + oHalf;
  const gap = 100;

  // Try placing equipment after the opening
  const afterOpeningOffset = oEnd + gap - wallStart;
  // Check it fits
  if (afterOpeningOffset + eqDim <= wallLength) {
    const modified = rewriteEquipmentPosition(yamlText, eqId, afterOpeningOffset);
    if (modified !== yamlText) {
      return {
        yamlText: modified,
        fix: { applied: true, description: `Moved equipment "${eqId}" to offset ${Math.round(afterOpeningOffset)} (after ${openingId})`, code: issue.code },
      };
    }
  }

  // Try placing before the opening
  const beforeOpeningEnd = oStart - gap - wallStart;
  const beforeOpeningOffset = beforeOpeningEnd - eqDim;
  if (beforeOpeningOffset >= 0) {
    const modified = rewriteEquipmentPosition(yamlText, eqId, beforeOpeningOffset);
    if (modified !== yamlText) {
      return {
        yamlText: modified,
        fix: { applied: true, description: `Moved equipment "${eqId}" to offset ${Math.round(beforeOpeningOffset)} (before ${openingId})`, code: issue.code },
      };
    }
  }

  return { yamlText, fix: { applied: false, description: `No room to place "${eqId}" away from "${openingId}"`, code: issue.code } };
}

// ─── EQUIPMENT_DOOR_CLEARANCE_BLOCKED auto-fix ───

/**
 * Fix equipment blocking door clearance by shifting it away from the door swing zone.
 */
export function fixEquipmentDoorClearance(
  yamlText: string,
  issue: ValidationIssue,
  model: BuildingModel,
): { yamlText: string; fix: FixResult } {
  const eqId = issue.equipmentId;
  const doorId = issue.openingId;
  if (!eqId || !doorId) return { yamlText, fix: { applied: false, description: 'Missing IDs', code: issue.code } };

  const eq = model.equipment.find(e => e.id === eqId);
  const door = model.openings.find(o => o.id === doorId);
  if (!eq || !door) return { yamlText, fix: { applied: false, description: 'Equipment or door not found', code: issue.code } };

  const room = model.rooms.find(r => r.id === eq.roomId);
  if (!room) return { yamlText, fix: { applied: false, description: 'Room not found', code: issue.code } };

  const wall = model.walls.find(w => w.id === door.wallId);
  if (!wall) return { yamlText, fix: { applied: false, description: 'Wall not found', code: issue.code } };

  const isHorizWall = Math.abs(wall.y1 - wall.y2) < EPS;
  const isEqHoriz = eq.wallSide === 'north' || eq.wallSide === 'south';
  const br = room.boundingRect;
  const eqWallStart = isEqHoriz ? br.x : br.y;
  const eqWallLength = isEqHoriz ? br.w : br.h;
  const eqDim = isEqHoriz ? eq.w : eq.h;

  // Door clearance zone extent along the equipment's wall axis
  const doorCenter = isHorizWall ? door.cx : door.cy;
  const doorHalfW = door.w / 2;
  const clearStart = doorCenter - doorHalfW;
  const clearEnd = doorCenter + doorHalfW;
  const gap = 100;

  // If equipment wall is perpendicular to door wall, shift along equipment wall
  // Try after clearance zone
  const afterClearOffset = clearEnd + gap - eqWallStart;
  if (afterClearOffset + eqDim <= eqWallLength) {
    const modified = rewriteEquipmentPosition(yamlText, eqId, afterClearOffset);
    if (modified !== yamlText) {
      return {
        yamlText: modified,
        fix: { applied: true, description: `Moved equipment "${eqId}" to offset ${Math.round(afterClearOffset)} (clear of door "${doorId}")`, code: issue.code },
      };
    }
  }

  // Try before clearance zone
  const beforeOffset = clearStart - gap - eqDim - eqWallStart;
  if (beforeOffset >= 0) {
    const modified = rewriteEquipmentPosition(yamlText, eqId, beforeOffset);
    if (modified !== yamlText) {
      return {
        yamlText: modified,
        fix: { applied: true, description: `Moved equipment "${eqId}" to offset ${Math.round(beforeOffset)} (clear of door "${doorId}")`, code: issue.code },
      };
    }
  }

  return { yamlText, fix: { applied: false, description: `No room to place "${eqId}" clear of door "${doorId}"`, code: issue.code } };
}

// ─── EQUIPMENT_OUT_OF_BOUNDS auto-fix ───

/**
 * Fix equipment extending outside room by clamping to room bounding rect.
 */
export function fixEquipmentOutOfBounds(
  yamlText: string,
  issue: ValidationIssue,
  model: BuildingModel,
): { yamlText: string; fix: FixResult } {
  // Extract equipment ID from message
  const match = issue.message.match(/Equipment "([^"]+)"/);
  if (!match) return { yamlText, fix: { applied: false, description: 'Cannot parse equipment ID', code: issue.code } };

  const eqId = match[1];
  const eq = model.equipment.find(e => e.id === eqId);
  if (!eq) return { yamlText, fix: { applied: false, description: 'Equipment not found', code: issue.code } };

  const room = model.rooms.find(r => r.id === eq.roomId);
  if (!room) return { yamlText, fix: { applied: false, description: 'Room not found', code: issue.code } };

  const isHoriz = eq.wallSide === 'north' || eq.wallSide === 'south';
  const br = room.boundingRect;
  const wallStart = isHoriz ? br.x : br.y;
  const wallLength = isHoriz ? br.w : br.h;
  const eqDim = isHoriz ? eq.w : eq.h;
  const currentPos = isHoriz ? eq.x : eq.y;

  // Clamp: ensure equipment fits within [wallStart, wallStart + wallLength]
  let newPos = currentPos;
  if (newPos < wallStart) newPos = wallStart;
  if (newPos + eqDim > wallStart + wallLength) newPos = wallStart + wallLength - eqDim;
  if (newPos < wallStart) newPos = wallStart; // still out → equipment is wider than wall

  const newOffset = newPos - wallStart;
  if (Math.abs(newOffset - (currentPos - wallStart)) < 1) {
    return { yamlText, fix: { applied: false, description: 'Already at boundary', code: issue.code } };
  }

  const modified = rewriteEquipmentPosition(yamlText, eqId, Math.max(0, newOffset));
  if (modified === yamlText) {
    return { yamlText, fix: { applied: false, description: 'Could not rewrite position', code: issue.code } };
  }

  return {
    yamlText: modified,
    fix: { applied: true, description: `Clamped equipment "${eqId}" to offset ${Math.round(Math.max(0, newOffset))} (within room bounds)`, code: issue.code },
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

  // Apply OPENING_OVERLAP fixes
  for (const issue of issues.filter(i => i.code === 'OPENING_OVERLAP')) {
    try {
      const spec = parseArchilang(current);
      const updatedModel = resolveModel(spec);
      const result = fixOpeningOverlap(current, issue, updatedModel);
      current = result.yamlText;
      fixes.push(result.fix);
    } catch {
      fixes.push({ applied: false, description: `Failed to re-parse`, code: issue.code });
    }
  }

  // Apply equipment fixes (re-parse once, apply in sequence)
  const equipmentCodes: Array<{
    code: string;
    fn: (y: string, i: ValidationIssue, m: BuildingModel) => { yamlText: string; fix: FixResult };
  }> = [
    { code: 'EQUIPMENT_DOOR_CLEARANCE_BLOCKED', fn: fixEquipmentDoorClearance },
    { code: 'EQUIPMENT_OPENING_WALL_OVERLAP', fn: fixEquipmentOpeningWallOverlap },
    { code: 'EQUIPMENT_OVERLAP', fn: fixEquipmentOverlap },
    { code: 'EQUIPMENT_OUT_OF_BOUNDS', fn: fixEquipmentOutOfBounds },
  ];

  for (const { code, fn } of equipmentCodes) {
    for (const issue of issues.filter(i => i.code === code)) {
      try {
        const spec = parseArchilang(current);
        const updatedModel = resolveModel(spec);
        const result = fn(current, issue, updatedModel);
        current = result.yamlText;
        fixes.push(result.fix);
      } catch {
        fixes.push({ applied: false, description: `Failed to re-parse`, code: issue.code });
      }
    }
  }

  return { yamlText: current, fixes };
}
