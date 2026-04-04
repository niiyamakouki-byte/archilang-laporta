/**
 * room-sizer: 畳数 → グリッドサイズ変換
 *
 * 1畳 = 910mm × 1820mm = 1 × 2 グリッド (shaku module)
 * 畳数からグリッドの w × h を算出し、最小幅/奥行制約を満たす組み合わせを選ぶ。
 */

import type { RoomNode } from './types.js';
import { ROOM_TYPE_DEFAULTS } from './types.js';

export interface RoomSize {
  id: string;
  w: number;  // grid width
  h: number;  // grid height
}

/**
 * 畳数を shaku グリッドの面積（グリッド数）に変換。
 * 1畳 = 2 グリッドセル (1×2)
 */
function tatamiToGridCells(tatami: number): number {
  return Math.ceil(tatami * 2);
}

/**
 * 目標グリッドセル数を満たす w×h の候補を列挙。
 * 制約: minW <= w, minD <= h, w*h >= targetCells
 * 正方形に近い形状を優先（アスペクト比ペナルティ最小化）。
 */
function findBestDimensions(
  targetCells: number,
  minW: number,
  minD: number,
): { w: number; h: number } {
  let best = { w: minW, h: Math.max(minD, Math.ceil(targetCells / minW)) };
  let bestScore = Infinity;

  // 上限: targetCells の2倍幅まで探索
  const maxDim = Math.max(targetCells, 12);

  for (let w = minW; w <= maxDim; w++) {
    const h = Math.max(minD, Math.ceil(targetCells / w));
    if (w * h < targetCells) continue;

    // スコア: アスペクト比の偏り + 余剰面積
    const ratio = Math.max(w / h, h / w);
    const waste = w * h - targetCells;
    const score = ratio * 2 + waste * 0.5;

    if (score < bestScore) {
      bestScore = score;
      best = { w, h };
    }
  }

  return best;
}

/**
 * RoomNode 配列からグリッドサイズを算出する。
 */
export function sizeRooms(rooms: RoomNode[]): RoomSize[] {
  return rooms.map(room => {
    const defaults = ROOM_TYPE_DEFAULTS[room.type];
    const tatami = room.target_area_tatami ?? defaults?.tatami ?? 4;
    const minW = room.min_width_grid ?? defaults?.minW ?? 2;
    const minD = room.min_depth_grid ?? defaults?.minD ?? 2;

    const targetCells = tatamiToGridCells(tatami);
    const { w, h } = findBestDimensions(targetCells, minW, minD);

    return { id: room.id, w, h };
  });
}
