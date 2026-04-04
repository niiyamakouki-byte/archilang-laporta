/**
 * zone-placer: ゾーン → 方位配置の決定
 *
 * 建物の向き（orientation）とゾーンの preferred_side から、
 * 各ゾーンをグリッド上のどの「帯」に配置するかを決定する。
 *
 * 基本方針:
 *   - public（LDK等）→ 正面側（orientation 方向）
 *   - private（寝室等）→ publicに隣接（ドア接続があるため）
 *   - water（水回り）→ 北側 or 奥側にクラスタリング
 *
 * 帯��のドア接続がある場合、帯の順序を調整して隣接させる。
 */

import type { WallSide } from '../types.js';
import type { FloorplanGraph, Zone, ZoneType, ConnectionEdge } from './types.js';

/** ゾーンの配置優先順（正面から奥へ） */
const ZONE_ORDER: Record<ZoneType, number> = {
  public: 0,       // 正面側
  circulation: 1,  // 中間
  service: 2,      // 中間〜奥
  private: 3,      // public に隣接
  water: 4,        // 奥側
};

export interface ZoneBand {
  zone: Zone;
  /** この帯に属する部屋 ID */
  roomIds: string[];
  /** 配置方向の priority (0 = 正面側, 大きい = 奥側) */
  priority: number;
  /** 明示的な preferred_side があるか */
  hasSidePreference: boolean;
}

/**
 * 正面方向に対する「奥行き軸」を返す。
 */
export function getDepthAxis(orientation: WallSide): 'x' | 'y' {
  return (orientation === 'south' || orientation === 'north') ? 'y' : 'x';
}

/**
 * 正面側が座標の小さい方か大きい方かを返す。
 */
export function isFrontLow(orientation: WallSide): boolean {
  return orientation === 'south' || orientation === 'west';
}

/**
 * ゾーンを奥行き方向の帯に分割する。
 * ドア接続を考慮して帯の順序を最適化する。
 */
export function placeZones(graph: FloorplanGraph): ZoneBand[] {
  const { zones, rooms, connections } = graph;

  // 各ゾーンに属する部屋を収集
  const bandMap = new Map<string, ZoneBand>();
  for (const zone of zones) {
    bandMap.set(zone.id, {
      zone,
      roomIds: [],
      priority: ZONE_ORDER[zone.type] ?? 2,
      hasSidePreference: !!zone.preferred_side,
    });
  }

  const roomZoneMap = new Map<string, string>(); // roomId → zoneId
  for (const room of rooms) {
    const band = bandMap.get(room.zone);
    if (band) {
      band.roomIds.push(room.id);
      roomZoneMap.set(room.id, room.zone);
    }
  }

  const bands = [...bandMap.values()].filter(b => b.roomIds.length > 0);

  // 帯間のドア接続を検出
  const zonePairConnections = new Map<string, number>(); // "zoneA|zoneB" → connection count
  for (const conn of connections) {
    if (conn.type === 'adjacent_only') continue;
    const zoneA = roomZoneMap.get(conn.from);
    const zoneB = roomZoneMap.get(conn.to);
    if (zoneA && zoneB && zoneA !== zoneB) {
      const key = [zoneA, zoneB].sort().join('|');
      zonePairConnections.set(key, (zonePairConnections.get(key) ?? 0) + 1);
    }
  }

  // 帯間接続に基づいてグラフ順序を調整
  // BFS: public から出発し、接続が多い帯を隣に配置
  if (zonePairConnections.size > 0) {
    const ordered = orderBandsByConnections(bands, zonePairConnections);
    return ordered;
  }

  // 接続情報がなければデフォルト priority 順
  bands.sort((a, b) => a.priority - b.priority);
  return bands;
}

/**
 * 帯間接続を考慮した帯順序の決定（BFS法）。
 * public 帯から出発し、ドア接続が多い帯を隣に配置する。
 */
function orderBandsByConnections(
  bands: ZoneBand[],
  connections: Map<string, number>,
): ZoneBand[] {
  const bandById = new Map(bands.map(b => [b.zone.id, b]));
  const remaining = new Set(bands.map(b => b.zone.id));
  const result: ZoneBand[] = [];

  // public 帯から開始
  let start = bands.find(b => b.zone.type === 'public');
  if (!start) start = bands[0];

  result.push(start);
  remaining.delete(start.zone.id);

  while (remaining.size > 0) {
    const current = result[result.length - 1];
    let bestNext: ZoneBand | undefined;
    let bestScore = -1;

    for (const id of remaining) {
      const key = [current.zone.id, id].sort().join('|');
      const connCount = connections.get(key) ?? 0;
      // スコア: ドア接続数（高いほど優先）
      if (connCount > bestScore) {
        bestScore = connCount;
        bestNext = bandById.get(id);
      }
    }

    // 接続がないなら priority 順で最小のものを選択
    if (!bestNext || bestScore === 0) {
      let minPriority = Infinity;
      for (const id of remaining) {
        const band = bandById.get(id)!;
        if (band.priority < minPriority) {
          minPriority = band.priority;
          bestNext = band;
        }
      }
    }

    if (!bestNext) break;
    result.push(bestNext);
    remaining.delete(bestNext.zone.id);
  }

  return result;
}

/**
 * 正面方向と直交する「横軸」の方位を返す。
 */
export function getLateralSides(orientation: WallSide): [WallSide, WallSide] {
  if (orientation === 'south' || orientation === 'north') {
    return ['west', 'east'];
  }
  return ['south', 'north'];
}
