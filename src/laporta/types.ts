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

export interface RoomTypeMapping {
  archilangType: string;
  costMasterRoomTags: string[];
  defaultInteriorItems: string[];
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
