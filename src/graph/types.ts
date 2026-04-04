/**
 * FloorplanGraph — LLM が生成する間取りの中間グラフ表現
 *
 * Graph-CAD (ICLR 2026) の「階層分解グラフ」を建築間取りに特化させたもの。
 * LLM は構造（何が何と繋がるか）だけ出力し、幾何（座標）は graph-to-yaml で解く。
 */

import type { EquipmentType, WallSide } from '../types.js';

// ─── Graph top-level ───

export interface FloorplanGraph {
  meta: FloorplanMeta;
  zones: Zone[];
  rooms: RoomNode[];
  connections: ConnectionEdge[];
  constraints: LayoutConstraint[];
}

export interface FloorplanMeta {
  building_type: string;                  // e.g. "木造軸組"
  module: 'shaku' | 'meter';              // shaku=910mm, meter=1000mm
  orientation: WallSide;                  // 建物正面の方角
  stories: number;
  target_total_tsubo?: number;            // 目標延床面積（坪）
}

// ─── Zones ───

export type ZoneType = 'public' | 'private' | 'water' | 'service' | 'circulation';

export interface Zone {
  id: string;
  type: ZoneType;
  label?: string;                         // e.g. "パブリックゾーン"
  preferred_side?: WallSide;              // 希望方位 (south = 南面)
}

// ─── Room nodes ───

export interface RoomNode {
  id: string;
  type: string;                           // "LDK", "寝室", "トイレ" etc.
  zone: string;                           // Zone.id
  floor: string;                          // "1F", "2F"
  target_area_tatami?: number;            // 目標面積（畳数）
  min_width_grid?: number;                // 最小幅（グリッド数）
  min_depth_grid?: number;                // 最小奥行（グリッド数）
  equipment?: EquipmentPlacement[];
  sub_rooms?: SubRoomNode[];
  /** 外部開口を設ける壁面 */
  windows?: WindowHint[];
}

export interface SubRoomNode {
  id: string;
  type: string;
  /** 親部屋内の相対位置ヒント */
  position_hint?: WallSide;
}

export interface EquipmentPlacement {
  type: EquipmentType;
  wall?: WallSide;                        // 省略時は自動配置
}

export interface WindowHint {
  wall: WallSide;
  style?: string;                         // "引違い窓", "FIX窓" etc.
  size?: 'large' | 'medium' | 'small';   // large=掃き出し, medium=腰窓, small=小窓
}

// ─── Connection edges ───

export type ConnectionType = 'door' | 'sliding_door' | 'opening' | 'adjacent_only';

export interface ConnectionEdge {
  from: string;                           // RoomNode.id
  to: string;                             // RoomNode.id
  type: ConnectionType;
  opening_style?: string;                 // "片開き", "引き戸", "引違い窓" etc.
}

// ─── Layout constraints ───

export type ConstraintType =
  | 'orientation'       // 特定の部屋を特定方位に面させる
  | 'adjacency'         // 2部屋を隣接させる
  | 'cluster'           // 複数部屋をまとめる（水回りクラスタ等）
  | 'separation'        // 2部屋を離す
  | 'entry';            // 玄関位置

export interface LayoutConstraint {
  type: ConstraintType;
  rooms: string[];                        // 対象部屋ID
  value: string;                          // e.g. "south", "water_cluster"
}

// ─── Intermediate types for grid-packer ───

/** グリッド上での部屋配置結果 */
export interface PlacedRoom {
  id: string;
  x: number;          // grid origin x
  y: number;          // grid origin y
  w: number;          // grid width
  h: number;          // grid height
}

/** grid-packer の出力 */
export interface PackingResult {
  xSpans: number[];   // グリッドの列幅（モジュール数）
  ySpans: number[];   // グリッドの行高（モジュール数）
  placements: PlacedRoom[];
  totalGridX: number;
  totalGridY: number;
}

// ─── Window size presets (mm) ───

export const WINDOW_SIZE_PRESETS = {
  large:  { w: 2530, h: 2000, sill: 0 },     // 掃き出し窓
  medium: { w: 1690, h: 1100, sill: 800 },   // 腰窓
  small:  { w: 730,  h: 770,  sill: 1000 },  // 小窓
} as const;

/** 部屋タイプ → 推奨畳数のデフォルト */
export const ROOM_TYPE_DEFAULTS: Record<string, { tatami: number; minW: number; minD: number }> = {
  'LDK':       { tatami: 16, minW: 4, minD: 4 },
  'LD':        { tatami: 12, minW: 3, minD: 4 },
  'DK':        { tatami: 8,  minW: 3, minD: 3 },
  '寝室':      { tatami: 8,  minW: 3, minD: 3 },
  '主寝室':    { tatami: 8,  minW: 3, minD: 3 },
  '子供部屋':  { tatami: 6,  minW: 2, minD: 3 },
  '和室':      { tatami: 6,  minW: 3, minD: 3 },
  '浴室':      { tatami: 2,  minW: 2, minD: 2 },
  '洗面脱衣':  { tatami: 2,  minW: 2, minD: 2 },
  'トイレ':    { tatami: 1,  minW: 1, minD: 2 },
  '玄関':      { tatami: 3,  minW: 2, minD: 2 },
  '廊下':      { tatami: 2,  minW: 1, minD: 2 },
  'WIC':       { tatami: 3,  minW: 2, minD: 2 },
  'クローゼット': { tatami: 1, minW: 1, minD: 1 },
  'パントリー':  { tatami: 1, minW: 1, minD: 1 },
};
