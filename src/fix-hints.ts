import { ValidationIssue, IssueCode } from './validator.js';
import { BuildingModel, WallEdge } from './types.js';

export interface FixHintResult {
  hint: string;
  autoFixable: boolean;
  /** LLM向け: 修正に使える具体的情報 */
  details?: Record<string, unknown>;
}

/** Find rooms that share a wall with the given room */
function findAdjacentRooms(roomId: string, model: BuildingModel): Array<{ roomId: string; wallId: string; lengthMm: number }> {
  const result: Array<{ roomId: string; wallId: string; lengthMm: number }> = [];
  for (const w of model.walls) {
    if (!w.rooms.includes(roomId) || w.rooms.length < 2) continue;
    for (const other of w.rooms) {
      if (other === roomId) continue;
      const len = Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);
      result.push({ roomId: other, wallId: w.id, lengthMm: Math.round(len) });
    }
  }
  return result;
}

/** BFS to find shortest path from an unreachable room to an external entrance */
function findPathToEntrance(
  unreachableRoomId: string,
  model: BuildingModel,
): { path: string[]; missingDoors: Array<{ from: string; to: string; sharedWall: string }> } | null {
  // Build wall-adjacency graph (physical adjacency, not door connectivity)
  const wallAdj = new Map<string, Set<string>>();
  const wallBetween = new Map<string, string>(); // "a|b" → wallId

  for (const w of model.walls) {
    if (w.rooms.length < 2) continue;
    for (let i = 0; i < w.rooms.length; i++) {
      for (let j = i + 1; j < w.rooms.length; j++) {
        const a = w.rooms[i], b = w.rooms[j];
        if (!wallAdj.has(a)) wallAdj.set(a, new Set());
        if (!wallAdj.has(b)) wallAdj.set(b, new Set());
        wallAdj.get(a)!.add(b);
        wallAdj.get(b)!.add(a);
        wallBetween.set(`${a}|${b}`, w.id);
        wallBetween.set(`${b}|${a}`, w.id);
      }
    }
  }

  // Find rooms with external entrances
  const roomsWithEntrance = new Set<string>();
  for (const o of model.openings) {
    if (o.isExternal && (o.type === 'AD' || o.type === 'WD')) {
      const wall = model.walls.find(w => w.id === o.wallId);
      if (wall) {
        for (const r of wall.rooms) roomsWithEntrance.add(r);
      }
    }
  }

  // Also rooms connected by doors to rooms with entrance (BFS on door graph)
  const reachable = new Set<string>(roomsWithEntrance);
  const queue = [...roomsWithEntrance];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const o of model.openings) {
      if (o.type !== 'WD' && o.type !== 'AD') continue;
      if (!o.connectedRooms) continue;
      const [a, b] = o.connectedRooms;
      if (a === cur && !reachable.has(b)) { reachable.add(b); queue.push(b); }
      if (b === cur && !reachable.has(a)) { reachable.add(a); queue.push(a); }
    }
  }

  if (reachable.has(unreachableRoomId)) return null; // already reachable

  // BFS on wall adjacency from unreachable room to any reachable room
  const visited = new Map<string, string | null>(); // roomId → parent
  visited.set(unreachableRoomId, null);
  const bfsQueue = [unreachableRoomId];
  let found: string | null = null;

  while (bfsQueue.length > 0) {
    const cur = bfsQueue.shift()!;
    if (reachable.has(cur) && cur !== unreachableRoomId) {
      found = cur;
      break;
    }
    for (const neighbor of wallAdj.get(cur) ?? []) {
      if (!visited.has(neighbor)) {
        visited.set(neighbor, cur);
        bfsQueue.push(neighbor);
      }
    }
  }

  if (!found) return null;

  // Reconstruct path
  const path: string[] = [];
  let cur: string | null = found;
  while (cur !== null) {
    path.unshift(cur);
    cur = visited.get(cur) ?? null;
  }

  // Find missing doors along the path
  const existingDoors = new Set<string>();
  for (const o of model.openings) {
    if (!o.connectedRooms) continue;
    const [a, b] = o.connectedRooms;
    existingDoors.add(`${a}|${b}`);
    existingDoors.add(`${b}|${a}`);
  }

  const missingDoors: Array<{ from: string; to: string; sharedWall: string }> = [];
  for (let i = 0; i < path.length - 1; i++) {
    const key = `${path[i]}|${path[i + 1]}`;
    if (!existingDoors.has(key)) {
      missingDoors.push({
        from: path[i],
        to: path[i + 1],
        sharedWall: wallBetween.get(key) ?? 'unknown',
      });
    }
  }

  return { path, missingDoors };
}

export function getFixHint(issue: ValidationIssue, model: BuildingModel): FixHintResult {
  switch (issue.code) {
    case 'ROOM_WITHOUT_DOOR': {
      const roomId = issue.roomIds?.[0] ?? 'unknown';
      const adjacent = findAdjacentRooms(roomId, model);
      if (adjacent.length > 0) {
        const best = adjacent.sort((a, b) => b.lengthMm - a.lengthMm)[0];
        return {
          hint: `Add a door connecting "${roomId}" to "${best.roomId}" on shared wall "${best.wallId}" (${best.lengthMm}mm)`,
          autoFixable: true,
          details: { adjacentRooms: adjacent },
        };
      }
      return { hint: `Add a door to room "${roomId}" (no shared wall found — add an external entrance)`, autoFixable: false };
    }

    case 'SUB_ROOM_WITHOUT_DOOR': {
      const subRoomId = issue.roomIds?.[0] ?? 'unknown';
      const sr = model.subRooms?.find(s => s.id === subRoomId);
      const parentId = sr?.parentRoomId ?? 'parent';
      return {
        hint: `Add a door connecting sub-room "${subRoomId}" to adjacent sub-room or parent room "${parentId}"`,
        autoFixable: false,
      };
    }

    case 'UNREACHABLE_ROOM': {
      const roomId = issue.roomIds?.[0] ?? 'unknown';
      const pathInfo = findPathToEntrance(roomId, model);
      if (pathInfo) {
        const pathStr = pathInfo.path.join(' → ');
        const doorSuggestions = pathInfo.missingDoors.map(d =>
          `connects: [${d.from}, ${d.to}]`
        ).join('; ');
        return {
          hint: `Room "${roomId}" needs door path: ${pathStr}. Add: ${doorSuggestions}`,
          autoFixable: false,
          details: {
            suggestedPath: pathInfo.path,
            missingDoors: pathInfo.missingDoors,
          },
        };
      }
      const adjacent = findAdjacentRooms(roomId, model);
      return {
        hint: `Room "${roomId}" is not reachable. Adjacent rooms: ${adjacent.map(a => a.roomId).join(', ') || 'none'}`,
        autoFixable: false,
        details: { adjacentRooms: adjacent },
      };
    }

    case 'GRID_MISALIGNMENT': {
      const wallId = issue.wallId ?? 'unknown';
      const wall = model.walls.find(w => w.id === wallId);
      const mod = model.moduleSize;
      if (wall) {
        const snapCoord = (c: number) => Math.round(c / mod) * mod;
        const snapped = [wall.x1, wall.y1, wall.x2, wall.y2].map(c => `${c}→${snapCoord(c)}`).join(', ');
        return {
          hint: `Snap wall "${wallId}" endpoints to nearest ${mod}mm grid (${snapped})`,
          autoFixable: true,
        };
      }
      return { hint: `Snap wall "${wallId}" endpoints to nearest ${mod}mm grid`, autoFixable: true };
    }

    case 'OPENING_OVERLAP': {
      const openingId = issue.openingId ?? 'unknown';
      return {
        hint: `Move opening "${openingId}" to eliminate overlap (auto-fix will adjust offset)`,
        autoFixable: true,
      };
    }

    case 'ISOLATED_SUBAREA': {
      const roomId = issue.roomIds?.[0] ?? 'unknown';
      return {
        hint: `Add a door on the partition wall to connect the isolated area in room "${roomId}"`,
        autoFixable: false,
      };
    }

    case 'UNKNOWN_ROOM_REF': {
      const openingId = issue.openingId;
      const roomIds = issue.roomIds ?? [];
      const validIds = model.rooms.map(r => r.id);
      return {
        hint: `Replace invalid room reference "${roomIds[0] ?? '?'}" in opening "${openingId ?? '?'}". Valid room IDs: ${validIds.join(', ')}`,
        autoFixable: false,
        details: { validRoomIds: validIds },
      };
    }

    case 'SKIPPED_OPENING': {
      const openingId = issue.openingId ?? 'unknown';
      const roomIds = issue.roomIds ?? [];
      // Find what walls each room shares with other rooms
      const sharedWallInfo: Record<string, Array<{ roomId: string; wallId: string; lengthMm: number }>> = {};
      for (const rid of roomIds) {
        sharedWallInfo[rid] = findAdjacentRooms(rid, model);
      }
      const adjacentSummary = roomIds.map(rid => {
        const adj = sharedWallInfo[rid];
        return `${rid} is adjacent to: ${adj.map(a => a.roomId).join(', ') || 'none'}`;
      }).join('. ');

      return {
        hint: `Opening "${openingId}" failed: ${issue.message}. ${adjacentSummary}`,
        autoFixable: false,
        details: { sharedWalls: sharedWallInfo },
      };
    }

    case 'EQUIPMENT_UNKNOWN_ROOM': {
      const validIds = model.rooms.map(r => r.id);
      return {
        hint: `Equipment references unknown room. Valid room IDs: ${validIds.join(', ')}`,
        autoFixable: false,
        details: { validRoomIds: validIds },
      };
    }

    case 'EQUIPMENT_OUT_OF_BOUNDS':
    case 'EQUIPMENT_OVERLAP':
    case 'EQUIPMENT_OPENING_WALL_OVERLAP':
    case 'EQUIPMENT_DOOR_CLEARANCE_BLOCKED': {
      const eqId = issue.equipmentId ?? 'unknown';
      return {
        hint: `Adjust equipment "${eqId}": ${issue.message} (auto-fix will reposition)`,
        autoFixable: true,
      };
    }

    default:
      return { hint: issue.message, autoFixable: false };
  }
}

export interface ValidationJsonIssue {
  severity: string;
  code: string;
  message: string;
  roomIds?: string[];
  openingId?: string;
  equipmentId?: string;
  wallId?: string;
  fix_hint: string;
  auto_fixable: boolean;
  details?: Record<string, unknown>;
}

export interface ValidationJson {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  issues: ValidationJsonIssue[];
  context?: ValidationContext;
}

export interface ValidationContext {
  rooms: Array<{
    id: string;
    type: string;
    grid_rect: { x: number; y: number; w: number; h: number };
    adjacent_to: string[];
  }>;
  adjacency_graph: Record<string, string[]>;
}

export function toValidationJson(
  result: { issues: ValidationIssue[]; errorCount: number; warningCount: number; ok: boolean },
  model: BuildingModel,
): ValidationJson {
  // Build adjacency graph from shared walls
  const adjacency: Record<string, string[]> = {};
  for (const room of model.rooms) {
    const adj = new Set<string>();
    for (const w of model.walls) {
      if (!w.rooms.includes(room.id) || w.rooms.length < 2) continue;
      for (const other of w.rooms) {
        if (other !== room.id) adj.add(other);
      }
    }
    adjacency[room.id] = [...adj].sort();
  }

  const context: ValidationContext = {
    rooms: model.rooms.map(r => {
      // Convert mm bounding rect back to approximate grid rect
      const mod = model.moduleSize;
      const gridRect = r.gridRects[0] ?? {
        x: Math.round(r.boundingRect.x / mod),
        y: Math.round(r.boundingRect.y / mod),
        w: Math.round(r.boundingRect.w / mod),
        h: Math.round(r.boundingRect.h / mod),
      };
      return {
        id: r.id,
        type: r.type,
        grid_rect: gridRect,
        adjacent_to: adjacency[r.id] ?? [],
      };
    }),
    adjacency_graph: adjacency,
  };

  return {
    ok: result.ok,
    errorCount: result.errorCount,
    warningCount: result.warningCount,
    issues: result.issues.map(issue => {
      const { hint, autoFixable, details } = getFixHint(issue, model);
      return {
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        ...(issue.roomIds && { roomIds: issue.roomIds }),
        ...(issue.openingId && { openingId: issue.openingId }),
        ...(issue.equipmentId && { equipmentId: issue.equipmentId }),
        ...(issue.wallId && { wallId: issue.wallId }),
        fix_hint: hint,
        auto_fixable: autoFixable,
        ...(details && { details }),
      };
    }),
    context,
  };
}
