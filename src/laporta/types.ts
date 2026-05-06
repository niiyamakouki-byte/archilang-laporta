export interface CostMasterItem {
  code: string;
  name: string;
  unit: string;
  unitPrice: number;
  category: string;
  tags?: string[];
  room?: string[];
}

export interface CostMasterCategory {
  id: string;
  name: string;
  items: CostMasterItem[];
}

export interface CostMasterDB {
  version: string;
  categories: CostMasterCategory[];
}

export interface InteriorFinishSpec {
  code: string;
  /** 床面積に掛ける係数。床=1.0 / 天井=1.0 / 壁=2.4 (天井高2.4mを仮定した壁面積近似) */
  areaMultiplier: number;
  /** どの面に対する仕上げか (見積行のメモ用) */
  surface: 'floor' | 'wall' | 'ceiling' | 'misc';
}

export interface RoomTypeMapping {
  archilangType: string;
  costMasterRoomTags: string[];
  /** 後方互換: 床面積×単価で1行追加する code 配列 (multiplier=1.0扱い) */
  defaultInteriorItems: string[];
  /** より正確な仕上げ展開 (床/壁/天井を別行で出す)。空配列ならスキップ */
  finishItems?: InteriorFinishSpec[];
}

export interface EquipmentMapping {
  archilangType: string;
  costMasterCode: string | null;
}

export interface OpeningStyleMapping {
  style: string;
  type: string;
  costMasterCode: string | null;
}

export interface EstimateLine {
  code: string;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
  amount: number;
  category: string;
  source: 'room' | 'opening' | 'equipment' | 'wall';
  sourceId: string;
}

export interface LaportaEstimate {
  version: string;
  generatedAt: string;
  archilangVersion: string;
  lines: EstimateLine[];
  subtotal: number;
  tax: number;
  total: number;
}
