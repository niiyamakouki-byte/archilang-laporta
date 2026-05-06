import {
  Archilang, BuildingModel, ResolvedRoom, ResolvedSubRoom, WallEdge, WallSide,
  ResolvedOpening, OpeningSpec, Rect, SkippedOpening,
  WallSegmentSpec, WallPointSpec, WallPointGrid, RoomSpec,
  EquipmentSpec, ResolvedEquipment,
} from './types.js';
import { parseMm, getFloorGrid } from './parser.js';
import { findBarriersInRoom, buildFloodFillContext, floodFill, summarizeRegion, Barrier, FloodFillContext } from './flood-fill.js';
import { EQUIPMENT_PRESETS } from './equipment-presets.js';

function computeBoundingRect(rects: Rect[]): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function resolve(spec: Archilang): BuildingModel {
  const moduleSize = parseMm(spec.geometry.grids.module as string);
  const extWallThickness = parseMm(spec.building.defaults.external_wall.thickness);
  const intWallThickness = parseMm(spec.building.defaults.internal_wall.partition);
  const floorGrid = getFloorGrid(spec, '1F');

  if (floorGrid.x_spans.length === 0) {
    throw new Error('1F grid: x_spans must not be empty');
  }
  if (floorGrid.y_spans.length === 0) {
    throw new Error('1F grid: y_spans must not be empty');
  }
  for (let i = 0; i < floorGrid.x_spans.length; i++) {
    const v = floorGrid.x_spans[i];
    if (!Number.isFinite(v) || v <= 0) {
      throw new Error(`1F grid: x_spans[${i}] must be a positive finite number, got ${v}`);
    }
  }
  for (let i = 0; i < floorGrid.y_spans.length; i++) {
    const v = floorGrid.y_spans[i];
    if (!Number.isFinite(v) || v <= 0) {
      throw new Error(`1F grid: y_spans[${i}] must be a positive finite number, got ${v}`);
    }
  }

  const totalGridX = floorGrid.x_spans.reduce((a, b) => a + b, 0);
  const totalGridY = floorGrid.y_spans.reduce((a, b) => a + b, 0);

  // Resolve rooms: grid_rects → mm rects
  const rooms: ResolvedRoom[] = spec.geometry.rooms
    .filter(r => r.floor === '1F')
    .map(r => {
      // grid_rects is normalized by parser; fallback for programmatic callers
      const gridRects = r.grid_rects ?? (r.grid_rect ? [r.grid_rect] : []);
      if (gridRects.length === 0) {
        throw new Error(`Room "${r.id}": no geometry defined (grid_rect or grid_rects required)`);
      }
      for (let gi = 0; gi < gridRects.length; gi++) {
        const gr = gridRects[gi];
        if (gr.x < 0 || gr.y < 0 || gr.w <= 0 || gr.h <= 0) {
          throw new Error(
            `Room "${r.id}" grid_rects[${gi}]: x, y must be >= 0 and w, h must be > 0`
          );
        }
        if (gr.x + gr.w > totalGridX) {
          throw new Error(
            `Room "${r.id}" grid_rects[${gi}]: x+w=${gr.x + gr.w} exceeds grid x_spans total=${totalGridX}`
          );
        }
        if (gr.y + gr.h > totalGridY) {
          throw new Error(
            `Room "${r.id}" grid_rects[${gi}]: y+h=${gr.y + gr.h} exceeds grid y_spans total=${totalGridY}`
          );
        }
      }
      const rects = gridRects.map(gr => ({
        x: gr.x * moduleSize,
        y: gr.y * moduleSize,
        w: gr.w * moduleSize,
        h: gr.h * moduleSize,
      }));
      const boundingRect = computeBoundingRect(rects);
      return { id: r.id, type: r.type, boundingRect, rects, gridRects };
    });

  // Extract wall edges (auto from rooms)
  const autoWalls = extractWalls(rooms, totalGridX, totalGridY, moduleSize, extWallThickness, intWallThickness);

  // Resolve explicit walls and merge
  const wallsSpec = spec.geometry.walls;
  const floorSegments = wallsSpec?.segments?.filter(s => s.floor === '1F') ?? [];
  const explicitWalls = floorSegments.length
    ? resolveExplicitWalls(floorSegments, moduleSize, floorGrid, extWallThickness, intWallThickness)
    : [];

  const mode = wallsSpec?.mode ?? 'additive';
  const walls = mode === 'explicit_only'
    ? explicitWalls
    : mergeWalls(autoWalls, explicitWalls);

  // Assign room ownership to explicit walls (they are created with rooms: [])
  assignRoomsToWalls(walls, rooms);

  // Resolve sub_rooms (before openings so sub_room IDs are available)
  const roomSpecs = spec.geometry.rooms.filter(r => r.floor === '1F');
  const subRooms = resolveSubRooms(roomSpecs, rooms, walls, moduleSize);

  // Validate: room IDs and sub_room IDs must be globally unique
  const roomIdSet = new Set(rooms.map(r => r.id));
  for (const sr of subRooms) {
    if (roomIdSet.has(sr.id)) {
      throw new Error(`Sub-room ID "${sr.id}" conflicts with room ID "${sr.id}". All IDs must be unique.`);
    }
  }
  const subRoomIdSet = new Set<string>();
  for (const sr of subRooms) {
    if (subRoomIdSet.has(sr.id)) {
      throw new Error(`Duplicate sub-room ID "${sr.id}"`);
    }
    subRoomIdSet.add(sr.id);
  }

  // Build sub_room → parent room mapping for opening resolution
  const subRoomToParent = new Map<string, ResolvedRoom>();
  for (const sr of subRooms) {
    const parent = rooms.find(r => r.id === sr.parentRoomId);
    if (parent) subRoomToParent.set(sr.id, parent);
  }

  // Resolve openings (with sub_room ID support)
  const { resolved: openings, skipped: skippedOpenings } = resolveOpenings(spec.geometry.openings, rooms, walls, moduleSize, subRoomToParent, subRooms);

  // Compute extra grid lines from explicit walls with grid_line: true
  const extraGridLines = computeExtraGridLines(floorSegments, explicitWalls, floorGrid, moduleSize);

  // Resolve equipment
  const equipment = resolveEquipment(spec.geometry.equipment ?? [], rooms, walls);

  return {
    moduleSize,
    externalWallThickness: extWallThickness,
    internalWallThickness: intWallThickness,
    totalGridX,
    totalGridY,
    xSpans: floorGrid.x_spans,
    ySpans: floorGrid.y_spans,
    rooms,
    walls,
    openings,
    skippedOpenings,
    orientation: spec.site.orientation,
    rendering: spec.rendering,
    extraGridLines,
    subRooms,
    equipment,
  };
}

interface RoomEdge {
  roomId: string;
  side: WallSide;
  // For vertical edges: pos=x, start/end=y range
  // For horizontal edges: pos=y, start/end=x range
  orientation: 'horizontal' | 'vertical';
  pos: number;
  start: number;
  end: number;
}

export function extractWalls(
  rooms: ResolvedRoom[],
  _totalGridX: number,
  _totalGridY: number,
  _moduleSize: number,
  extThickness: number,
  intThickness: number,
): WallEdge[] {
  // Collect all exterior edges from all rooms.
  // For multi-rect rooms, edges shared between rects of the same room are internal
  // to the room shape and must be removed before inter-room wall detection.
  const edges: RoomEdge[] = [];

  for (const room of rooms) {
    const perimeterEdges = extractRoomPerimeterEdges(room);
    edges.push(...perimeterEdges);
  }

  // Group edges by orientation and position (collinear edges)
  const groups = new Map<string, RoomEdge[]>();
  for (const e of edges) {
    const key = `${e.orientation}:${e.pos}`;
    const group = groups.get(key) || [];
    group.push(e);
    groups.set(key, group);
  }

  const walls: WallEdge[] = [];
  let wallIdx = 0;

  for (const [, group] of groups) {
    if (group.length === 1) {
      // Only one room has an edge here — entirely external
      const e = group[0];
      walls.push(edgeToWall(e, [e.roomId], true, extThickness, wallIdx++));
      continue;
    }

    // Multiple edges on the same line — find overlapping and non-overlapping segments
    // Collect all segment breakpoints
    const points = new Set<number>();
    for (const e of group) {
      points.add(e.start);
      points.add(e.end);
    }
    const sorted = [...points].sort((a, b) => a - b);

    for (let i = 0; i < sorted.length - 1; i++) {
      const segStart = sorted[i];
      const segEnd = sorted[i + 1];

      // Find which rooms cover this segment
      const coveringEdges = group.filter(e => e.start <= segStart && e.end >= segEnd);
      const coveringRoomIds = [...new Set(coveringEdges.map(e => e.roomId))];

      if (coveringRoomIds.length === 0) continue;

      const isExternal = coveringRoomIds.length === 1;
      const thickness = isExternal ? extThickness : intThickness;
      const side = coveringEdges[0].side;
      const orientation = group[0].orientation;

      walls.push({
        id: `wall_${wallIdx++}`,
        side,
        x1: orientation === 'vertical' ? group[0].pos : segStart,
        y1: orientation === 'vertical' ? segStart : group[0].pos,
        x2: orientation === 'vertical' ? group[0].pos : segEnd,
        y2: orientation === 'vertical' ? segEnd : group[0].pos,
        isExternal,
        thickness,
        rooms: coveringRoomIds,
      });
    }
  }

  return walls;
}

/**
 * Extract the perimeter edges of a room (possibly multi-rect).
 * For each rect, generate 4 edges. Then cancel out edges that appear
 * twice for the same room (shared between two rects of the same room).
 * Precondition: component rects must not overlap (enforced by parser).
 */
function extractRoomPerimeterEdges(room: ResolvedRoom): RoomEdge[] {
  // Collect all raw edges from all rects
  interface RawEdge {
    side: WallSide;
    orientation: 'horizontal' | 'vertical';
    pos: number;
    start: number;
    end: number;
  }
  const rawEdges: RawEdge[] = [];

  for (const r of room.rects) {
    rawEdges.push({ side: 'south', orientation: 'horizontal', pos: r.y, start: r.x, end: r.x + r.w });
    rawEdges.push({ side: 'north', orientation: 'horizontal', pos: r.y + r.h, start: r.x, end: r.x + r.w });
    rawEdges.push({ side: 'west', orientation: 'vertical', pos: r.x, start: r.y, end: r.y + r.h });
    rawEdges.push({ side: 'east', orientation: 'vertical', pos: r.x + r.w, start: r.y, end: r.y + r.h });
  }

  if (room.rects.length === 1) {
    // Single-rect room: all edges are perimeter
    return rawEdges.map(e => ({ ...e, roomId: room.id }));
  }

  // Multi-rect: group by orientation+pos, then subtract overlapping segments
  // that appear from opposite sides (south of one rect cancels north of another at same pos).
  // An edge segment is internal if it's covered by edges from both directions at the same position.
  const byLine = new Map<string, RawEdge[]>();
  for (const e of rawEdges) {
    const key = `${e.orientation}:${e.pos}`;
    const group = byLine.get(key) || [];
    group.push(e);
    byLine.set(key, group);
  }

  const result: RoomEdge[] = [];

  for (const [, group] of byLine) {
    // Separate edges by direction: for horizontal edges, 'south' faces down, 'north' faces up
    // Two edges at the same position from opposite sides cancel each other in overlapping segments
    const forwardSides: WallSide[] = group[0].orientation === 'horizontal' ? ['south', 'north'] : ['west', 'east'];
    const side0Edges = group.filter(e => e.side === forwardSides[0]);
    const side1Edges = group.filter(e => e.side === forwardSides[1]);

    if (side0Edges.length === 0 || side1Edges.length === 0) {
      // All edges face the same direction — all are perimeter
      for (const e of group) {
        result.push({ ...e, roomId: room.id });
      }
      continue;
    }

    // Find overlapping regions between opposite-facing edges and subtract them
    // Collect all breakpoints
    const points = new Set<number>();
    for (const e of group) {
      points.add(e.start);
      points.add(e.end);
    }
    const sorted = [...points].sort((a, b) => a - b);

    for (let i = 0; i < sorted.length - 1; i++) {
      const segStart = sorted[i];
      const segEnd = sorted[i + 1];

      const coveredBy0 = side0Edges.some(e => e.start <= segStart && e.end >= segEnd);
      const coveredBy1 = side1Edges.some(e => e.start <= segStart && e.end >= segEnd);

      if (coveredBy0 && coveredBy1) {
        // Internal edge — both sides present, cancel out
        continue;
      }

      // Only one side covers this segment — it's a perimeter edge
      const coveringEdges = group.filter(e => e.start <= segStart && e.end >= segEnd);
      if (coveringEdges.length > 0) {
        result.push({
          roomId: room.id,
          side: coveringEdges[0].side,
          orientation: coveringEdges[0].orientation,
          pos: coveringEdges[0].pos,
          start: segStart,
          end: segEnd,
        });
      }
    }
  }

  return mergeCollinearEdges(result);
}

/**
 * Merge contiguous collinear edges that share the same orientation, pos, and side.
 * This ensures multi-rect rooms don't produce fragmented wall segments on the same
 * physical side, which would cause position: center to land on a sub-segment.
 */
function mergeCollinearEdges(edges: RoomEdge[]): RoomEdge[] {
  // Group by (orientation, pos, side)
  const groups = new Map<string, RoomEdge[]>();
  for (const e of edges) {
    const key = `${e.orientation}:${e.pos}:${e.side}`;
    const group = groups.get(key) || [];
    group.push(e);
    groups.set(key, group);
  }

  const result: RoomEdge[] = [];

  for (const [, group] of groups) {
    if (group.length <= 1) {
      result.push(...group);
      continue;
    }

    // Sort by start position and merge contiguous/overlapping intervals
    const sorted = group.sort((a, b) => a.start - b.start);
    let current = { ...sorted[0] };

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start <= current.end) {
        // Contiguous or overlapping — extend
        current.end = Math.max(current.end, sorted[i].end);
      } else {
        // Gap — emit current and start new
        result.push(current);
        current = { ...sorted[i] };
      }
    }
    result.push(current);
  }

  return result;
}

function edgeToWall(e: RoomEdge, rooms: string[], isExternal: boolean, thickness: number, idx: number): WallEdge {
  return {
    id: `wall_${idx}`,
    side: e.side,
    x1: e.orientation === 'vertical' ? e.pos : e.start,
    y1: e.orientation === 'vertical' ? e.start : e.pos,
    x2: e.orientation === 'vertical' ? e.pos : e.end,
    y2: e.orientation === 'vertical' ? e.end : e.pos,
    isExternal,
    thickness,
    rooms,
  };
}

function computeExtraGridLines(
  segments: WallSegmentSpec[],
  resolvedWalls: WallEdge[],
  floorGrid: { x_spans: number[]; y_spans: number[] },
  moduleSize: number,
): { x: number[]; y: number[] } {
  // Compute span boundary positions in mm to exclude duplicates
  const xSpanPositions = new Set<number>();
  let acc = 0;
  xSpanPositions.add(0);
  for (const s of floorGrid.x_spans) { acc += s; xSpanPositions.add(acc * moduleSize); }

  const ySpanPositions = new Set<number>();
  acc = 0;
  ySpanPositions.add(0);
  for (const s of floorGrid.y_spans) { acc += s; ySpanPositions.add(acc * moduleSize); }

  const extraX = new Set<number>();
  const extraY = new Set<number>();

  for (let i = 0; i < segments.length; i++) {
    if (!segments[i].grid_line) continue;
    const wall = resolvedWalls[i];
    const isVertical = wall.x1 === wall.x2;
    if (isVertical) {
      if (!xSpanPositions.has(wall.x1)) extraX.add(wall.x1);
    } else {
      if (!ySpanPositions.has(wall.y1)) extraY.add(wall.y1);
    }
  }

  return {
    x: [...extraX].sort((a, b) => a - b),
    y: [...extraY].sort((a, b) => a - b),
  };
}

function isGridPoint(p: WallPointSpec): p is WallPointGrid {
  return 'grid' in p;
}

export function resolveWallPoint(
  p: WallPointSpec,
  moduleSize: number,
  floorGrid: { x_spans: number[]; y_spans: number[] },
): { x: number; y: number } {
  if (isGridPoint(p)) {
    const maxGridX = floorGrid.x_spans.reduce((a, b) => a + b, 0);
    const maxGridY = floorGrid.y_spans.reduce((a, b) => a + b, 0);

    if (p.grid.x < 0 || p.grid.x > maxGridX) {
      throw new Error(`Grid x=${p.grid.x} out of range [0, ${maxGridX}]`);
    }
    if (p.grid.y < 0 || p.grid.y > maxGridY) {
      throw new Error(`Grid y=${p.grid.y} out of range [0, ${maxGridY}]`);
    }

    return {
      x: p.grid.x * moduleSize + (p.dx ?? 0),
      y: p.grid.y * moduleSize + (p.dy ?? 0),
    };
  }
  // mm direct
  return { x: p.x, y: p.y };
}

function mergeWalls(autoWalls: WallEdge[], explicitWalls: WallEdge[]): WallEdge[] {
  const ids = new Set(autoWalls.map(w => w.id));
  for (const w of explicitWalls) {
    if (ids.has(w.id)) {
      throw new Error(`Duplicate wall id: "${w.id}"`);
    }
    ids.add(w.id);
  }
  return [...autoWalls, ...explicitWalls];
}

/**
 * Assign room ownership to walls that have rooms: [].
 * Uses extractRoomPerimeterEdges to match against the room's true outer perimeter,
 * excluding multi-rect internal seams.
 */
function assignRoomsToWalls(walls: WallEdge[], rooms: ResolvedRoom[]): void {
  const EPS = 0.5;

  // Pre-compute perimeter edges for each room
  const perimeterByRoom = rooms.map(room => ({
    roomId: room.id,
    edges: extractRoomPerimeterEdges(room),
  }));

  for (const wall of walls) {
    if (wall.rooms.length > 0) continue;

    const isVertical = Math.abs(wall.x1 - wall.x2) < EPS;
    const isHorizontal = Math.abs(wall.y1 - wall.y2) < EPS;
    if (!isVertical && !isHorizontal) continue;

    const ownerRoomIds = new Set<string>();

    for (const { roomId, edges } of perimeterByRoom) {
      for (const edge of edges) {
        // Match orientation
        if (isVertical && edge.orientation !== 'vertical') continue;
        if (isHorizontal && edge.orientation !== 'horizontal') continue;

        // Match position (wall pos must equal edge pos)
        const wallPos = isVertical ? wall.x1 : wall.y1;
        if (Math.abs(wallPos - edge.pos) > EPS) continue;

        // Check range overlap
        const wallStart = isVertical ? Math.min(wall.y1, wall.y2) : Math.min(wall.x1, wall.x2);
        const wallEnd = isVertical ? Math.max(wall.y1, wall.y2) : Math.max(wall.x1, wall.x2);
        const overlapLen = Math.min(wallEnd, edge.end) - Math.max(wallStart, edge.start);
        if (overlapLen > EPS) {
          ownerRoomIds.add(roomId);
          break; // No need to check more edges for this room
        }
      }
    }

    wall.rooms = [...ownerRoomIds];
  }
}

function resolveExplicitWalls(
  segments: WallSegmentSpec[],
  moduleSize: number,
  floorGrid: { x_spans: number[]; y_spans: number[] },
  extWallThickness: number,
  intWallThickness: number,
): WallEdge[] {
  return segments.map(seg => {
    const from = resolveWallPoint(seg.from, moduleSize, floorGrid);
    const to = resolveWallPoint(seg.to, moduleSize, floorGrid);

    // Validate: must be orthogonal and non-zero length
    const isVertical = from.x === to.x;
    const isHorizontal = from.y === to.y;
    if (!isVertical && !isHorizontal) {
      throw new Error(`Wall "${seg.id}" must be orthogonal (horizontal or vertical), got from=(${from.x},${from.y}) to=(${to.x},${to.y})`);
    }
    if (from.x === to.x && from.y === to.y) {
      throw new Error(`Wall "${seg.id}" has zero length`);
    }

    const isExternal = (seg.type ?? 'external') === 'external';
    const defaultThickness = isExternal ? extWallThickness : intWallThickness;
    const thickness = seg.thickness ? parseMm(seg.thickness) : defaultThickness;

    const side: WallSide = isVertical ? 'west' : 'south';

    const hasOffset = [seg.from, seg.to].some(
      p => 'grid' in p && (((p as WallPointGrid).dx ?? 0) !== 0 || ((p as WallPointGrid).dy ?? 0) !== 0)
    );

    return {
      id: seg.id,
      side,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      isExternal,
      thickness,
      rooms: [],
      source: 'explicit' as const,
      hasOffset,
    };
  });
}

function resolveOpenings(
  specs: OpeningSpec[],
  rooms: ResolvedRoom[],
  walls: WallEdge[],
  moduleSize: number,
  subRoomToParent?: Map<string, ResolvedRoom>,
  resolvedSubRooms?: ResolvedSubRoom[],
): { resolved: ResolvedOpening[]; skipped: SkippedOpening[] } {
  const roomMap = new Map(rooms.map(r => [r.id, r]));

  // Helper to resolve a room ID (could be a sub_room ID → use parent room for wall lookup)
  const resolveRoomId = (id: string): string => {
    if (roomMap.has(id)) return id;
    const parent = subRoomToParent?.get(id);
    return parent ? parent.id : id;
  };

  // Helper to check if a room ID is known (either room or sub_room)
  const isKnownId = (id: string): boolean => {
    return roomMap.has(id) || (subRoomToParent?.has(id) ?? false);
  };

  const resolved: ResolvedOpening[] = [];
  const skipped: SkippedOpening[] = [];

  for (const o of specs) {
    let targetWall: WallEdge | undefined;
    let cx: number;
    let cy: number;

    if (o.room && o.wall) {
      // room/wall form does not support sub_room IDs — use connects form instead
      if (subRoomToParent?.has(o.room)) {
        const reason = `room/wall form does not support sub_room ID "${o.room}". Use connects form instead`;
        console.warn(`Opening "${o.id}": ${reason}, skipping`);
        skipped.push({ id: o.id, reason, reasonCode: 'OTHER', room: o.room });
        continue;
      }

      const room = roomMap.get(o.room);
      if (!room) {
        const reason = `room "${o.room}" not found`;
        console.warn(`Opening "${o.id}": ${reason}, skipping`);
        skipped.push({ id: o.id, reason, reasonCode: 'UNKNOWN_ROOM_REF', room: o.room });
        continue;
      }

      targetWall = findRoomWall(walls, o.room, o.wall as WallSide, rooms);
      if (!targetWall) {
        const reason = `wall "${o.wall}" on room "${o.room}" not found`;
        console.warn(`Opening "${o.id}": ${reason}, skipping`);
        skipped.push({ id: o.id, reason, reasonCode: 'WALL_NOT_FOUND', room: o.room });
        continue;
      }

      const wallCenter = getWallCenter(targetWall);
      if (typeof o.position === 'string' && o.position === 'center') {
        cx = wallCenter.x;
        cy = wallCenter.y;
      } else if (typeof o.position === 'object' && o.position.offset !== undefined) {
        const isVWall = targetWall.x1 === targetWall.x2;
        const wallLength = isVWall
          ? Math.abs(targetWall.y2 - targetWall.y1)
          : Math.abs(targetWall.x2 - targetWall.x1);
        const halfOpening = o.size.w / 2;
        const minOffset = halfOpening;
        const maxOffset = wallLength - halfOpening;
        let offset = o.position.offset;
        if (offset < minOffset || offset > maxOffset) {
          console.warn(`Opening "${o.id}": offset ${offset} out of valid range [${minOffset}, ${maxOffset}], clamping`);
          offset = Math.max(minOffset, Math.min(maxOffset, offset));
        }
        if (isVWall) {
          cx = targetWall.x1;
          cy = Math.min(targetWall.y1, targetWall.y2) + offset;
        } else {
          cx = Math.min(targetWall.x1, targetWall.x2) + offset;
          cy = targetWall.y1;
        }
      } else {
        cx = wallCenter.x;
        cy = wallCenter.y;
      }
    } else if (o.connects) {
      // Door connecting two rooms — resolve sub_room IDs to parent for wall lookup
      const unknownRefs = o.connects.filter(ref => !isKnownId(ref));
      if (unknownRefs.length > 0) {
        const reason = `unknown room reference(s): ${unknownRefs.map(r => `"${r}"`).join(', ')}`;
        console.warn(`Opening "${o.id}": ${reason}, skipping`);
        skipped.push({ id: o.id, reason, reasonCode: 'UNKNOWN_ROOM_REF', connects: o.connects });
        continue;
      }

      const actualId0 = resolveRoomId(o.connects[0]);
      const actualId1 = resolveRoomId(o.connects[1]);

      // For sub_rooms within the same parent, find the explicit wall between them
      if (actualId0 === actualId1) {
        const isSub0 = subRoomToParent?.has(o.connects[0]) ?? false;
        const isSub1 = subRoomToParent?.has(o.connects[1]) ?? false;

        // Both must be sub_room IDs — connecting parent to its own sub_room is non-physical
        if (!isSub0 || !isSub1) {
          const reason = `connects [\"${o.connects[0]}\", \"${o.connects[1]}\"] resolves to same parent room "${actualId0}". Use two sub_room IDs for intra-room connections`;
          console.warn(`Opening "${o.id}": ${reason}, skipping`);
          skipped.push({ id: o.id, reason, reasonCode: 'OTHER', connects: o.connects });
          continue;
        }

        const parentRoom = roomMap.get(actualId0)!;
        const sr1 = resolvedSubRooms?.find(s => s.id === o.connects![0]);
        const sr2 = resolvedSubRooms?.find(s => s.id === o.connects![1]);
        targetWall = findSharedWallBetweenSubRooms(walls, parentRoom, sr1, sr2);
      } else {
        targetWall = findSharedWall(walls, actualId0, actualId1);
      }

      if (!targetWall) {
        const reason = `shared wall between "${o.connects[0]}" and "${o.connects[1]}" not found`;
        console.warn(`Opening "${o.id}": ${reason}, skipping`);
        skipped.push({ id: o.id, reason, reasonCode: 'NO_SHARED_WALL', connects: o.connects });
        continue;
      }

      const wallCenter = getWallCenter(targetWall);
      cx = wallCenter.x;
      cy = wallCenter.y;
    } else {
      const reason = 'no room/wall or connects specified';
      console.warn(`Opening "${o.id}": ${reason}, skipping`);
      skipped.push({ id: o.id, reason, reasonCode: 'OTHER' });
      continue;
    }

    const isVertical = targetWall.x1 === targetWall.x2;

    let wallSide: WallSide | undefined;
    if (o.room) {
      const room = roomMap.get(o.room);
      if (room) wallSide = wallSideForRoom(targetWall, room);
    } else if (o.connects) {
      const actualId0 = resolveRoomId(o.connects[0]);
      const room = roomMap.get(actualId0);
      if (room) wallSide = wallSideForRoom(targetWall, room);
    }

    resolved.push({
      id: o.id,
      type: o.type,
      style: o.style,
      wallId: targetWall.id,
      cx,
      cy,
      w: o.size.w,
      h: o.size.h,
      orientation: isVertical ? 'vertical' : 'horizontal',
      isExternal: targetWall.isExternal,
      wallSide,
      sill: o.sill,
      connectedRooms: o.connects,
    });
  }

  return { resolved, skipped };
}

function wallSideForRoom(wall: WallEdge, room: ResolvedRoom): WallSide | undefined {
  const isVertical = wall.x1 === wall.x2;

  // Check against each component rect's edges, verifying the wall segment
  // actually overlaps the rect's edge range (not just coordinate equality)
  for (const r of room.rects) {
    if (isVertical) {
      const wallMinY = Math.min(wall.y1, wall.y2);
      const wallMaxY = Math.max(wall.y1, wall.y2);
      // Wall must overlap the rect's Y range
      if (wallMaxY <= r.y || wallMinY >= r.y + r.h) continue;
      if (wall.x1 === r.x) return 'west';
      if (wall.x1 === r.x + r.w) return 'east';
    } else {
      const wallMinX = Math.min(wall.x1, wall.x2);
      const wallMaxX = Math.max(wall.x1, wall.x2);
      // Wall must overlap the rect's X range
      if (wallMaxX <= r.x || wallMinX >= r.x + r.w) continue;
      if (wall.y1 === r.y) return 'south';
      if (wall.y1 === r.y + r.h) return 'north';
    }
  }
  return undefined;
}

function findRoomWall(walls: WallEdge[], roomId: string, side: WallSide, rooms: ResolvedRoom[]): WallEdge | undefined {
  const room = rooms.find(r => r.id === roomId);
  if (!room) return undefined;

  const candidates = walls.filter(w => w.rooms.includes(roomId) && wallSideForRoom(w, room) === side);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  // Multiple walls on the same side (possible for multi-rect rooms).
  // Prefer exterior walls; among those (or all candidates if none are exterior),
  // pick the "outermost" wall for the requested side.
  const exterior = candidates.filter(w => w.isExternal);
  const pool = exterior.length > 0 ? exterior : candidates;

  switch (side) {
    case 'north': return pool.reduce((a, b) => a.y1 > b.y1 ? a : b); // highest y
    case 'south': return pool.reduce((a, b) => a.y1 < b.y1 ? a : b); // lowest y
    case 'east':  return pool.reduce((a, b) => a.x1 > b.x1 ? a : b); // highest x
    case 'west':  return pool.reduce((a, b) => a.x1 < b.x1 ? a : b); // lowest x
  }
}

function findSharedWall(walls: WallEdge[], room1: string, room2: string): WallEdge | undefined {
  return walls.find(w => w.rooms.includes(room1) && w.rooms.includes(room2));
}

function getWallCenter(wall: WallEdge): { x: number; y: number } {
  return {
    x: (wall.x1 + wall.x2) / 2,
    y: (wall.y1 + wall.y2) / 2,
  };
}

/**
 * Find the explicit wall that forms the boundary between two sub_rooms within the same parent.
 * Uses the resolved sub_room rects to find which wall sits on their shared edge.
 */
function findSharedWallBetweenSubRooms(
  walls: WallEdge[],
  parentRoom: ResolvedRoom,
  sr1?: ResolvedSubRoom,
  sr2?: ResolvedSubRoom,
): WallEdge | undefined {
  const r = parentRoom.boundingRect;
  const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  const EPS = 0.5;

  // Find all walls strictly inside this parent room (not on perimeter).
  // Use extractRoomPerimeterEdges to exclude walls that lie on the room's true outer boundary
  // (which may be inside boundingRect for multi-rect rooms).
  const perimeterEdges = extractRoomPerimeterEdges(parentRoom);
  const interiorWalls = walls.filter(w => {
    const isVertical = Math.abs(w.x1 - w.x2) < EPS;
    const isHorizontal = Math.abs(w.y1 - w.y2) < EPS;
    if (!isVertical && !isHorizontal) return false;

    // Must be inside bounding rect (not on bounding edges)
    if (isVertical) {
      if (w.x1 <= x0 + EPS || w.x1 >= x1 - EPS) return false;
      const wMinY = Math.min(w.y1, w.y2);
      const wMaxY = Math.max(w.y1, w.y2);
      if (!(wMaxY > y0 + EPS && wMinY < y1 - EPS)) return false;
    } else {
      if (w.y1 <= y0 + EPS || w.y1 >= y1 - EPS) return false;
      const wMinX = Math.min(w.x1, w.x2);
      const wMaxX = Math.max(w.x1, w.x2);
      if (!(wMaxX > x0 + EPS && wMinX < x1 - EPS)) return false;
    }

    // Exclude walls fully covered by the room's true perimeter (for multi-rect rooms).
    // Walls that only partially overlap with perimeter are kept (e.g., L-shaped room
    // partition that extends beyond the perimeter into the interior).
    const wallPos = isVertical ? w.x1 : w.y1;
    const wallStart = isVertical ? Math.min(w.y1, w.y2) : Math.min(w.x1, w.x2);
    const wallEnd = isVertical ? Math.max(w.y1, w.y2) : Math.max(w.x1, w.x2);
    const wallLen = wallEnd - wallStart;
    const orient = isVertical ? 'vertical' : 'horizontal';
    let perimeterCoverage = 0;
    for (const edge of perimeterEdges) {
      if (edge.orientation !== orient) continue;
      if (Math.abs(edge.pos - wallPos) > EPS) continue;
      const overlap = Math.min(wallEnd, edge.end) - Math.max(wallStart, edge.start);
      if (overlap > EPS) perimeterCoverage += overlap;
    }
    // Only exclude if the wall is fully covered by perimeter edges
    if (perimeterCoverage >= wallLen - EPS) return false;

    return true;
  });

  if (interiorWalls.length === 0) return undefined;
  if (interiorWalls.length === 1) return interiorWalls[0];

  // Strategy 1: Use barrierWallIds if available (works for multi-rect / cellBasedSplit)
  if (sr1?.barrierWallIds && sr2?.barrierWallIds) {
    const shared = interiorWalls.filter(w =>
      sr1.barrierWallIds!.includes(w.id) && sr2.barrierWallIds!.includes(w.id)
    );
    if (shared.length === 1) return shared[0];
  }

  // Strategy 2: Use sub_room rects to find the one on their shared boundary
  // Also verify that the wall segment overlaps the shared range between rects
  const rect1 = sr1?.rect;
  const rect2 = sr2?.rect;
  if (rect1 && rect2) {
    for (const w of interiorWalls) {
      const isVertical = Math.abs(w.x1 - w.x2) < EPS;
      if (isVertical) {
        const r1Right = Math.abs((rect1.x + rect1.w) - w.x1) < EPS;
        const r2Left = Math.abs(rect2.x - w.x1) < EPS;
        const r1Left = Math.abs(rect1.x - w.x1) < EPS;
        const r2Right = Math.abs((rect2.x + rect2.w) - w.x1) < EPS;
        if ((r1Right && r2Left) || (r1Left && r2Right)) {
          // Verify Y-range overlap between wall and shared rect range
          const sharedYStart = Math.max(rect1.y, rect2.y);
          const sharedYEnd = Math.min(rect1.y + rect1.h, rect2.y + rect2.h);
          const wMinY = Math.min(w.y1, w.y2);
          const wMaxY = Math.max(w.y1, w.y2);
          const overlap = Math.min(wMaxY, sharedYEnd) - Math.max(wMinY, sharedYStart);
          if (overlap > EPS) return w;
        }
      } else {
        const r1Top = Math.abs((rect1.y + rect1.h) - w.y1) < EPS;
        const r2Bottom = Math.abs(rect2.y - w.y1) < EPS;
        const r1Bottom = Math.abs(rect1.y - w.y1) < EPS;
        const r2Top = Math.abs((rect2.y + rect2.h) - w.y1) < EPS;
        if ((r1Top && r2Bottom) || (r1Bottom && r2Top)) {
          // Verify X-range overlap between wall and shared rect range
          const sharedXStart = Math.max(rect1.x, rect2.x);
          const sharedXEnd = Math.min(rect1.x + rect1.w, rect2.x + rect2.w);
          const wMinX = Math.min(w.x1, w.x2);
          const wMaxX = Math.max(w.x1, w.x2);
          const overlap = Math.min(wMaxX, sharedXEnd) - Math.max(wMinX, sharedXStart);
          if (overlap > EPS) return w;
        }
      }
    }
  }

  return undefined;
}

// ─── Sub-room resolution ───

/**
 * For partial walls (non-full partitions), flood-fill reaches everywhere so we
 * fall back to geometric splitting: use barrier positions as cutting lines and
 * assign each sub_room's rect based on where its seed point falls.
 */
function geometricSplit(
  room: ResolvedRoom,
  barriers: Barrier[],
  subRoomSpecs: { id: string; type: string; seed: { x: number; y: number } }[],
  moduleSize: number,
): ResolvedSubRoom[] {
  const r = room.boundingRect;
  const results: ResolvedSubRoom[] = [];

  // Collect all cut positions
  const vCuts = barriers.filter(b => b.kind === 'V').map(b => b.pos).sort((a, b) => a - b);
  const hCuts = barriers.filter(b => b.kind === 'H').map(b => b.pos).sort((a, b) => a - b);

  // Build intervals along each axis
  const xEdges = [r.x, ...new Set(vCuts), r.x + r.w];
  const yEdges = [r.y, ...new Set(hCuts), r.y + r.h];

  for (const srSpec of subRoomSpecs) {
    const seedMmX = srSpec.seed.x * moduleSize;
    const seedMmY = srSpec.seed.y * moduleSize;

    // Validate seed is within parent room bounds
    if (seedMmX < r.x || seedMmX >= r.x + r.w || seedMmY < r.y || seedMmY >= r.y + r.h) {
      throw new Error(
        `Sub-room "${srSpec.id}" seed (${srSpec.seed.x}, ${srSpec.seed.y}) is outside parent room "${room.id}" bounds`
      );
    }

    // Find which interval the seed falls into on each axis
    let xi0: number | undefined, xi1: number | undefined;
    for (let i = 0; i < xEdges.length - 1; i++) {
      if (seedMmX >= xEdges[i] && seedMmX < xEdges[i + 1]) {
        xi0 = xEdges[i];
        xi1 = xEdges[i + 1];
        break;
      }
    }

    let yi0: number | undefined, yi1: number | undefined;
    for (let i = 0; i < yEdges.length - 1; i++) {
      if (seedMmY >= yEdges[i] && seedMmY < yEdges[i + 1]) {
        yi0 = yEdges[i];
        yi1 = yEdges[i + 1];
        break;
      }
    }

    if (xi0 === undefined || xi1 === undefined || yi0 === undefined || yi1 === undefined) {
      throw new Error(
        `Sub-room "${srSpec.id}" seed (${srSpec.seed.x}, ${srSpec.seed.y}) did not match any interval in room "${room.id}"`
      );
    }

    const rect = { x: xi0, y: yi0, w: xi1 - xi0, h: yi1 - yi0 };
    const areaMm2 = rect.w * rect.h;

    results.push({
      id: srSpec.id,
      type: srSpec.type,
      parentRoomId: room.id,
      rect,
      areaMm2,
      isFullPartition: false,
    });
  }

  return results;
}

/**
 * Cell-based sub-room splitting for multi-rect rooms with partial partitions.
 * Uses the flood-fill context's cell grid to correctly handle concave room shapes
 * where the simple interval-based geometricSplit would include void regions.
 *
 * Each cell is assigned to the sub-room whose seed is on the same side of all barriers.
 */
function cellBasedSplit(
  room: ResolvedRoom,
  barriers: Barrier[],
  subRoomSpecs: { id: string; type: string; seed: { x: number; y: number } }[],
  moduleSize: number,
  ctx: FloodFillContext,
): ResolvedSubRoom[] {
  // Pre-compute barrier-signature for each cell (once, not per sub-room)
  const cellSignatures = new Map<number, string>();
  for (let i = 0; i < ctx.xs.length - 1; i++) {
    for (let j = 0; j < ctx.ys.length - 1; j++) {
      const idx = ctx.cellIdx.get(`${i},${j}`);
      if (idx === undefined) continue;
      const cx = (ctx.xs[i] + ctx.xs[i + 1]) / 2;
      const cy = (ctx.ys[j] + ctx.ys[j + 1]) / 2;
      const sig = barriers.map(b =>
        b.kind === 'V' ? (cx < b.pos ? -1 : 1) : (cy < b.pos ? -1 : 1)
      ).join(',');
      cellSignatures.set(idx, sig);
    }
  }

  // Track cell ownership for overlap/gap validation
  const cellOwner = new Map<number, string>();
  const results: ResolvedSubRoom[] = [];

  for (const srSpec of subRoomSpecs) {
    const seedMmX = srSpec.seed.x * moduleSize;
    const seedMmY = srSpec.seed.y * moduleSize;

    const inRoom = room.rects.some(r =>
      seedMmX >= r.x && seedMmX < r.x + r.w &&
      seedMmY >= r.y && seedMmY < r.y + r.h
    );
    if (!inRoom) {
      throw new Error(
        `Sub-room "${srSpec.id}" seed (${srSpec.seed.x}, ${srSpec.seed.y}) is outside parent room "${room.id}" bounds`
      );
    }

    // Compute seed's barrier-signature
    const seedSig = barriers.map(b => {
      if (b.kind === 'V') return seedMmX < b.pos ? -1 : 1;
      return seedMmY < b.pos ? -1 : 1;
    }).join(',');

    // Match cells by signature
    const reached = new Array(ctx.cellCount).fill(false) as boolean[];
    for (const [idx, sig] of cellSignatures) {
      if (sig === seedSig) {
        // Check for duplicate assignment
        const existing = cellOwner.get(idx);
        if (existing) {
          throw new Error(
            `Sub-room "${srSpec.id}" overlaps with "${existing}" in room "${room.id}" — seeds map to the same barrier-signature`
          );
        }
        cellOwner.set(idx, srSpec.id);
        reached[idx] = true;
      }
    }

    const region = summarizeRegion(ctx, reached, true);
    if (!region) {
      throw new Error(
        `Sub-room "${srSpec.id}" seed (${srSpec.seed.x}, ${srSpec.seed.y}) did not match any cells in room "${room.id}"`
      );
    }

    // Collect barrier wall IDs relevant to this sub-room
    const barrierWallIds = [...new Set(barriers.map(b => b.wallId))];

    results.push({
      id: srSpec.id,
      type: srSpec.type,
      parentRoomId: room.id,
      rect: region.bounds,
      areaMm2: region.areaMm2,
      isFullPartition: false,
      barrierWallIds,
    });
  }

  // Validate all cells are assigned (no gaps)
  const unassignedCount = [...cellSignatures.keys()].filter(idx => !cellOwner.has(idx)).length;
  if (unassignedCount > 0) {
    console.warn(
      `Room "${room.id}": ${unassignedCount} cell(s) not assigned to any sub_room in cellBasedSplit`
    );
  }

  return results;
}

function resolveSubRooms(
  roomSpecs: RoomSpec[],
  rooms: ResolvedRoom[],
  walls: WallEdge[],
  moduleSize: number,
): ResolvedSubRoom[] {
  const subRooms: ResolvedSubRoom[] = [];

  for (const spec of roomSpecs) {
    if (!spec.sub_rooms || spec.sub_rooms.length === 0) continue;

    const room = rooms.find(r => r.id === spec.id);
    if (!room) continue;

    const barriers = findBarriersInRoom(room, walls);
    if (barriers.length === 0) {
      console.warn(`Room "${spec.id}" has sub_rooms but no barriers (explicit walls) inside it`);
      continue;
    }

    const ctx = buildFloodFillContext(room, barriers);
    if (ctx.cellCount === 0) continue;

    // Test if barriers fully partition: flood-fill from first seed and check coverage
    const firstSeedMm = { x: spec.sub_rooms[0].seed.x * moduleSize, y: spec.sub_rooms[0].seed.y * moduleSize };
    const firstReached = floodFill(ctx, [firstSeedMm]);
    const firstReachedCount = firstReached.filter(v => v).length;
    const isFullPartition = firstReachedCount < ctx.cellCount;

    if (!isFullPartition) {
      // Partial wall — use appropriate splitting strategy
      if (room.rects.length > 1) {
        subRooms.push(...cellBasedSplit(room, barriers, spec.sub_rooms, moduleSize, ctx));
      } else {
        subRooms.push(...geometricSplit(room, barriers, spec.sub_rooms, moduleSize));
      }
      continue;
    }

    // Full partition — use flood-fill per seed
    for (const srSpec of spec.sub_rooms) {
      const seedMm = { x: srSpec.seed.x * moduleSize, y: srSpec.seed.y * moduleSize };
      const reached = floodFill(ctx, [seedMm]);
      const region = summarizeRegion(ctx, reached, true);

      if (!region) {
        throw new Error(
          `Sub-room "${srSpec.id}" seed (${srSpec.seed.x}, ${srSpec.seed.y}) did not reach any cells in room "${spec.id}". ` +
          `Check that the seed point is not inside a wall or outside the room bounds.`
        );
      }

      subRooms.push({
        id: srSpec.id,
        type: srSpec.type,
        parentRoomId: spec.id,
        rect: region.bounds,
        areaMm2: region.areaMm2,
        isFullPartition: true,
      });
    }
  }

  return subRooms;
}

// ─── Equipment resolution ───

function resolveEquipment(
  specs: EquipmentSpec[],
  rooms: ResolvedRoom[],
  walls: WallEdge[],
): ResolvedEquipment[] {
  const roomMap = new Map(rooms.map(r => [r.id, r]));
  const resolved: ResolvedEquipment[] = [];

  for (const eq of specs) {
    const room = roomMap.get(eq.room);
    if (!room) {
      throw new Error(`Equipment "${eq.id}": room "${eq.room}" not found`);
    }

    const preset = EQUIPMENT_PRESETS[eq.type];
    const specSize = eq.size ?? preset.defaultSize;

    // w = dimension along the wall, h = depth (perpendicular, into room)
    // The preset's defaultSize already encodes this correctly.
    // When user overrides size, w/h follow the same convention.
    const alongWall = specSize.w;
    const depth = specSize.h;

    // For north/south walls, along-wall = x direction
    // For east/west walls, along-wall = y direction
    const isHorizontalWall = eq.wall === 'north' || eq.wall === 'south';

    // Equipment bounding dimensions in mm coordinate system
    const eqW = isHorizontalWall ? alongWall : depth;
    const eqH = isHorizontalWall ? depth : alongWall;

    // Use bounding rect for placement
    const br = room.boundingRect;

    // Compute along-wall position
    let alongPos: number; // start position along the wall axis
    const wallLength = isHorizontalWall ? br.w : br.h;
    const alongDim = isHorizontalWall ? eqW : eqH;
    const wallStart = isHorizontalWall ? br.x : br.y;

    if (eq.position === 'center') {
      alongPos = wallStart + (wallLength - alongDim) / 2;
    } else {
      alongPos = wallStart + eq.position.offset;
    }

    // Compute perpendicular position (equipment pressed against wall inner face)
    let x: number, y: number;
    if (isHorizontalWall) {
      x = alongPos;
      if (eq.wall === 'south') {
        y = br.y; // south edge = room bottom
      } else {
        y = br.y + br.h - eqH; // north edge = room top
      }
    } else {
      y = alongPos;
      if (eq.wall === 'west') {
        x = br.x; // west edge = room left
      } else {
        x = br.x + br.w - eqW; // east edge = room right
      }
    }

    const targetWall = findRoomWall(walls, eq.room, eq.wall, rooms);
    resolved.push({
      id: eq.id,
      type: eq.type,
      roomId: eq.room,
      wallId: targetWall?.id ?? '',
      x, y,
      w: eqW,
      h: eqH,
      wallSide: eq.wall,
    });
  }

  return resolved;
}
