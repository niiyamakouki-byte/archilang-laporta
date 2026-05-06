import { BuildingModel } from '../types.js';

export interface VwExportOptions {
  layer?: string;
  defaultWallClass?: string;
  origin?: { x: number; y: number };
  flipY?: boolean;
}

export interface VwScript {
  filename: string;
  pythonCode: string;
  meta: {
    wallCount: number;
    doorCount: number;
    windowCount: number;
    equipmentCount: number;
    generatedAt: string;
  };
}

export type ResolvedArchilang = BuildingModel & {
  archilangVersion?: string;
};
