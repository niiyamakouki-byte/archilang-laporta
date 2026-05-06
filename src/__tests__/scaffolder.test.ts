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
});
