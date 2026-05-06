import { describe, expect, it } from 'vitest';
import { parseArchilang } from '../parser.js';
import { resolve } from '../resolver.js';
import { scaffoldYaml, parseRoomList } from '../laporta/scaffolder.js';

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
    expect(() => parseRoomList('LDK')).toThrow();
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
