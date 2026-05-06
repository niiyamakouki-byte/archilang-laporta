import { BuildingModel } from '../types.js';
import { findItemByCode } from './cost-master.js';
import { EQUIPMENT_MAPPINGS, OPENING_STYLE_MAPPINGS, ROOM_TYPE_MAPPINGS } from './mappings.js';
import { CostMasterDB, EstimateLine, LaportaEstimate } from './types.js';

export type ResolvedArchilang = BuildingModel & {
  archilangVersion?: string;
};

export function emitEstimate(model: ResolvedArchilang, db: CostMasterDB): LaportaEstimate {
  const lines: EstimateLine[] = [];

  for (const room of model.rooms) {
    const mapping = ROOM_TYPE_MAPPINGS.find(entry => entry.archilangType === room.type);
    if (!mapping) {
      continue;
    }

    const areaM2 = roundTo(room.boundingRect.w * room.boundingRect.h / 1_000_000, 2);
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
      const qty = roundTo(areaM2 * finish.areaMultiplier, 2);
      lines.push({
        code: item.code,
        name: `${item.name} (${finish.surface})`,
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

  const subtotal = roundTo(lines.reduce((sum, line) => sum + line.amount, 0), 2);
  const tax = roundTo(subtotal * 0.1, 2);
  const total = roundTo(subtotal + tax, 2);

  return {
    version: db.version,
    generatedAt: new Date().toISOString(),
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
