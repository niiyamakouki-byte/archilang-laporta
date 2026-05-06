/**
 * scaffolder.ts — 自然言語/JSON 仕様から ArchiLang YAML 雛形を生成する。
 *
 * Phase 3 の足がかり: 部屋名と面積のリストから、最低限の grid_rect 配置を
 * 決めた YAML を吐く。レイアウトは「横一列ストリップ」で決め打ち
 * (高さ固定、幅はそれぞれの面積から計算)。完璧な配置ではないので、
 * 利用者は出力を見ながら手で調整する想定。
 *
 * 910mm shaku grid 前提。
 */

const GRID_M = 0.91;          // 910mm grid edge in metres
const GRID_AREA_M2 = GRID_M * GRID_M; // 0.8281 m²/cell

/** scaffold 入力の 1 部屋 */
export interface ScaffoldRoom {
  id: string;
  type: string;
  area_m2: number;
}

/** scaffold 入力全体 */
export interface ScaffoldInput {
  name?: string;
  structure?: string;            // e.g. 木造軸組 / 鉄骨造 / RC造
  ceiling_height_mm?: number;     // 既定 2400mm
  /** 一列に並べる際の縦方向 grid 数。既定 4 (= 3640mm) */
  strip_height_grids?: number;
  rooms: ScaffoldRoom[];
}

// 玄関/entrance タイプ判定
const ENTRANCE_TYPES = ['玄関', 'entrance', 'genkan'];
// 居室タイプ (室内ドアを付ける対象)
const LIVING_TYPES = ['ldk', 'ld', 'dk', '居間', '台所', 'kitchen', 'living',
  '寝室', 'bedroom', '和室', 'washitsu', '洋室', '書斎', 'study',
  '子供室', '個室', '部屋'];
// 浴室/トイレタイプ (小窓を付ける対象)
const WET_TYPES = ['浴室', 'bath', '風呂', 'お風呂', 'ユニットバス',
  'トイレ', 'toilet', 'wc', '洗面所', 'washroom'];

function matchesTypeList(type: string, list: string[]): boolean {
  const lower = type.toLowerCase();
  return list.some(k => lower.includes(k.toLowerCase()));
}

/**
 * 雛形 YAML 文字列を返す。
 *
 * レイアウト方針 (v0.1):
 *   - 全部屋を 1 列で左→右に並べる
 *   - 各部屋の高さ = strip_height_grids (既定 4)
 *   - 各部屋の幅 = ceil(area_m2 / (height * GRID_AREA_M2))
 *
 * 面積精度は ±1 grid の誤差を許容。手動調整前提のスカフォルド。
 */
export function scaffoldYaml(input: ScaffoldInput): string {
  if (!input.rooms || input.rooms.length === 0) {
    throw new Error('scaffold input must list at least one room');
  }
  const stripH = input.strip_height_grids ?? 4;
  if (stripH < 2) {
    throw new Error('strip_height_grids must be >= 2');
  }

  const ceilingHeight = input.ceiling_height_mm ?? 2400;
  const structure = input.structure ?? '木造軸組';
  const stripAreaPerCol = stripH * GRID_AREA_M2;

  const lines: string[] = [];
  lines.push('# 自動生成 scaffold (archilang-laporta scaffold)');
  if (input.name) {
    lines.push(`# project: ${input.name}`);
  }
  lines.push('# 1列ストリップ配置。配置は手動で調整してください。');
  lines.push('');
  lines.push('archilang: "0.2"');
  lines.push('');
  lines.push('site:');
  lines.push('  orientation: south');
  lines.push('');
  lines.push('building:');
  lines.push(`  structure: ${structure}`);
  lines.push('  module: shaku   # 910mm');
  lines.push('  stories: 1');
  lines.push('  defaults:');
  lines.push(`    ceiling_height: ${ceilingHeight}mm`);
  lines.push('    external_wall:');
  lines.push('      thickness: 150mm');
  lines.push('    internal_wall:');
  lines.push('      partition: 100mm');
  lines.push('');
  lines.push('rendering:');
  lines.push('  grid_lines:');
  lines.push('    enabled: true');
  lines.push('  area_table:');
  lines.push('    enabled: true');
  lines.push('');
  lines.push('geometry:');
  lines.push('  grids:');
  lines.push('    module: 910mm');

  // 各部屋の幅を計算
  const xSpans: number[] = [];
  const placements: { id: string; type: string; xStart: number; w: number }[] = [];
  let xCursor = 0;
  for (const room of input.rooms) {
    if (room.area_m2 <= 0) {
      throw new Error(`room ${room.id} has non-positive area_m2`);
    }
    const w = Math.max(1, Math.ceil(room.area_m2 / stripAreaPerCol));
    xSpans.push(w);
    placements.push({ id: room.id, type: room.type, xStart: xCursor, w });
    xCursor += w;
  }

  lines.push('    1F:');
  lines.push(`      x_spans: [${xSpans.join(', ')}]`);
  lines.push(`      y_spans: [${stripH}]`);
  lines.push('');
  lines.push('  rooms:');
  for (const p of placements) {
    lines.push(`    - id: ${p.id}`);
    lines.push('      floor: 1F');
    lines.push(`      type: ${p.type}`);
    lines.push(`      grid_rect: { x: ${p.xStart}, y: 0, w: ${p.w}, h: ${stripH} }`);
  }
  lines.push('');

  // --- Default openings ---
  const openingLines: string[] = [];
  let openingIdx = 1;
  // Track which room-pair connects have already been emitted to avoid duplicates
  const emittedConnects = new Set<string>();

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];

    if (matchesTypeList(p.type, ENTRANCE_TYPES)) {
      // 玄関ドア: 南面外壁に幅900mmの片開きドア
      openingLines.push(`    - id: ED${openingIdx++}`);
      openingLines.push('      type: AD');
      openingLines.push('      style: 片開き');
      openingLines.push(`      room: ${p.id}`);
      openingLines.push('      wall: south');
      openingLines.push('      position: center');
      openingLines.push('      size: { w: 900, h: 2300 }');
    } else if (matchesTypeList(p.type, LIVING_TYPES)) {
      // 居室: 右隣の部屋との室内ドア (connects形式、重複防止)
      const neighbor = placements[i + 1] ?? placements[i - 1];
      if (neighbor && !matchesTypeList(neighbor.type, ENTRANCE_TYPES)) {
        const pairKey = [p.id, neighbor.id].sort().join('|');
        if (!emittedConnects.has(pairKey)) {
          emittedConnects.add(pairKey);
          // connects形式: resolver が共有壁を自動検出
          openingLines.push(`    - id: D${openingIdx++}`);
          openingLines.push('      type: WD');
          openingLines.push('      style: 片開き');
          openingLines.push(`      connects: [${p.id}, ${neighbor.id}]`);
          openingLines.push('      size: { w: 800, h: 2000 }');
        }
      }
    } else if (matchesTypeList(p.type, WET_TYPES)) {
      // 浴室・トイレ: 北面に小窓
      openingLines.push(`    - id: W${openingIdx++}`);
      openingLines.push('      type: AW');
      openingLines.push('      style: 引違い窓');
      openingLines.push(`      room: ${p.id}`);
      openingLines.push('      wall: north');
      openingLines.push('      position: center');
      openingLines.push('      size: { w: 600, h: 600 }');
      openingLines.push('      sill: 1200');
    }
  }

  if (openingLines.length > 0) {
    lines.push('  openings:');
    for (const ol of openingLines) {
      lines.push(ol);
    }
  } else {
    lines.push('  openings: []');
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * 簡易 NL パーサ。"LDK 24m2, 寝室 12m2, 浴室 4m2" のようなカンマ区切り
 * 入力を ScaffoldRoom[] に変換する。番号は id に付与する (room1, room2 ...)。
 */
export function parseRoomList(text: string): ScaffoldRoom[] {
  const rooms: ScaffoldRoom[] = [];
  const parts = text.split(/[,、，\n]/).map(s => s.trim()).filter(Boolean);
  let counter = 1;
  for (const part of parts) {
    // "LDK 24m2" / "LDK 24㎡" / "LDK 24" のいずれにも対応
    const m = part.match(/^(\S+)\s+([\d.]+)\s*(?:m2|㎡|m²|平米)?$/i);
    if (!m) {
      throw new Error(`could not parse room spec: '${part}'`);
    }
    const type = m[1];
    const area = parseFloat(m[2]);
    if (!Number.isFinite(area) || area <= 0) {
      throw new Error(`invalid area in '${part}'`);
    }
    rooms.push({ id: `room${counter}`, type, area_m2: area });
    counter += 1;
  }
  return rooms;
}
