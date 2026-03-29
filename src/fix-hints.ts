import { ValidationIssue, IssueCode } from './validator.js';
import { BuildingModel } from './types.js';

export interface FixHintResult {
  hint: string;
  autoFixable: boolean;
}

export function getFixHint(issue: ValidationIssue, model: BuildingModel): FixHintResult {
  switch (issue.code) {
    case 'ROOM_WITHOUT_DOOR': {
      const roomId = issue.roomIds?.[0] ?? 'unknown';
      const room = model.rooms.find(r => r.id === roomId);
      if (!room) return { hint: `Add a door to room "${roomId}"`, autoFixable: false };
      // Find an adjacent room via shared wall
      const sharedWall = model.walls.find(w => w.rooms.includes(roomId) && w.rooms.length >= 2);
      const neighbor = sharedWall?.rooms.find(r => r !== roomId);
      if (neighbor) {
        return {
          hint: `Add a door connecting "${roomId}" to adjacent room "${neighbor}" on shared wall "${sharedWall!.id}"`,
          autoFixable: true,
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
        autoFixable: true,
      };
    }

    case 'UNREACHABLE_ROOM': {
      const roomId = issue.roomIds?.[0] ?? 'unknown';
      return {
        hint: `Room "${roomId}" is not reachable from any entrance. Add a door connecting it toward a reachable room`,
        autoFixable: false,
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
        hint: `Move or resize opening "${openingId}" to eliminate overlap`,
        autoFixable: false,
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
      return {
        hint: `Replace invalid room reference "${roomIds[0] ?? '?'}" in opening "${openingId ?? '?'}" with a valid room ID`,
        autoFixable: false,
      };
    }

    case 'SKIPPED_OPENING': {
      const openingId = issue.openingId ?? 'unknown';
      return {
        hint: `Fix opening "${openingId}": ${issue.message}`,
        autoFixable: false,
      };
    }

    case 'EQUIPMENT_UNKNOWN_ROOM':
    case 'EQUIPMENT_OUT_OF_BOUNDS':
    case 'EQUIPMENT_OVERLAP':
    case 'EQUIPMENT_OPENING_WALL_OVERLAP':
    case 'EQUIPMENT_DOOR_CLEARANCE_BLOCKED': {
      const eqId = issue.equipmentId ?? 'unknown';
      return {
        hint: `Adjust equipment "${eqId}": ${issue.message}`,
        autoFixable: false,
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
}

export interface ValidationJson {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  issues: ValidationJsonIssue[];
}

export function toValidationJson(
  result: { issues: ValidationIssue[]; errorCount: number; warningCount: number; ok: boolean },
  model: BuildingModel,
): ValidationJson {
  return {
    ok: result.ok,
    errorCount: result.errorCount,
    warningCount: result.warningCount,
    issues: result.issues.map(issue => {
      const { hint, autoFixable } = getFixHint(issue, model);
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
      };
    }),
  };
}
