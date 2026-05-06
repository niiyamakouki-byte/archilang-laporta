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
  const rawStripH = input.strip_height_grids ?? 4;
  if (!Number.isFinite(rawStripH) || rawStripH < 2 || rawStripH > 100) {
    throw new Error('strip_height_grids must be an integer between 2 and 100');
  }
  const stripH = Math.trunc(rawStripH);

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
    if (!Number.isFinite(room.area_m2) || room.area_m2 <= 0) {
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
 *
 * 対応パターン:
 *   (a) 全角カンマ「、」/ 半角カンマ「,」区切り
 *   (b) 「と」区切り — "LDKと寝室 12と浴室 4"
 *   (c) 面積省略 → 部屋タイプ別デフォルト面積を補完
 *   (d) 個数指定 — "寝室×2 各12㎡" / "寝室2部屋 12㎡" → bed1, bed2 展開
 *   (e) 単位省略 — "LDK 24" で ㎡ 推定 (既存)
 *   (f) グレード suffix — "LDK 24㎡(高級)" の注記をストリップ
 */

/** 全角数字 (０-９、．) を半角に正規化する */
function normalizeFullWidthDigits(s: string): string {
  return s
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30))
    .replace(/．/g, '.');
}

/** 部屋タイプ別デフォルト面積 (㎡)。面積が省略された場合に補完する。 */
const DEFAULT_AREA_M2: Record<string, number> = {
  ldk: 20,
  ld: 16,
  dk: 14,
  k: 8,
  寝室: 10,
  bedroom: 10,
  洋室: 10,
  和室: 10,
  子供室: 8,
  個室: 8,
  書斎: 6,
  study: 6,
  浴室: 4,
  bath: 4,
  風呂: 4,
  ユニットバス: 4,
  トイレ: 2,
  toilet: 2,
  wc: 2,
  洗面: 3,
  洗面所: 3,
  washroom: 3,
  玄関: 3,
  entrance: 3,
  genkan: 3,
  廊下: 4,
  corridor: 4,
  hall: 4,
};

/** 部屋タイプから既定面積を引く (大小無視)。ヒットしなければ null。 */
function lookupDefaultArea(type: string): number | null {
  const lower = type.toLowerCase();
  for (const [key, val] of Object.entries(DEFAULT_AREA_M2)) {
    if (lower === key.toLowerCase()) return val;
  }
  return null;
}

const MAX_ROOM_LIST_BYTES = 65_536; // 64 KB — prevents pathological inputs

export function parseRoomList(text: string): ScaffoldRoom[] {
  if (Buffer.byteLength(text, 'utf8') > MAX_ROOM_LIST_BYTES) {
    throw new Error(`parseRoomList: input too large (max ${MAX_ROOM_LIST_BYTES} bytes)`);
  }
  const rooms: ScaffoldRoom[] = [];

  // (b) 「と」区切りを追加。既存の ,、，\n に加える。
  const parts = text
    .split(/[,、，\nと]/)
    .map(s => normalizeFullWidthDigits(s.trim()))
    .filter(Boolean);

  let counter = 1;

  // typeごとのサブ連番 (個数展開で同 type が複数になる場合に使用)
  const typeSubCounter: Record<string, number> = {};

  for (const raw of parts) {
    // (f) グレード suffix — 括弧内注記をストリップ (例: "(高級)" "(グレードA)")
    const part = raw.replace(/[（(][^）)]*[）)]/g, '').trim();
    if (!part) continue;

    // (d) 個数指定パターン1: "寝室×2 各12㎡" / "寝室×2 12㎡" / "寝室×2"
    const mCount1 = part.match(
      /^(\S+?)[×x*](\d+)\s*(?:各\s*)?([\d.]+)?\s*(?:m2|㎡|m²|平米)?$/i,
    );
    // (d) 個数指定パターン2: "寝室2部屋 12㎡" / "寝室2室 12"
    const mCount2 = part.match(
      /^(\S+?)(\d+)(?:部屋|室|rooms?)\s*(?:各\s*)?([\d.]+)?\s*(?:m2|㎡|m²|平米)?$/i,
    );

    const mCount = mCount1 ?? mCount2;
    if (mCount) {
      const type = mCount[1];
      const count = parseInt(mCount[2], 10);
      const areaRaw = mCount[3] ? parseFloat(mCount[3]) : null;

      if (!Number.isFinite(count) || count < 1 || count > 99) {
        throw new Error(`invalid room count in '${part}'`);
      }

      let area: number;
      if (areaRaw !== null) {
        if (!Number.isFinite(areaRaw) || areaRaw <= 0) {
          throw new Error(`invalid area in '${part}'`);
        }
        area = areaRaw;
      } else {
        const defaultArea = lookupDefaultArea(type);
        if (defaultArea === null) {
          throw new Error(`could not parse room spec: '${part}'`);
        }
        area = defaultArea;
      }

      const typeKey = type.toLowerCase();
      if (typeSubCounter[typeKey] === undefined) typeSubCounter[typeKey] = 1;
      for (let i = 0; i < count; i++) {
        rooms.push({
          id: `room${counter}`,
          type: `${type}${typeSubCounter[typeKey]}`,
          area_m2: area,
        });
        counter += 1;
        typeSubCounter[typeKey] += 1;
      }
      continue;
    }

    // 通常パターン: "LDK 24m2" / "LDK 24㎡" / "LDK 24" / "LDK" (面積省略)
    // (c) 面積なし → タイプ名のみ → デフォルト補完
    const mWithArea = part.match(/^(\S+)\s+([\d.]+)\s*(?:m2|㎡|m²|平米)?$/i);
    const mTypeOnly = !mWithArea ? part.match(/^(\S+)$/) : null;

    let type: string;
    let area: number;

    if (mWithArea) {
      type = mWithArea[1];
      area = parseFloat(mWithArea[2]);
      if (!Number.isFinite(area) || area <= 0) {
        throw new Error(`invalid area in '${part}'`);
      }
    } else if (mTypeOnly) {
      type = mTypeOnly[1];
      const defaultArea = lookupDefaultArea(type);
      if (defaultArea === null) {
        throw new Error(`could not parse room spec: '${part}'`);
      }
      area = defaultArea;
    } else {
      throw new Error(`could not parse room spec: '${part}'`);
    }

    // 同 type 複数になる場合でも id は room{counter} で一意 (typeSubCounter は不要)
    rooms.push({ id: `room${counter}`, type, area_m2: area });
    counter += 1;
  }

  return rooms;
}
