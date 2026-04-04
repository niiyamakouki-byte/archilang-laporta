/**
 * grid-packer: 制約付き矩形パッキング
 *
 * 2行レイアウト方式:
 *   行1（正面）: LDK等のパブリック部屋 → 正面（orientation側）に配置
 *   行2（奥側）: 寝室・水回り等 → 奥側に配置
 *
 * 帯間のドア接続を分析して、同じ行内の部屋が隣接するよう並び順を最適化する。
 */

import type { FloorplanGraph, ConnectionEdge, LayoutConstraint, PlacedRoom, PackingResult } from './types.js';
import type { RoomSize } from './room-sizer.js';
import { isFrontLow, getDepthAxis } from './zone-placer.js';

/**
 * メイン: グラフ + 部屋サイズ → グリッド配置結果
 */
export function packGrid(
  graph: FloorplanGraph,
  roomSizes: RoomSize[],
): PackingResult {
  const sizeMap = new Map(roomSizes.map(s => [s.id, s]));
  const depthAxis = getDepthAxis(graph.meta.orientation);
  const frontLow = isFrontLow(graph.meta.orientation);

  // 隣接制約マップを構築
  const adjacencyMap = buildAdjacencyMap(graph.connections, graph.constraints);

  // 部屋を2行に振り分ける
  const { frontRow, backRow } = assignToRows(graph, roomSizes);

  // 正面行の並び順を決定
  const frontOrdered = orderByAdjacency(frontRow, adjacencyMap);
  const frontWidth = frontOrdered.reduce((sum, r) => sum + r.w, 0);
  const backWidth = backRow.reduce((sum, r) => sum + r.w, 0);
  const maxWidth = Math.max(frontWidth, backWidth);

  // 正面行の仮配置（奥行の並び順決定に使う）
  const frontPreSpecs = distributeWidth(frontOrdered, maxWidth);

  // 奥行の並び順: 帯間接続先の横位置を考慮
  const backOrdered = orderBackRow(backRow, adjacencyMap, frontPreSpecs, graph.connections);

  // 2行を配置
  return layoutTwoRows(frontOrdered, backOrdered, sizeMap, depthAxis, frontLow);
}

// ─── Row assignment ───

/**
 * 部屋を正面行/奥行に振り分ける。
 *
 * ルール:
 *   - public ゾーンの部屋 → 正面行
 *   - public とドア接続があり、同じ行に入れたい部屋 → 正面行
 *   - それ以外 → 奥行
 */
function assignToRows(
  graph: FloorplanGraph,
  roomSizes: RoomSize[],
): { frontRow: RoomSize[]; backRow: RoomSize[] } {
  const sizeMap = new Map(roomSizes.map(s => [s.id, s]));
  const roomZone = new Map(graph.rooms.map(r => [r.id, r.zone]));

  // public ゾーンの部屋を特定
  const publicZoneIds = new Set(
    graph.zones.filter(z => z.type === 'public').map(z => z.id)
  );

  const frontIds = new Set<string>();
  const backIds = new Set<string>();

  // Step 1: public → 正面
  for (const room of graph.rooms) {
    if (publicZoneIds.has(room.zone)) {
      frontIds.add(room.id);
    }
  }

  // Step 2: 残りを奥に振り分け
  for (const room of graph.rooms) {
    if (!frontIds.has(room.id)) {
      backIds.add(room.id);
    }
  }

  const frontRow = roomSizes.filter(s => frontIds.has(s.id));
  const backRow = roomSizes.filter(s => backIds.has(s.id));

  return { frontRow, backRow };
}

// ─── Adjacency ───

function buildAdjacencyMap(
  connections: ConnectionEdge[],
  constraints: LayoutConstraint[],
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const ensure = (id: string) => { if (!adj.has(id)) adj.set(id, new Set()); };

  for (const conn of connections) {
    ensure(conn.from);
    ensure(conn.to);
    adj.get(conn.from)!.add(conn.to);
    adj.get(conn.to)!.add(conn.from);
  }

  for (const c of constraints) {
    if (c.type === 'adjacency' || c.type === 'cluster') {
      for (let i = 0; i < c.rooms.length; i++) {
        for (let j = i + 1; j < c.rooms.length; j++) {
          ensure(c.rooms[i]);
          ensure(c.rooms[j]);
          adj.get(c.rooms[i])!.add(c.rooms[j]);
          adj.get(c.rooms[j])!.add(c.rooms[i]);
        }
      }
    }
  }

  return adj;
}

/**
 * 隣接制約を考慮して部屋の並び順を決める（貪欲法）。
 */
function orderByAdjacency(
  rooms: RoomSize[],
  adjacencyMap: Map<string, Set<string>>,
): RoomSize[] {
  if (rooms.length <= 1) return rooms;

  const remaining = new Set(rooms.map(r => r.id));
  const roomMap = new Map(rooms.map(r => [r.id, r]));
  const result: RoomSize[] = [];

  // 最も接続が多い部屋から開始
  let current = rooms.reduce((best, r) => {
    const count = adjacencyMap.get(r.id)?.size ?? 0;
    const bestCount = adjacencyMap.get(best.id)?.size ?? 0;
    return count > bestCount ? r : best;
  });

  result.push(current);
  remaining.delete(current.id);

  while (remaining.size > 0) {
    const neighbors = adjacencyMap.get(current.id);
    let next: RoomSize | undefined;
    if (neighbors) {
      for (const nid of neighbors) {
        if (remaining.has(nid)) {
          next = roomMap.get(nid);
          break;
        }
      }
    }
    if (!next) {
      let maxArea = -1;
      for (const id of remaining) {
        const r = roomMap.get(id)!;
        if (r.w * r.h > maxArea) {
          maxArea = r.w * r.h;
          next = r;
        }
      }
    }
    if (!next) break;

    result.push(next);
    remaining.delete(next.id);
    current = next;
  }

  return result;
}

// ─── Back row ordering with cross-band awareness ───

/**
 * 奥行の並び順を帯間接続（正面行の横位置）を考慮して決定する。
 *
 * 戦略: 正面行の各部屋に「奥行接続先」を対応付け、正面行の左→右順に奥行部屋を配置。
 * 複数の正面部屋に接続する奥行部屋は、最も左にある正面部屋に対応付ける。
 */
function orderBackRow(
  rooms: RoomSize[],
  adjacencyMap: Map<string, Set<string>>,
  frontSpecs: Array<{ id: string; x: number; w: number }>,
  connections: ConnectionEdge[],
): RoomSize[] {
  if (rooms.length <= 1) return rooms;

  const frontSet = new Set(frontSpecs.map(s => s.id));
  const backSet = new Set(rooms.map(r => r.id));
  const roomMap = new Map(rooms.map(r => [r.id, r]));

  // 正面行の部屋ごとに、その上に来るべき奥行部屋のグループを作る
  // frontRoomId → backRoomIds (in priority order)
  const groups = new Map<string, string[]>();
  const assigned = new Set<string>();

  // 各正面部屋を左→右順に処理
  for (const fSpec of frontSpecs) {
    groups.set(fSpec.id, []);
  }

  // Step 1: 直接ドア接続のある奥行部屋を正面部屋に対応付け
  for (const fSpec of frontSpecs) {
    const fNeighbors = adjacencyMap.get(fSpec.id);
    if (!fNeighbors) continue;
    for (const nid of fNeighbors) {
      if (backSet.has(nid) && !assigned.has(nid)) {
        groups.get(fSpec.id)!.push(nid);
        assigned.add(nid);
      }
    }
  }

  // Step 2: 未割当の奥行部屋を、割当済み部屋との隣接関係で割り振る（BFS的伝播）
  for (let pass = 0; pass < 5; pass++) {
    for (const room of rooms) {
      if (assigned.has(room.id)) continue;
      const neighbors = adjacencyMap.get(room.id);
      if (!neighbors) continue;
      for (const nid of neighbors) {
        if (assigned.has(nid)) {
          // nid が属するグループと同じグ��ープに割り当て
          for (const [fid, group] of groups) {
            if (group.includes(nid)) {
              group.push(room.id);
              assigned.add(room.id);
              break;
            }
          }
          break;
        }
      }
    }
  }

  // Step 3: まだ未割当の部屋は最後の正面部屋のグループに追加
  for (const room of rooms) {
    if (!assigned.has(room.id)) {
      const lastFront = frontSpecs[frontSpecs.length - 1];
      groups.get(lastFront.id)!.push(room.id);
    }
  }

  // グループ内の並び順を隣接制約で最適化して、正面行の左→右順にフラット化
  const result: RoomSize[] = [];
  for (const fSpec of frontSpecs) {
    const group = groups.get(fSpec.id)!;
    const groupRooms = group.map(id => roomMap.get(id)!).filter(Boolean);
    const ordered = orderByAdjacency(groupRooms, adjacencyMap);
    result.push(...ordered);
  }

  return result;
}

// ─── Two-row layout ───

/**
 * 2行配置を実行する。
 * 各行の幅を揃え、最大幅に合わせて最後の部屋を拡張する。
 */
function layoutTwoRows(
  frontRow: RoomSize[],
  backRow: RoomSize[],
  sizeMap: Map<string, RoomSize>,
  depthAxis: 'x' | 'y',
  frontLow: boolean,
): PackingResult {
  const placements: PlacedRoom[] = [];

  // 各行の高さ
  const frontHeight = frontRow.length > 0 ? Math.max(...frontRow.map(r => r.h)) : 0;
  const backHeight = backRow.length > 0 ? Math.max(...backRow.map(r => r.h)) : 0;

  // 各行の幅
  const frontWidth = frontRow.reduce((sum, r) => sum + r.w, 0);
  const backWidth = backRow.reduce((sum, r) => sum + r.w, 0);
  const maxWidth = Math.max(frontWidth, backWidth);

  // 正面行の配置（不足幅は均等配分）
  const frontSpecs = distributeWidth(frontRow, maxWidth);

  // 奥行の配置（不足幅は均等配分）
  const backSpecs = distributeWidth(backRow, maxWidth);

  // 座標を割り当て
  const rows = frontLow
    ? [{ specs: frontSpecs, height: frontHeight, y: 0 },
       { specs: backSpecs, height: backHeight, y: frontHeight }]
    : [{ specs: backSpecs, height: backHeight, y: 0 },
       { specs: frontSpecs, height: frontHeight, y: backHeight }];

  for (const row of rows) {
    for (const room of row.specs) {
      if (depthAxis === 'y') {
        placements.push({ id: room.id, x: room.x, y: row.y, w: room.w, h: row.height });
      } else {
        placements.push({ id: room.id, x: row.y, y: room.x, w: row.height, h: room.w });
      }
    }
  }

  const { xSpans, ySpans } = deriveSpans(placements);

  return {
    xSpans,
    ySpans,
    placements,
    totalGridX: xSpans.reduce((a, b) => a + b, 0),
    totalGridY: ySpans.reduce((a, b) => a + b, 0),
  };
}

/**
 * 部屋を横方向に並べ、不足幅を均等に配分する。
 */
function distributeWidth(
  rooms: RoomSize[],
  targetWidth: number,
): Array<{ id: string; x: number; w: number }> {
  if (rooms.length === 0) return [];

  const totalW = rooms.reduce((sum, r) => sum + r.w, 0);
  const deficit = targetWidth - totalW;

  // 不足分を各部屋に比例配分（面積が大きい部屋により多く配分）
  const specs: Array<{ id: string; x: number; w: number }> = [];
  let curX = 0;
  let distributed = 0;

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    let extra = 0;
    if (deficit > 0 && totalW > 0) {
      if (i === rooms.length - 1) {
        extra = deficit - distributed; // 端数を最後に
      } else {
        extra = Math.round(deficit * room.w / totalW);
        distributed += extra;
      }
    }
    specs.push({ id: room.id, x: curX, w: room.w + extra });
    curX += room.w + extra;
  }

  return specs;
}

/**
 * 配置結果からグリッドの x_spans / y_spans を導出する。
 */
function deriveSpans(
  placements: PlacedRoom[],
): { xSpans: number[]; ySpans: number[] } {
  const maxX = Math.max(...placements.map(p => p.x + p.w));
  const maxY = Math.max(...placements.map(p => p.y + p.h));

  const xBoundaries = new Set<number>([0, maxX]);
  const yBoundaries = new Set<number>([0, maxY]);
  for (const p of placements) {
    xBoundaries.add(p.x);
    xBoundaries.add(p.x + p.w);
    yBoundaries.add(p.y);
    yBoundaries.add(p.y + p.h);
  }

  const xSorted = [...xBoundaries].sort((a, b) => a - b);
  const ySorted = [...yBoundaries].sort((a, b) => a - b);

  const xSpans = xSorted.slice(1).map((v, i) => v - xSorted[i]);
  const ySpans = ySorted.slice(1).map((v, i) => v - ySorted[i]);

  return { xSpans, ySpans };
}
