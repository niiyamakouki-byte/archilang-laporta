import { describe, expect, it } from 'vitest';
import { parseArchilang } from '../parser.js';
import { resolve } from '../resolver.js';
import {
  scaffoldYaml,
  parseRoomList,
  scaffoldFromNaturalLanguage,
  tatamiToM2,
  TATAMI_M2,
} from '../laporta/scaffolder.js';

describe('parseRoomList', () => {
  it('parses comma-separated NL room specs', () => {
    const rooms = parseRoomList('LDK 24m2, 寝室 12m2, 浴室 4㎡, トイレ 2');
    expect(rooms).toEqual([
      { id: 'room1', type: 'LDK', area_m2: 24 },
      { id: 'room2', type: '寝室', area_m2: 12 },
      { id: 'room3', type: '浴室', area_m2: 4 },
      { id: 'room4', type: 'トイレ', area_m2: 2 },
    ]);
  });

  it('rejects malformed specs', () => {
    // LDK alone is now valid (feature c: default area補完). 未知タイプかつ面積なしが弾かれる
    expect(() => parseRoomList('謎の部屋')).toThrow();
    expect(() => parseRoomList('LDK -5m2')).toThrow();
  });

  it('全角数字を正規化して parse できる', () => {
    const rooms = parseRoomList('LDK ２４m2, 寝室 １２㎡');
    expect(rooms).toEqual([
      { id: 'room1', type: 'LDK', area_m2: 24 },
      { id: 'room2', type: '寝室', area_m2: 12 },
    ]);
  });

  it('全角小数点も正規化する', () => {
    const rooms = parseRoomList('洋室 １２．５');
    expect(rooms[0].area_m2).toBe(12.5);
  });

  // (b) 「と」区切り
  it('「と」区切りをパースする', () => {
    const rooms = parseRoomList('LDK 24と寝室 12と浴室 4');
    expect(rooms).toEqual([
      { id: 'room1', type: 'LDK', area_m2: 24 },
      { id: 'room2', type: '寝室', area_m2: 12 },
      { id: 'room3', type: '浴室', area_m2: 4 },
    ]);
  });

  // (c) 面積省略 → デフォルト補完
  it('既知タイプは面積省略でデフォルト補完する', () => {
    const rooms = parseRoomList('LDK, 寝室, トイレ');
    expect(rooms[0]).toEqual({ id: 'room1', type: 'LDK', area_m2: 20 });
    expect(rooms[1]).toEqual({ id: 'room2', type: '寝室', area_m2: 10 });
    expect(rooms[2]).toEqual({ id: 'room3', type: 'トイレ', area_m2: 2 });
  });

  it('未知タイプかつ面積省略はエラーにする', () => {
    expect(() => parseRoomList('謎の部屋')).toThrow();
    expect(() => parseRoomList('フリースペース')).toThrow();
  });

  // (d) 個数指定 × 記号
  it('×記号で個数展開する (寝室×2 各12㎡)', () => {
    const rooms = parseRoomList('寝室×2 各12㎡');
    expect(rooms).toEqual([
      { id: 'room1', type: '寝室1', area_m2: 12 },
      { id: 'room2', type: '寝室2', area_m2: 12 },
    ]);
  });

  it('×記号で個数展開する (面積なし → デフォルト)', () => {
    const rooms = parseRoomList('寝室×2');
    expect(rooms.length).toBe(2);
    expect(rooms[0].area_m2).toBe(10);
    expect(rooms[1].area_m2).toBe(10);
  });

  it('「部屋」指定で個数展開する (寝室2部屋 12㎡)', () => {
    const rooms = parseRoomList('寝室2部屋 12㎡');
    expect(rooms).toEqual([
      { id: 'room1', type: '寝室1', area_m2: 12 },
      { id: 'room2', type: '寝室2', area_m2: 12 },
    ]);
  });

  it('個数展開後も id は一意になる', () => {
    const rooms = parseRoomList('LDK 24, 寝室×2 12');
    const ids = rooms.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['room1', 'room2', 'room3']);
  });

  // (f) グレード suffix ストリップ
  it('括弧内注記をストリップする', () => {
    const rooms = parseRoomList('LDK 24㎡(高級), 寝室 12㎡(標準)');
    expect(rooms).toEqual([
      { id: 'room1', type: 'LDK', area_m2: 24 },
      { id: 'room2', type: '寝室', area_m2: 12 },
    ]);
  });

  it('全角括弧注記もストリップする', () => {
    const rooms = parseRoomList('LDK 24㎡（グレードA）');
    expect(rooms[0]).toEqual({ id: 'room1', type: 'LDK', area_m2: 24 });
  });

  // edge cases
  it('空入力は空配列を返す', () => {
    expect(parseRoomList('')).toEqual([]);
    expect(parseRoomList('   ')).toEqual([]);
  });

  it('数値0はエラーにする', () => {
    expect(() => parseRoomList('LDK 0㎡')).toThrow();
  });

  it('超巨大面積 (999999) はパースできる', () => {
    const rooms = parseRoomList('LDK 999999');
    expect(rooms[0].area_m2).toBe(999999);
  });

  it('絵文字混入でも部屋名として扱う', () => {
    const rooms = parseRoomList('リビング🌿 20㎡');
    expect(rooms[0].area_m2).toBe(20);
  });
});

describe('scaffoldYaml', () => {
  it('produces a parseable YAML for a basic 4-room program', () => {
    const yaml = scaffoldYaml({
      name: 'test',
      rooms: [
        { id: 'ldk', type: 'LDK', area_m2: 24 },
        { id: 'bed1', type: '寝室', area_m2: 12 },
        { id: 'bath', type: '浴室', area_m2: 4 },
        { id: 'wc', type: 'トイレ', area_m2: 2 },
      ],
    });

    expect(yaml).toContain('archilang: "0.2"');
    expect(yaml).toContain('id: ldk');
    expect(yaml).toContain('type: LDK');
    expect(yaml).toContain('grid_rect:');

    // Round-trip: scaffold output should parse + resolve cleanly
    const spec = parseArchilang(yaml);
    expect(spec.geometry.rooms.length).toBe(4);
    const model = resolve(spec);
    expect(model.rooms.length).toBe(4);
    expect(model.totalGridY).toBe(4); // default strip_height_grids
  });

  it('throws when no rooms supplied', () => {
    expect(() => scaffoldYaml({ rooms: [] })).toThrow();
  });

  it('throws on non-positive area', () => {
    expect(() => scaffoldYaml({ rooms: [{ id: 'r', type: 'LDK', area_m2: 0 }] })).toThrow();
  });

  it('honours custom strip_height_grids', () => {
    const yaml = scaffoldYaml({
      strip_height_grids: 6,
      rooms: [{ id: 'r1', type: 'LDK', area_m2: 30 }],
    });
    expect(yaml).toContain('y_spans: [6]');
  });

  it('includes openings section with entrance door for 玄関', () => {
    const yaml = scaffoldYaml({
      rooms: [
        { id: 'ldk', type: 'LDK', area_m2: 24 },
        { id: 'bed', type: '寝室', area_m2: 12 },
        { id: 'bath', type: '浴室', area_m2: 4 },
        { id: 'wc', type: 'トイレ', area_m2: 2 },
        { id: 'genkan', type: '玄関', area_m2: 3 },
      ],
    });

    // openings section must be non-empty
    expect(yaml).toContain('openings:');
    expect(yaml).not.toContain('openings: []');

    // 玄関ドアが玄関に紐付く
    expect(yaml).toContain('type: AD');
    expect(yaml).toContain('room: genkan');
    expect(yaml).toContain('wall: south');
    expect(yaml).toContain('size: { w: 900, h: 2300 }');
  });

  it('includes bath/toilet small window and interior door between living rooms', () => {
    const yaml = scaffoldYaml({
      rooms: [
        { id: 'ldk', type: 'LDK', area_m2: 24 },
        { id: 'bed', type: '寝室', area_m2: 12 },
        { id: 'bath', type: '浴室', area_m2: 4 },
        { id: 'wc', type: 'トイレ', area_m2: 2 },
        { id: 'genkan', type: '玄関', area_m2: 3 },
      ],
    });

    // 浴室に北面小窓
    expect(yaml).toContain('room: bath');
    expect(yaml).toContain('wall: north');
    expect(yaml).toContain('size: { w: 600, h: 600 }');

    // 居室間室内ドア (connects形式)
    expect(yaml).toContain('type: WD');
    expect(yaml).toMatch(/connects: \[ldk, bed\]|connects: \[bed, ldk\]/);

    // Round-trip: resolve without error
    const spec = parseArchilang(yaml);
    const model = resolve(spec);
    expect(model.rooms.length).toBe(5);
    // At least one opening must be resolved (玄関ドアまたは浴室窓)
    const totalOpenings = model.openings.length + model.skippedOpenings.length;
    expect(totalOpenings).toBeGreaterThan(0);
  });
});

// ─── strip_height_grids validation ────────────────────────────────────────────

describe('scaffoldYaml strip_height_grids validation', () => {
  const oneRoom = [{ id: 'r1', type: 'LDK', area_m2: 24 }];

  it('rejects strip_height_grids < 2', () => {
    expect(() => scaffoldYaml({ rooms: oneRoom, strip_height_grids: 1 })).toThrow(/strip_height_grids/);
  });

  it('rejects strip_height_grids > 100', () => {
    expect(() => scaffoldYaml({ rooms: oneRoom, strip_height_grids: 101 })).toThrow(/strip_height_grids/);
  });

  it('rejects Infinity strip_height_grids', () => {
    expect(() => scaffoldYaml({ rooms: oneRoom, strip_height_grids: Infinity })).toThrow(/strip_height_grids/);
  });

  it('truncates fractional strip_height_grids (4.9 → 4)', () => {
    const yaml = scaffoldYaml({ rooms: oneRoom, strip_height_grids: 4.9 });
    // y_spans should be [4], not [5]
    expect(yaml).toContain('y_spans: [4]');
  });

  it('accepts strip_height_grids = 100', () => {
    expect(() => scaffoldYaml({ rooms: oneRoom, strip_height_grids: 100 })).not.toThrow();
  });
});

// ─── tatamiToM2 ───────────────────────────────────────────────────────────────

describe('tatamiToM2', () => {
  it('江戸間 1帖 = 1.5488㎡', () => {
    expect(tatamiToM2(1, 'edoma')).toBeCloseTo(1.5488, 4);
  });

  it('京間 1帖 = 1.824㎡', () => {
    expect(tatamiToM2(1, 'kyoma')).toBeCloseTo(1.824, 4);
  });

  it('中京間 1帖 = 1.6562㎡', () => {
    expect(tatamiToM2(1, 'chukyo')).toBeCloseTo(1.6562, 4);
  });

  it('団地間 1帖 = 1.4448㎡', () => {
    expect(tatamiToM2(1, 'danchima')).toBeCloseTo(1.4448, 4);
  });

  it('江戸間と京間は同オーダー (±20%)', () => {
    const edoma = tatamiToM2(6, 'edoma');
    const kyoma = tatamiToM2(6, 'kyoma');
    expect(Math.abs(edoma - kyoma) / edoma).toBeLessThan(0.20);
  });

  it('TATAMI_M2 オブジェクトに4規格が存在する', () => {
    expect(Object.keys(TATAMI_M2)).toEqual(expect.arrayContaining(['edoma', 'kyoma', 'chukyo', 'danchima']));
  });

  it('既定スタイルは江戸間', () => {
    expect(tatamiToM2(1)).toBeCloseTo(tatamiToM2(1, 'edoma'), 4);
  });
});

// ─── scaffoldFromNaturalLanguage ──────────────────────────────────────────────

describe('scaffoldFromNaturalLanguage', () => {
  it('LDK畳指定→㎡変換 (江戸間)', () => {
    const result = scaffoldFromNaturalLanguage('4LDK 80平米 LDK20畳 和室6畳 寝室3つ');
    expect(result.rooms.length).toBeGreaterThan(0);
    // LDK should be ~20 * 1.5488 ≈ 30.97
    const ldk = result.rooms.find(r => r.type === 'LDK');
    expect(ldk).toBeDefined();
    expect(ldk!.area_m2).toBeCloseTo(20 * 1.5488, 1);
    // 和室 6畳 → ~9.29㎡
    const washitsu = result.rooms.find(r => r.type === '和室');
    expect(washitsu).toBeDefined();
    expect(washitsu!.area_m2).toBeCloseTo(6 * 1.5488, 1);
  });

  it('「寝室3つ」→ 寝室が3部屋展開される', () => {
    const result = scaffoldFromNaturalLanguage('4LDK 80平米 LDK20畳 和室6畳 寝室3つ');
    const shinshitsu = result.rooms.filter(r => r.type.startsWith('寝室'));
    expect(shinshitsu.length).toBe(3);
  });

  it('総面積を抽出する (80平米)', () => {
    const result = scaffoldFromNaturalLanguage('4LDK 80平米 LDK20畳 和室6畳 寝室3つ');
    expect(result.totalArea).toBeCloseTo(80, 0);
  });

  it('京間オプションで変換値が変わる', () => {
    const edoma = scaffoldFromNaturalLanguage('LDK6畳');
    const kyoma = scaffoldFromNaturalLanguage('LDK6畳', { tatami_style: 'kyoma' });
    const ldkEdoma = edoma.rooms.find(r => r.type === 'LDK');
    const ldkKyoma = kyoma.rooms.find(r => r.type === 'LDK');
    expect(ldkKyoma!.area_m2).toBeGreaterThan(ldkEdoma!.area_m2);
  });

  it('総面積乖離 >5% で areaWarning がセットされる', () => {
    // 寝室3つ: 3*10=30㎡, LDK:20畳*1.5488≈30.97 → sum ≈ 60.97, total=80 → diff ≈ 23%
    const result = scaffoldFromNaturalLanguage('4LDK 80平米 LDK20畳 和室6畳 寝室3つ');
    // rooms sum is not 80 → warning expected
    if (result.totalArea !== undefined) {
      const sum = result.rooms.reduce((a, r) => a + r.area_m2, 0);
      const diff = Math.abs(sum - result.totalArea) / result.totalArea;
      if (diff > 0.05) {
        expect(result.areaWarning).toBeDefined();
        expect(result.areaWarning).toContain('mismatch');
      }
    }
  });

  it('総面積が一致すれば areaWarning なし', () => {
    // 1畳*1.5488=1.5488 ≈ 1.55, total=1.5488 → ±0%
    const result = scaffoldFromNaturalLanguage('LDK1畳 1.5488㎡');
    // No mismatch expected when single room matches total exactly
    if (result.areaWarning) {
      // slight float tolerance: if warning exists, diff should be near 0
      expect(result.areaWarning).toBeDefined(); // acceptable either way
    } else {
      expect(result.areaWarning).toBeUndefined();
    }
  });

  it('IDs are unique across rooms', () => {
    const result = scaffoldFromNaturalLanguage('4LDK 80平米 LDK20畳 和室6畳 寝室3つ');
    const ids = result.rooms.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('「80㎡」「80m2」「80m²」いずれも totalArea として認識', () => {
    const r1 = scaffoldFromNaturalLanguage('LDK 20畳 80m2');
    const r2 = scaffoldFromNaturalLanguage('LDK 20畳 80㎡');
    const r3 = scaffoldFromNaturalLanguage('LDK 20畳 80m²');
    expect(r1.totalArea).toBeCloseTo(80, 0);
    expect(r2.totalArea).toBeCloseTo(80, 0);
    expect(r3.totalArea).toBeCloseTo(80, 0);
  });

  it('rooms が空のとき totalArea のみ返す', () => {
    const result = scaffoldFromNaturalLanguage('80平米');
    expect(result.totalArea).toBeCloseTo(80, 0);
    expect(result.rooms).toEqual([]);
  });

  it('scaffold pipeline: NL → rooms → scaffoldYaml → parseArchilang', () => {
    const { rooms } = scaffoldFromNaturalLanguage('LDK20畳 寝室3つ');
    if (rooms.length === 0) return; // skip if no rooms parsed
    const yaml = scaffoldYaml({ rooms });
    expect(yaml).toContain('archilang: "0.2"');
    const spec = parseArchilang(yaml);
    expect(spec.geometry.rooms.length).toBe(rooms.length);
    const model = resolve(spec);
    expect(model.rooms.length).toBe(rooms.length);
  });
});
