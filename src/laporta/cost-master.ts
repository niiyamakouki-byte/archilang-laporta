import { readFile } from 'node:fs/promises';
import { CostMasterCategory, CostMasterDB, CostMasterItem } from './types.js';

export const DEFAULT_COST_MASTER_PATH = '/Users/koki/vw-plugin/src/resources/cost-master.json';

interface RawCostMasterItem {
  code: string;
  name: string;
  unit: string;
  unitPrice: number;
  category?: string;
  tags?: string[];
  room?: string[];
}

interface RawCostMasterCategory {
  id: string;
  name: string;
  items: RawCostMasterItem[];
}

interface RawCostMasterDB {
  version: string;
  categories: RawCostMasterCategory[];
}

export async function loadCostMaster(path = DEFAULT_COST_MASTER_PATH): Promise<CostMasterDB> {
  const rawText = await readFile(path, 'utf-8');
  const raw = JSON.parse(rawText) as RawCostMasterDB;

  if (typeof raw.version !== 'string' || !Array.isArray(raw.categories)) {
    throw new Error(`Invalid cost master format: ${path}`);
  }

  const categories = raw.categories.map(normalizeCategory);
  return {
    version: raw.version,
    categories,
  };
}

export function findItemByCode(db: CostMasterDB, code: string): CostMasterItem | null {
  for (const category of db.categories) {
    const item = category.items.find(entry => entry.code === code);
    if (item) {
      return item;
    }
  }
  return null;
}

export function findItemsByRoom(db: CostMasterDB, roomTag: string): CostMasterItem[] {
  return db.categories.flatMap(category =>
    category.items.filter(item => item.room?.includes(roomTag))
  );
}

export function findItemsByCategory(db: CostMasterDB, categoryId: string): CostMasterItem[] {
  return db.categories.find(category => category.id === categoryId)?.items ?? [];
}

function normalizeCategory(category: RawCostMasterCategory): CostMasterCategory {
  if (typeof category.id !== 'string' || typeof category.name !== 'string' || !Array.isArray(category.items)) {
    throw new Error(`Invalid cost master category: ${JSON.stringify(category)}`);
  }

  return {
    id: category.id,
    name: category.name,
    items: category.items.map(item => normalizeItem(item, category.id)),
  };
}

function normalizeItem(item: RawCostMasterItem, categoryId: string): CostMasterItem {
  if (
    typeof item.code !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.unit !== 'string' ||
    typeof item.unitPrice !== 'number'
  ) {
    throw new Error(`Invalid cost master item in category "${categoryId}"`);
  }
  if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
    throw new Error(`Cost master item "${item.code}" in category "${categoryId}": unitPrice must be a finite non-negative number, got ${item.unitPrice}`);
  }

  return {
    code: item.code,
    name: item.name,
    unit: item.unit,
    unitPrice: item.unitPrice,
    category: item.category ?? categoryId,
    tags: item.tags,
    room: item.room,
  };
}
