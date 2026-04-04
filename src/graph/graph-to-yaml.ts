/**
 * graph-to-yaml: FloorplanGraph → archilang YAML 文字列
 *
 * Graph-CAD の「アクション列 → コード生成」に相当するステージ。
 * 間取りグラフを archilang v0.2 の YAML フォーマットに変換する。
 *
 * パイプライン:
 *   FloorplanGraph
 *     → sizeRooms (畳数→グリッド)
 *     → packGrid (制約付き配置)
 *     → generateOpenings (接続→開口部)
 *     → emit YAML
 */

import type { FloorplanGraph, PlacedRoom, RoomNode } from './types.js';
import type { Archilang, RoomSpec, OpeningSpec, EquipmentSpec } from '../types.js';
import { sizeRooms } from './room-sizer.js';
import { packGrid } from './grid-packer.js';
import {
  generateDoorOpenings,
  generateWindowOpenings,
  generateAutoWindows,
  generateEntryDoor,
  generateEquipment,
} from './opening-placer.js';

export interface ConversionResult {
  /** archilang YAML として parse 可能なオブジェクト */
  spec: Archilang;
  /** デバッグ用: グリッド配置結果 */
  placements: PlacedRoom[];
}

/**
 * FloorplanGraph → Archilang spec object
 */
export function graphToSpec(graph: FloorplanGraph): ConversionResult {
  // Step 1: 部屋サイズ算出
  const roomSizes = sizeRooms(graph.rooms);

  // Step 2: グリッド配置
  const packing = packGrid(graph, roomSizes);

  // Step 3: 開口部生成
  const doorOpenings = generateDoorOpenings(graph.connections);
  const windowOpenings = generateWindowOpenings(
    graph.rooms, packing.placements, packing.totalGridX, packing.totalGridY,
  );
  const autoWindows = generateAutoWindows(
    graph.rooms, packing.placements, packing.totalGridX, packing.totalGridY,
    graph.meta.orientation,
  );
  const entryDoor = generateEntryDoor(
    graph, packing.placements, packing.totalGridX, packing.totalGridY,
  );

  const allOpenings: OpeningSpec[] = [
    ...windowOpenings,
    ...autoWindows,
    ...doorOpenings,
    ...(entryDoor ? [entryDoor] : []),
  ];

  // Step 4: 設備生成
  const equipment = generateEquipment(graph.rooms, packing.placements);

  // Step 5: RoomSpec 生成
  const roomSpecs = buildRoomSpecs(graph.rooms, packing.placements);

  // Step 6: Archilang spec 組み立て
  const moduleStr = graph.meta.module === 'shaku' ? '910mm' : '1000mm';

  const spec: Archilang = {
    archilang: '0.2',
    site: {
      orientation: graph.meta.orientation,
    },
    building: {
      structure: graph.meta.building_type,
      module: graph.meta.module,
      stories: graph.meta.stories,
      defaults: {
        ceiling_height: '2400mm',
        external_wall: { thickness: '130mm' },
        internal_wall: { partition: '90mm' },
      },
    },
    rendering: {
      grid_lines: { enabled: true },
    },
    geometry: {
      grids: {
        module: moduleStr,
        '1F': {
          x_spans: packing.xSpans,
          y_spans: packing.ySpans,
        },
      },
      rooms: roomSpecs,
      openings: allOpenings,
      ...(equipment.length > 0 ? { equipment } : {}),
    },
  };

  return { spec, placements: packing.placements };
}

/**
 * graphToSpec の結果を YAML 文字列に変換。
 * yaml パッケージに依存せず、自前でシリアライズする（依存を増やさない）。
 */
export function specToYaml(spec: Archilang): string {
  const lines: string[] = [];

  lines.push(`archilang: "${spec.archilang}"`);
  lines.push('');

  // site
  lines.push('site:');
  lines.push(`  orientation: ${spec.site.orientation}`);
  lines.push('');

  // building
  lines.push('building:');
  lines.push(`  structure: ${spec.building.structure}`);
  lines.push(`  module: ${spec.building.module}`);
  lines.push(`  stories: ${spec.building.stories}`);
  lines.push('  defaults:');
  lines.push(`    ceiling_height: ${spec.building.defaults.ceiling_height}`);
  lines.push('    external_wall:');
  lines.push(`      thickness: ${spec.building.defaults.external_wall.thickness}`);
  lines.push('    internal_wall:');
  lines.push(`      partition: ${spec.building.defaults.internal_wall.partition}`);
  lines.push('');

  // rendering
  lines.push('rendering:');
  lines.push('  grid_lines:');
  lines.push('    enabled: true');
  lines.push('');

  // geometry
  lines.push('geometry:');

  // grids
  lines.push('  grids:');
  const grids = spec.geometry.grids;
  lines.push(`    module: ${grids.module}`);
  const floor = grids['1F'] as { x_spans: number[]; y_spans: number[] };
  if (floor) {
    lines.push('    1F:');
    lines.push(`      x_spans: [${floor.x_spans.join(', ')}]`);
    lines.push(`      y_spans: [${floor.y_spans.join(', ')}]`);
  }
  lines.push('');

  // rooms
  lines.push('  rooms:');
  for (const room of spec.geometry.rooms) {
    lines.push(`    - id: ${room.id}`);
    lines.push(`      floor: ${room.floor}`);
    lines.push(`      type: ${room.type}`);
    if (room.grid_rect) {
      const r = room.grid_rect;
      lines.push(`      grid_rect: { x: ${r.x}, y: ${r.y}, w: ${r.w}, h: ${r.h} }`);
    }
    if (room.sub_rooms && room.sub_rooms.length > 0) {
      lines.push('      sub_rooms:');
      for (const sr of room.sub_rooms) {
        lines.push(`        - id: ${sr.id}`);
        lines.push(`          type: ${sr.type}`);
        lines.push(`          seed: { x: ${sr.seed.x}, y: ${sr.seed.y} }`);
      }
    }
    lines.push('');
  }

  // openings
  lines.push('  openings:');
  for (const o of spec.geometry.openings) {
    lines.push(`    - id: ${o.id}`);
    lines.push(`      type: ${o.type}`);
    lines.push(`      style: ${o.style}`);
    if (o.connects) {
      lines.push(`      connects: [${o.connects[0]}, ${o.connects[1]}]`);
    } else {
      if (o.room) lines.push(`      room: ${o.room}`);
      if (o.wall) lines.push(`      wall: ${o.wall}`);
    }
    if (typeof o.position === 'string') {
      lines.push(`      position: ${o.position}`);
    } else {
      lines.push(`      position: { offset: ${o.position.offset} }`);
    }
    lines.push(`      size: { w: ${o.size.w}, h: ${o.size.h} }`);
    if (o.sill !== undefined) {
      lines.push(`      sill: ${o.sill}`);
    }
    lines.push('');
  }

  // equipment
  if (spec.geometry.equipment && spec.geometry.equipment.length > 0) {
    lines.push('  equipment:');
    for (const eq of spec.geometry.equipment) {
      lines.push(`    - id: ${eq.id}`);
      lines.push(`      type: ${eq.type}`);
      lines.push(`      room: ${eq.room}`);
      lines.push(`      wall: ${eq.wall}`);
      if (typeof eq.position === 'string') {
        lines.push(`      position: ${eq.position}`);
      } else {
        lines.push(`      position: { offset: ${eq.position.offset} }`);
      }
      if (eq.size) {
        lines.push(`      size: { w: ${eq.size.w}, h: ${eq.size.h} }`);
      }
      lines.push('');
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * FloorplanGraph → YAML 文字列（ワンショット変換）
 */
export function graphToYaml(graph: FloorplanGraph): string {
  const { spec } = graphToSpec(graph);
  return specToYaml(spec);
}

// ─── internal ───

function buildRoomSpecs(rooms: RoomNode[], placements: PlacedRoom[]): RoomSpec[] {
  const placementMap = new Map(placements.map(p => [p.id, p]));

  return rooms.map(room => {
    const p = placementMap.get(room.id);
    if (!p) throw new Error(`No placement found for room ${room.id}`);

    const spec: RoomSpec = {
      id: room.id,
      floor: room.floor || '1F',
      type: room.type,
      grid_rect: { x: p.x, y: p.y, w: p.w, h: p.h },
    };

    // sub_rooms のシード位置を配置結果から算出
    if (room.sub_rooms && room.sub_rooms.length > 0) {
      spec.sub_rooms = room.sub_rooms.map((sr, i) => {
        // シード位置: 部屋の中央付近に均等配置
        const seedX = p.x + Math.round(p.w * (i + 1) / (room.sub_rooms!.length + 1));
        const seedY = p.y + Math.round(p.h / 2);
        return {
          id: sr.id,
          type: sr.type,
          seed: { x: seedX, y: seedY },
        };
      });
    }

    return spec;
  });
}
