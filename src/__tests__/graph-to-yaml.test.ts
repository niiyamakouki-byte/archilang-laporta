import { describe, it, expect } from 'vitest';
import { graphToSpec, graphToYaml, specToYaml } from '../graph/graph-to-yaml.js';
import { sizeRooms } from '../graph/room-sizer.js';
import { packGrid } from '../graph/grid-packer.js';
import { parseArchilang } from '../parser.js';
import { resolve as resolveModel } from '../resolver.js';
import { validateBuilding } from '../validator.js';
import type { FloorplanGraph } from '../graph/types.js';

// ─── Minimal graph fixtures ───

const MINIMAL_GRAPH: FloorplanGraph = {
  meta: {
    building_type: '木造軸組',
    module: 'shaku',
    orientation: 'south',
    stories: 1,
  },
  zones: [
    { id: 'public', type: 'public', preferred_side: 'south' },
  ],
  rooms: [
    { id: 'ldk', type: 'LDK', zone: 'public', floor: '1F', target_area_tatami: 16 },
  ],
  connections: [],
  constraints: [
    { type: 'entry', rooms: ['ldk'], value: 'south' },
  ],
};

const TWO_ROOM_GRAPH: FloorplanGraph = {
  meta: {
    building_type: '木造軸組',
    module: 'shaku',
    orientation: 'south',
    stories: 1,
  },
  zones: [
    { id: 'public', type: 'public', preferred_side: 'south' },
    { id: 'private', type: 'private' },
  ],
  rooms: [
    { id: 'ldk', type: 'LDK', zone: 'public', floor: '1F', target_area_tatami: 16 },
    { id: 'bedroom', type: '寝室', zone: 'private', floor: '1F', target_area_tatami: 8 },
  ],
  connections: [
    { from: 'bedroom', to: 'ldk', type: 'door' },
  ],
  constraints: [
    { type: 'entry', rooms: ['ldk'], value: 'south' },
  ],
};

// ─── room-sizer ───

describe('room-sizer', () => {
  it('sizes LDK to at least 32 grid cells (16 tatami)', () => {
    const sizes = sizeRooms(MINIMAL_GRAPH.rooms);
    expect(sizes).toHaveLength(1);
    expect(sizes[0].id).toBe('ldk');
    expect(sizes[0].w * sizes[0].h).toBeGreaterThanOrEqual(32);
    expect(sizes[0].w).toBeGreaterThanOrEqual(4);
    expect(sizes[0].h).toBeGreaterThanOrEqual(4);
  });

  it('sizes トイレ to small grid', () => {
    const sizes = sizeRooms([
      { id: 'toilet', type: 'トイレ', zone: 'water', floor: '1F', target_area_tatami: 1 },
    ]);
    expect(sizes[0].w * sizes[0].h).toBeGreaterThanOrEqual(2);
    expect(sizes[0].w).toBeGreaterThanOrEqual(1);
  });
});

// ─── grid-packer ───

describe('grid-packer', () => {
  it('packs a single room', () => {
    const sizes = sizeRooms(MINIMAL_GRAPH.rooms);
    const result = packGrid(MINIMAL_GRAPH, sizes);
    expect(result.placements).toHaveLength(1);
    expect(result.placements[0].id).toBe('ldk');
    expect(result.placements[0].x).toBe(0);
    expect(result.placements[0].y).toBe(0);
    expect(result.totalGridX).toBeGreaterThan(0);
    expect(result.totalGridY).toBeGreaterThan(0);
  });

  it('packs two rooms with door connection in adjacent positions', () => {
    const sizes = sizeRooms(TWO_ROOM_GRAPH.rooms);
    const result = packGrid(TWO_ROOM_GRAPH, sizes);
    expect(result.placements).toHaveLength(2);

    const ldk = result.placements.find(p => p.id === 'ldk')!;
    const bedroom = result.placements.find(p => p.id === 'bedroom')!;

    // Both should have valid positions
    expect(ldk.x).toBeGreaterThanOrEqual(0);
    expect(bedroom.x).toBeGreaterThanOrEqual(0);

    // They should share at least one edge (adjacent)
    const shareHorizontal = (ldk.y + ldk.h === bedroom.y || bedroom.y + bedroom.h === ldk.y)
      && !(ldk.x + ldk.w <= bedroom.x || bedroom.x + bedroom.w <= ldk.x);
    const shareVertical = (ldk.x + ldk.w === bedroom.x || bedroom.x + bedroom.w === ldk.x)
      && !(ldk.y + ldk.h <= bedroom.y || bedroom.y + bedroom.h <= ldk.y);

    expect(shareHorizontal || shareVertical).toBe(true);
  });
});

// ─── graph-to-yaml ───

describe('graph-to-yaml', () => {
  it('converts minimal graph to valid YAML', () => {
    const yaml = graphToYaml(MINIMAL_GRAPH);

    // Should be parseable by archilang
    const spec = parseArchilang(yaml);
    expect(spec.archilang).toBe('0.2');
    expect(spec.geometry.rooms).toHaveLength(1);
    expect(spec.geometry.rooms[0].id).toBe('ldk');
  });

  it('generates door openings from connections', () => {
    const { spec } = graphToSpec(TWO_ROOM_GRAPH);
    const doors = spec.geometry.openings.filter(o => o.connects);
    expect(doors.length).toBeGreaterThanOrEqual(1);
    const bedroomDoor = doors.find(d =>
      d.connects?.includes('bedroom') && d.connects?.includes('ldk')
    );
    expect(bedroomDoor).toBeDefined();
  });

  it('generates entry door from entry constraint', () => {
    const { spec } = graphToSpec(MINIMAL_GRAPH);
    const entryDoor = spec.geometry.openings.find(o => o.id === 'ED1');
    expect(entryDoor).toBeDefined();
    expect(entryDoor!.type).toBe('AD');
  });

  it('generates valid spec that resolves without parse errors', () => {
    const { spec } = graphToSpec(TWO_ROOM_GRAPH);
    const yaml = specToYaml(spec);

    // Parse and resolve should not throw
    const parsed = parseArchilang(yaml);
    const model = resolveModel(parsed);
    expect(model.rooms).toHaveLength(2);
    expect(model.walls.length).toBeGreaterThan(0);
  });
});

// ─── Full 3LDK graph ───

describe('3LDK graph integration', () => {
  it('generates parseable YAML from 3LDK graph', () => {
    const graph: FloorplanGraph = {
      meta: { building_type: '木造軸組', module: 'shaku', orientation: 'south', stories: 1 },
      zones: [
        { id: 'public', type: 'public', preferred_side: 'south' },
        { id: 'private', type: 'private' },
        { id: 'water', type: 'water' },
      ],
      rooms: [
        { id: 'ldk', type: 'LDK', zone: 'public', floor: '1F', target_area_tatami: 16 },
        { id: 'washitsu', type: '和室', zone: 'public', floor: '1F', target_area_tatami: 6 },
        { id: 'bedroom', type: '主寝室', zone: 'private', floor: '1F', target_area_tatami: 8 },
        { id: 'kodomo', type: '子供部屋', zone: 'private', floor: '1F', target_area_tatami: 6 },
        { id: 'bath', type: '浴室', zone: 'water', floor: '1F', target_area_tatami: 2 },
        { id: 'wash', type: '洗面脱衣', zone: 'water', floor: '1F', target_area_tatami: 2 },
        { id: 'toilet', type: 'トイレ', zone: 'water', floor: '1F', target_area_tatami: 1 },
      ],
      connections: [
        { from: 'washitsu', to: 'ldk', type: 'door' },
        { from: 'kodomo', to: 'ldk', type: 'door' },
        { from: 'bedroom', to: 'kodomo', type: 'door' },
        { from: 'wash', to: 'ldk', type: 'sliding_door' },
        { from: 'bath', to: 'wash', type: 'sliding_door' },
        { from: 'toilet', to: 'wash', type: 'sliding_door' },
      ],
      constraints: [
        { type: 'entry', rooms: ['ldk'], value: 'south' },
        { type: 'cluster', rooms: ['bath', 'wash', 'toilet'], value: 'water_cluster' },
      ],
    };

    const yaml = graphToYaml(graph);
    const spec = parseArchilang(yaml);
    const model = resolveModel(spec);

    // Basic structure checks
    expect(model.rooms).toHaveLength(7);
    expect(model.walls.length).toBeGreaterThan(0);
    expect(model.openings.length).toBeGreaterThan(0);

    // Validate - may have some issues, but should not crash
    const validation = validateBuilding(model);
    expect(validation).toBeDefined();
  });
});
