import { BuildingModel } from '../types.js';
import { findItemByCode } from './cost-master.js';
import { EQUIPMENT_MAPPINGS, OPENING_STYLE_MAPPINGS, ROOM_TYPE_MAPPINGS } from './mappings.js';
import { CostMasterDB, EstimateLine, LaportaEstimate } from './types.js';

export type ResolvedArchilang = BuildingModel & {
  archilangVersion?: string;
};

export function emitEstimate(model: ResolvedArchilang, db: CostMasterDB): LaportaEstimate {
  const lines: EstimateLine[] = [];

  const MAX_QTY = 100_000;         // m² upper bound per line item
  const MAX_AMOUNT = 1_000_000_000_000; // 1 兆円

  for (const room of model.rooms) {
    const mapping = ROOM_TYPE_MAPPINGS.find(entry => entry.archilangType === room.type);
    if (!mapping) {
      continue;
    }

    const areaM2 = roundTo(room.boundingRect.w * room.boundingRect.h / 1_000_000, 2);
    if (!Number.isFinite(areaM2)) {
      throw new Error(`Room "${room.id}": area_m2 is not finite (${areaM2})`);
    }
    if (areaM2 > MAX_QTY) {
      throw new Error(`Room "${room.id}": area_m2 ${areaM2} exceeds max qty ${MAX_QTY} m²`);
    }
    const openingAreaM2 = computeOpeningAreaForRoom(model, room.id);

    for (const code of mapping.defaultInteriorItems) {
      const item = findItemByCode(db, code);
      if (!item) {
        continue;
      }

      lines.push({
        code: item.code,
        name: item.name,
        unit: item.unit,
        qty: areaM2,
        unitPrice: item.unitPrice,
        amount: roundTo(areaM2 * item.unitPrice, 2),
        category: item.category,
        source: 'room',
        sourceId: room.id,
      });
    }

    for (const finish of mapping.finishItems ?? []) {
      const item = findItemByCode(db, finish.code);
      if (!item) {
        continue;
      }
      let qty = roundTo(areaM2 * finish.areaMultiplier, 2);
      // 壁仕上げは開口部面積を控除する (建具で塞がれる部分はクロス/タイル不要)
      let deductedM2 = 0;
      if (finish.surface === 'wall' && openingAreaM2 > 0) {
        deductedM2 = openingAreaM2;
        qty = Math.max(0, roundTo(qty - deductedM2, 2));
      }
      const finishLabel = deductedM2 > 0
        ? `${item.name} (${finish.surface}, 開口部 ${deductedM2.toFixed(2)} m² 控除)`
        : `${item.name} (${finish.surface})`;
      lines.push({
        code: item.code,
        name: finishLabel,
        unit: item.unit,
        qty,
        unitPrice: item.unitPrice,
        amount: roundTo(qty * item.unitPrice, 2),
        category: item.category,
        source: 'room',
        sourceId: room.id,
      });
    }
  }

  for (const opening of model.openings) {
    const mapping = OPENING_STYLE_MAPPINGS.find(entry =>
      entry.style === opening.style && entry.type === opening.type
    );
    if (!mapping?.costMasterCode) {
      continue;
    }

    const item = findItemByCode(db, mapping.costMasterCode);
    if (!item) {
      continue;
    }

    lines.push({
      code: item.code,
      name: item.name,
      unit: item.unit,
      qty: 1,
      unitPrice: item.unitPrice,
      amount: item.unitPrice,
      category: item.category,
      source: 'opening',
      sourceId: opening.id,
    });
  }

  for (const equipment of model.equipment) {
    const mapping = EQUIPMENT_MAPPINGS.find(entry => entry.archilangType === equipment.type);
    if (!mapping?.costMasterCode) {
      continue;
    }

    const item = findItemByCode(db, mapping.costMasterCode);
    if (!item) {
      continue;
    }

    lines.push({
      code: item.code,
      name: item.name,
      unit: item.unit,
      qty: 1,
      unitPrice: item.unitPrice,
      amount: item.unitPrice,
      category: item.category,
      source: 'equipment',
      sourceId: equipment.id,
    });
  }

  const nonZeroLines = lines.filter(line => line.qty !== 0);
  lines.length = 0;
  lines.push(...nonZeroLines);

  // Guard: each line amount must not exceed 1兆円 cap
  for (const line of lines) {
    if (!Number.isFinite(line.amount) || line.amount > MAX_AMOUNT) {
      throw new Error(`Line "${line.code}": amount ${line.amount} exceeds max (${MAX_AMOUNT}); check unit price and quantity`);
    }
  }

  const subtotal = roundTo(lines.reduce((sum, line) => sum + line.amount, 0), 2);
  if (!Number.isFinite(subtotal)) {
    throw new Error(`Estimate subtotal is not finite (${subtotal}); check unit prices and quantities`);
  }
  if (subtotal > MAX_AMOUNT) {
    throw new Error(`Estimate subtotal ${subtotal} exceeds max (${MAX_AMOUNT}); reduce line count or quantities`);
  }
  const tax = roundTo(subtotal * 0.1, 2);
  const total = roundTo(subtotal + tax, 2);

  return {
    version: db.version,
    generatedAt: new Date().toISOString(), // UTC (Z suffix). Callers convert to JST for display if needed.
    archilangVersion: model.archilangVersion ?? 'unknown',
    lines,
    subtotal,
    tax,
    total,
  };
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 実務慣習: この面積 (m²) 未満の開口部は壁仕上げ控除対象としない (小窓は仕上げで隠さない) */
const MIN_OPENING_AREA_M2 = 0.5;

/**
 * 指定 room の壁面に存在する開口部 (窓・建具) の総面積 (m²) を返す。
 * 壁仕上げ qty から控除して、より現実的な見積を出すために使用。
 * MIN_OPENING_AREA_M2 未満の開口部は控除しない。
 */
function computeOpeningAreaForRoom(model: ResolvedArchilang, roomId: string): number {
  const wallIds = new Set(
    model.walls.filter(w => w.rooms.includes(roomId)).map(w => w.id)
  );
  if (wallIds.size === 0) {
    return 0;
  }
  let totalM2 = 0;
  for (const opening of model.openings) {
    if (wallIds.has(opening.wallId)) {
      const areaM2 = (opening.w * opening.h) / 1_000_000;
      if (areaM2 >= MIN_OPENING_AREA_M2) {
        totalM2 += areaM2;
      }
    }
  }
  return roundTo(totalM2, 2);
}
