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
  lines.push('  openings: []');
  lines.push('  # ↑ 開口部は手動追記してください。例:');
  lines.push('  #   - id: W1');
  lines.push('  #     type: AW');
  lines.push('  #     style: 引違い窓');
  lines.push(`  #     room: ${input.rooms[0].id}`);
  lines.push('  #     wall: south');
  lines.push('  #     position: center');
  lines.push('  #     size: { w: 1690, h: 1100 }');
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
