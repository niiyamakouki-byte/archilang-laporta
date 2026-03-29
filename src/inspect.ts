import { BuildingModel, ResolvedRoom, WallEdge, ResolvedOpening, GridRect } from './types.js';
import { computeAreaSummary } from './area-table.js';

export interface InspectionReport {
  grid: {
    moduleSize: number;
    totalX: number;
    totalY: number;
    xSpans: number[];
    ySpans: number[];
  };
  rooms: Array<{
    id: string;
    type: string;
    gridRects: GridRect[];
    area_m2: number;
    tatami: number;
    neighbors: string[];
    walls: Array<{ side: string; wallId: string; isExternal: boolean }>;
  }>;
  adjacency: Record<string, string[]>;
  occupancyGrid: string[][];
  walls: Array<{
    id: string;
    rooms: string[];
    isExternal: boolean;
    source?: string;
  }>;
  openings: Array<{
    id: string;
    type: string;
    connectedRooms?: [string, string];
    wallId: string;
  }>;
}

export function buildInspectionReport(model: BuildingModel): InspectionReport {
  // Build adjacency from door connections
  const adj = new Map<string, Set<string>>();
  const ensureRoom = (id: string) => { if (!adj.has(id)) adj.set(id, new Set()); };
  for (const room of model.rooms) ensureRoom(room.id);
  for (const sr of model.subRooms ?? []) ensureRoom(sr.id);

  for (const o of model.openings) {
    if (o.connectedRooms) {
      const [r1, r2] = o.connectedRooms;
      ensureRoom(r1); ensureRoom(r2);
      adj.get(r1)!.add(r2);
      adj.get(r2)!.add(r1);
    }
  }

  const adjacency: Record<string, string[]> = {};
  for (const [k, v] of adj) adjacency[k] = [...v].sort();

  // Occupancy grid
  const { totalGridX, totalGridY } = model;
  const occupancyGrid: string[][] = [];
  for (let y = 0; y < totalGridY; y++) {
    occupancyGrid[y] = [];
    for (let x = 0; x < totalGridX; x++) {
      occupancyGrid[y][x] = '';
    }
  }
  for (const room of model.rooms) {
    for (const gr of room.gridRects) {
      for (let dy = 0; dy < gr.h; dy++) {
        for (let dx = 0; dx < gr.w; dx++) {
          const gx = gr.x + dx;
          const gy = gr.y + dy;
          if (gx >= 0 && gx < totalGridX && gy >= 0 && gy < totalGridY) {
            occupancyGrid[gy][gx] = room.id;
          }
        }
      }
    }
  }

  // Area summary
  const areaSummary = computeAreaSummary(model);
  const areaByRoom = new Map<string, { m2: number; tatami: number }>();
  for (const r of areaSummary.rows) {
    areaByRoom.set(r.roomId, { m2: r.areaM2, tatami: r.tatami });
  }

  // Room wall mapping
  const roomWalls = new Map<string, Array<{ side: string; wallId: string; isExternal: boolean }>>();
  for (const wall of model.walls) {
    for (const roomId of wall.rooms) {
      if (!roomWalls.has(roomId)) roomWalls.set(roomId, []);
      roomWalls.get(roomId)!.push({
        side: wall.side,
        wallId: wall.id,
        isExternal: wall.isExternal,
      });
    }
  }

  const rooms = model.rooms.map(room => {
    const area = areaByRoom.get(room.id) ?? { m2: 0, tatami: 0 };
    return {
      id: room.id,
      type: room.type,
      gridRects: room.gridRects,
      area_m2: Math.round(area.m2 * 100) / 100,
      tatami: Math.round(area.tatami * 10) / 10,
      neighbors: adjacency[room.id] ?? [],
      walls: roomWalls.get(room.id) ?? [],
    };
  });

  const walls = model.walls.map(w => ({
    id: w.id,
    rooms: w.rooms,
    isExternal: w.isExternal,
    ...(w.source && { source: w.source }),
  }));

  const openings = model.openings.map(o => ({
    id: o.id,
    type: o.type,
    ...(o.connectedRooms && { connectedRooms: o.connectedRooms }),
    wallId: o.wallId,
  }));

  return {
    grid: {
      moduleSize: model.moduleSize,
      totalX: totalGridX,
      totalY: totalGridY,
      xSpans: model.xSpans,
      ySpans: model.ySpans,
    },
    rooms,
    adjacency,
    occupancyGrid,
    walls,
    openings,
  };
}
