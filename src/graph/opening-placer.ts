/**
 * opening-placer: 接続エッジ・窓ヒント → OpeningSpec / EquipmentSpec 生成
 *
 * ConnectionEdge (door/sliding_door) → OpeningSpec (connects 形式)
 * WindowHint → OpeningSpec (room/wall 形式)
 * EquipmentPlacement → EquipmentSpec
 */

import type { WallSide, OpeningSpec, EquipmentSpec, EquipmentType } from '../types.js';
import type { FloorplanGraph, ConnectionEdge, RoomNode, PlacedRoom, WindowHint } from './types.js';
import { WINDOW_SIZE_PRESETS } from './types.js';
import { EQUIPMENT_PRESETS } from '../equipment-presets.js';

let openingCounter = 0;
let equipmentCounter = 0;

function nextOpeningId(prefix: string): string {
  return `${prefix}${++openingCounter}`;
}

function nextEquipmentId(prefix: string): string {
  return `${prefix}${++equipmentCounter}`;
}

/** ドア接続エッジのスタイルを archilang の style に変換 */
function resolveOpeningStyle(conn: ConnectionEdge): { type: string; style: string } {
  if (conn.type === 'sliding_door') {
    return { type: 'WD', style: '引き戸' };
  }
  if (conn.type === 'opening') {
    return { type: 'WD', style: '引き戸' }; // 開口 → 引き戸扱い
  }
  // door (default)
  return { type: 'WD', style: conn.opening_style ?? '片開き' };
}

/**
 * ConnectionEdge → OpeningSpec (ドア/引き戸)
 */
export function generateDoorOpenings(
  connections: ConnectionEdge[],
): OpeningSpec[] {
  openingCounter = 0;
  const openings: OpeningSpec[] = [];

  for (const conn of connections) {
    if (conn.type === 'adjacent_only') continue;

    const { type, style } = resolveOpeningStyle(conn);
    openings.push({
      id: nextOpeningId('D'),
      type,
      style,
      connects: [conn.from, conn.to],
      position: 'center',
      size: { w: 800, h: 2000 },
    });
  }

  return openings;
}

/**
 * WindowHint → OpeningSpec (窓)
 *
 * 各部屋の windows 配列から外壁面の窓を生成する。
 * 外壁面かどうかは配置結果から判定する。
 */
export function generateWindowOpenings(
  rooms: RoomNode[],
  placements: PlacedRoom[],
  totalGridX: number,
  totalGridY: number,
): OpeningSpec[] {
  const openings: OpeningSpec[] = [];
  const placementMap = new Map(placements.map(p => [p.id, p]));
  let windowCounter = 0;

  for (const room of rooms) {
    if (!room.windows) continue;
    const placement = placementMap.get(room.id);
    if (!placement) continue;

    for (const hint of room.windows) {
      // 外壁チェック
      if (!isExternalWall(placement, hint.wall, totalGridX, totalGridY)) continue;

      const preset = WINDOW_SIZE_PRESETS[hint.size ?? 'medium'];
      openings.push({
        id: `W${++windowCounter}`,
        type: 'AW',
        style: hint.style ?? '引違い窓',
        room: room.id,
        wall: hint.wall,
        position: 'center',
        size: { w: preset.w, h: preset.h },
        sill: preset.sill,
      });
    }
  }

  return openings;
}

/**
 * 自動窓生成: windows ヒントがない外壁面に自動で窓を追加。
 * LDK 等の主要居室は掃き出し窓（large）、その他は腰窓（medium）。
 */
export function generateAutoWindows(
  rooms: RoomNode[],
  placements: PlacedRoom[],
  totalGridX: number,
  totalGridY: number,
  orientation: WallSide,
): OpeningSpec[] {
  const openings: OpeningSpec[] = [];
  const placementMap = new Map(placements.map(p => [p.id, p]));
  const hasExplicitWindows = new Set(
    rooms.filter(r => r.windows && r.windows.length > 0).map(r => r.id)
  );

  // 窓不要タイプ
  const noWindowTypes = new Set(['トイレ', '浴室', 'WIC', 'クローゼット', 'パントリー', '廊下']);

  let windowCounter = 100; // 自動窓は W100〜

  for (const room of rooms) {
    if (hasExplicitWindows.has(room.id)) continue;
    if (noWindowTypes.has(room.type)) continue;

    const placement = placementMap.get(room.id);
    if (!placement) continue;

    // 外壁面を探す
    const sides: WallSide[] = ['south', 'north', 'east', 'west'];
    for (const side of sides) {
      if (!isExternalWall(placement, side, totalGridX, totalGridY)) continue;

      // 正面方位の居室は掃き出し窓、その他は腰窓
      const isMainFacing = side === orientation;
      const isLargeRoom = room.type.includes('LDK') || room.type.includes('LD') || room.type === '和室';
      const size = (isMainFacing && isLargeRoom) ? 'large' : 'medium';
      const preset = WINDOW_SIZE_PRESETS[size];

      openings.push({
        id: `W${++windowCounter}`,
        type: 'AW',
        style: '引違い窓',
        room: room.id,
        wall: side,
        position: 'center',
        size: { w: preset.w, h: preset.h },
        sill: preset.sill,
      });
      break; // 1部屋1窓で十分
    }
  }

  return openings;
}

/**
 * 玄関ドア生成: entry 制約から外壁面にドアを配置。
 */
export function generateEntryDoor(
  graph: FloorplanGraph,
  placements: PlacedRoom[],
  totalGridX: number,
  totalGridY: number,
): OpeningSpec | null {
  const entryConstraint = graph.constraints.find(c => c.type === 'entry');
  if (!entryConstraint || entryConstraint.rooms.length === 0) return null;

  const roomId = entryConstraint.rooms[0];
  const placement = placements.find(p => p.id === roomId);
  if (!placement) return null;

  // 正面方位の外壁にドアを配置
  const side = graph.meta.orientation;
  if (!isExternalWall(placement, side, totalGridX, totalGridY)) {
    // 正面が外壁でなければ、外壁面を探す
    const sides: WallSide[] = ['south', 'north', 'east', 'west'];
    for (const s of sides) {
      if (isExternalWall(placement, s, totalGridX, totalGridY)) {
        return makeEntryDoor(roomId, s);
      }
    }
    return null;
  }

  return makeEntryDoor(roomId, side);
}

function makeEntryDoor(roomId: string, wall: WallSide): OpeningSpec {
  return {
    id: 'ED1',
    type: 'AD',
    style: '片開き',
    room: roomId,
    wall,
    position: { offset: 500 },
    size: { w: 900, h: 2300 },
  };
}

/**
 * EquipmentPlacement → EquipmentSpec
 *
 * 同じ壁に複数設備がある場��は offset を連番にして重なりを回避する。
 */
export function generateEquipment(
  rooms: RoomNode[],
  placements: PlacedRoom[],
): EquipmentSpec[] {
  equipmentCounter = 0;
  const specs: EquipmentSpec[] = [];
  const placementMap = new Map(placements.map(p => [p.id, p]));

  for (const room of rooms) {
    if (!room.equipment) continue;
    const placement = placementMap.get(room.id);
    if (!placement) continue;

    // 壁ごとに設備をグルーピングして offset を算出
    const wallGroups = new Map<WallSide, Array<{ type: EquipmentType; wall: WallSide }>>();
    for (const eq of room.equipment) {
      const wall = eq.wall ?? pickEquipmentWall(placement, eq.type);
      if (!wallGroups.has(wall)) wallGroups.set(wall, []);
      wallGroups.get(wall)!.push({ type: eq.type, wall });
    }

    for (const [wall, group] of wallGroups) {
      let offset = 0;
      for (const eq of group) {
        const preset = EQUIPMENT_PRESETS[eq.type];
        if (!preset) continue;

        const prefix = equipmentPrefix(eq.type);
        const eqWidth = preset.defaultSize.w;

        specs.push({
          id: nextEquipmentId(prefix),
          type: eq.type,
          room: room.id,
          wall,
          position: group.length === 1 ? 'center' : { offset },
        });

        offset += eqWidth + 100; // 100mm gap between equipment
      }
    }
  }

  return specs;
}

// ─── helpers ───

function isExternalWall(
  placement: PlacedRoom,
  side: WallSide,
  totalGridX: number,
  totalGridY: number,
): boolean {
  switch (side) {
    case 'south': return placement.y === 0;
    case 'north': return placement.y + placement.h === totalGridY;
    case 'west':  return placement.x === 0;
    case 'east':  return placement.x + placement.w === totalGridX;
  }
}

function pickEquipmentWall(placement: PlacedRoom, _type: EquipmentType): WallSide {
  // デフォルト: 最も長い壁面を選択
  if (placement.w >= placement.h) {
    return 'south';  // 横長 → 南壁
  }
  return 'west';     // 縦長 → 西壁
}

function equipmentPrefix(type: EquipmentType): string {
  const map: Record<EquipmentType, string> = {
    kitchen_counter: 'K',
    unit_bath: 'UB',
    toilet: 'T',
    washbasin: 'WB',
    washing_machine: 'WM',
    refrigerator: 'REF',
  };
  return map[type];
}
