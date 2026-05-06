import { parse } from 'yaml';
import { Archilang, FloorGrid, EquipmentSpec } from './types.js';
import { VALID_EQUIPMENT_TYPES } from './equipment-presets.js';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function stripDangerousKeys(obj: unknown): void {
  if (typeof obj !== 'object' || obj === null) return;
  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(key)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (obj as Record<string, unknown>)[key];
    } else {
      stripDangerousKeys((obj as Record<string, unknown>)[key]);
    }
  }
}

const MAX_YAML_BYTES = 1_048_576; // 1 MB

export function parseArchilang(yamlText: string): Archilang {
  if (Buffer.byteLength(yamlText, 'utf8') > MAX_YAML_BYTES) {
    throw new Error(`YAML input too large (max ${MAX_YAML_BYTES} bytes)`);
  }
  const data = parse(yamlText) as Archilang;
  stripDangerousKeys(data);

  if (!data.archilang) {
    throw new Error('Missing archilang version');
  }
  if (!data.site || typeof data.site !== 'object') {
    throw new Error('Missing site section');
  }
  if (!data.geometry?.rooms?.length) {
    throw new Error('No rooms defined in geometry');
  }

  // Check for duplicate room IDs
  const seenRoomIds = new Set<string>();
  for (const room of data.geometry.rooms) {
    if (!room.id) throw new Error('Room is missing an id');
    if (seenRoomIds.has(room.id)) {
      throw new Error(`Duplicate room id "${room.id}"`);
    }
    seenRoomIds.add(room.id);
  }

  // Normalize room geometry: grid_rect → grid_rects (single-element array)
  for (const room of data.geometry.rooms) {
    if (room.grid_rect && room.grid_rects) {
      throw new Error(`Room "${room.id}": grid_rect and grid_rects are mutually exclusive`);
    }
    if (!room.grid_rect && !room.grid_rects) {
      throw new Error(`Room "${room.id}": must specify either grid_rect or grid_rects`);
    }
    if (room.grid_rects && room.grid_rects.length === 0) {
      throw new Error(`Room "${room.id}": grid_rects must not be empty`);
    }
    // Normalize to grid_rects
    if (room.grid_rect) {
      room.grid_rects = [room.grid_rect];
      delete room.grid_rect;
    }

    // Reject overlapping grid_rects
    if (room.grid_rects && room.grid_rects.length > 1) {
      for (let i = 0; i < room.grid_rects.length; i++) {
        for (let j = i + 1; j < room.grid_rects.length; j++) {
          const a = room.grid_rects[i];
          const b = room.grid_rects[j];
          const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (overlapX > 0 && overlapY > 0) {
            throw new Error(
              `Room "${room.id}": grid_rects[${i}] and grid_rects[${j}] overlap; component rectangles must not overlap`
            );
          }
        }
      }

      // Reject disconnected grid_rects (must form a single edge-connected footprint)
      const n = room.grid_rects.length;
      const visited = new Set<number>([0]);
      const queue = [0];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        const a = room.grid_rects[cur];
        for (let k = 0; k < n; k++) {
          if (visited.has(k)) continue;
          const b = room.grid_rects[k];
          const horizAdj =
            (a.x + a.w === b.x || b.x + b.w === a.x) &&
            Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
          const vertAdj =
            (a.y + a.h === b.y || b.y + b.h === a.y) &&
            Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x);
          if (horizAdj || vertAdj) {
            visited.add(k);
            queue.push(k);
          }
        }
      }
      if (visited.size !== n) {
        throw new Error(
          `Room "${room.id}": grid_rects do not form a single edge-connected footprint; all component rectangles must share at least one edge`
        );
      }
    }
  }

  // Normalize and validate orientation
  const validOrientations = ['north', 'south', 'east', 'west'];
  data.site.orientation = String(data.site.orientation ?? '').trim().toLowerCase();
  if (!validOrientations.includes(data.site.orientation)) {
    throw new Error(`Invalid orientation: "${data.site.orientation}". Must be one of: ${validOrientations.join(', ')}`);
  }

  // Validate equipment specifications
  if (data.geometry.equipment) {
    const validWalls = ['north', 'south', 'east', 'west'];
    const eqIds = new Set<string>();
    for (const eq of data.geometry.equipment) {
      if (!eq.id) throw new Error('Equipment entry missing "id"');
      if (eqIds.has(eq.id)) throw new Error(`Duplicate equipment ID "${eq.id}"`);
      eqIds.add(eq.id);
      if (!VALID_EQUIPMENT_TYPES.includes(eq.type as any)) {
        throw new Error(`Equipment "${eq.id}": unknown type "${eq.type}". Valid types: ${VALID_EQUIPMENT_TYPES.join(', ')}`);
      }
      if (!eq.room) throw new Error(`Equipment "${eq.id}": missing "room"`);
      if (!validWalls.includes(eq.wall)) {
        throw new Error(`Equipment "${eq.id}": invalid wall "${eq.wall}". Must be one of: ${validWalls.join(', ')}`);
      }
      if (eq.position !== 'center' && (typeof eq.position !== 'object' || typeof eq.position.offset !== 'number')) {
        throw new Error(`Equipment "${eq.id}": position must be "center" or { offset: <number> }`);
      }
    }
  }

  // Ensure archilang version is a string
  data.archilang = String(data.archilang);

  return data;
}

export function parseMm(value: string): number {
  const match = value.match(/^(\d+)mm$/);
  if (!match) throw new Error(`Invalid mm value: ${value}`);
  return parseInt(match[1], 10);
}

export function getFloorGrid(spec: Archilang, floor: string): FloorGrid {
  const grid = spec.geometry.grids[floor];
  if (!grid || typeof grid === 'string') {
    throw new Error(`No grid definition for floor: ${floor}`);
  }
  return grid as FloorGrid;
}
