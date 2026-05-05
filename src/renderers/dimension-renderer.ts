import { BuildingModel } from '../types.js';
import { SvgRenderConfig, mmToSvg, mmToSvgLength, svgGroup } from '../svg-utils.js';
import { cumulativePositions, deduplicatedSorted } from './gridline-renderer.js';
import {
  DIM_OFFSET,
  DIM_TICK_SIZE as TICK_SIZE,
  DIM_DOT_RADIUS as DOT_RADIUS,
  DIM_LABEL_FONT_SIZE as LABEL_FONT_SIZE,
  DIM_LABEL_OFFSET_HORIZONTAL as LABEL_OFFSET_HORIZONTAL,
  DIM_LABEL_OFFSET_VERTICAL as LABEL_OFFSET_VERTICAL,
} from './style-constants.js';

export function renderDimensions(model: BuildingModel, config: SvgRenderConfig): string {
  const elements: string[] = [];
  const mod = model.moduleSize;
  const totalW = model.totalGridX * mod;
  const totalH = model.totalGridY * mod;

  // Check if grid-line dimensions will be rendered (shifts other rows outward)
  const gridLineDimElements = renderGridLineDimensions(model, config, -DIM_OFFSET);
  const hasGridLineDims = gridLineDimElements.length > 0;
  const rowOffset = hasGridLineDims ? 1 : 0; // shift span/total rows outward by 1

  // Span dimensions (row 1 normally, row 2 when grid-line dims present)
  const spanRow = -(1 + rowOffset) * DIM_OFFSET;
  elements.push(...renderXDimensions(model, config, spanRow));
  elements.push(...renderYDimensions(model, config, spanRow));

  // Total dimension (row 2 normally, row 3 when grid-line dims present)
  const totalRow = -(2 + rowOffset) * DIM_OFFSET;
  elements.push(...renderTotalDimension(
    0, totalRow, totalW, totalRow,
    totalW, 'horizontal', config,
  ));
  elements.push(...renderTotalDimension(
    totalRow, 0, totalRow, totalH,
    totalH, 'vertical', config,
  ));

  if (hasGridLineDims) {
    return svgGroup('gridline-dimensions', gridLineDimElements) + '\n' + svgGroup('dimensions', elements);
  }

  return svgGroup('dimensions', elements);
}

function renderXDimensions(model: BuildingModel, config: SvgRenderConfig, yOffset: number): string[] {
  const elements: string[] = [];
  const mod = model.moduleSize;

  // Collect unique X coordinates from room boundaries
  const xCoords = new Set<number>();
  xCoords.add(0);
  xCoords.add(model.totalGridX * mod);

  for (const room of model.rooms) {
    for (const r of room.rects) {
      xCoords.add(r.x);
      xCoords.add(r.x + r.w);
    }
  }

  const sorted = [...xCoords].sort((a, b) => a - b);

  for (let i = 0; i < sorted.length - 1; i++) {
    const x1 = sorted[i];
    const x2 = sorted[i + 1];
    const distance = x2 - x1;

    elements.push(...renderTotalDimension(x1, yOffset, x2, yOffset, distance, 'horizontal', config));
  }

  return elements;
}

function renderYDimensions(model: BuildingModel, config: SvgRenderConfig, xOffset: number): string[] {
  const elements: string[] = [];
  const mod = model.moduleSize;

  const yCoords = new Set<number>();
  yCoords.add(0);
  yCoords.add(model.totalGridY * mod);

  for (const room of model.rooms) {
    for (const r of room.rects) {
      yCoords.add(r.y);
      yCoords.add(r.y + r.h);
    }
  }

  const sorted = [...yCoords].sort((a, b) => a - b);

  for (let i = 0; i < sorted.length - 1; i++) {
    const y1 = sorted[i];
    const y2 = sorted[i + 1];
    const distance = y2 - y1;

    elements.push(...renderTotalDimension(xOffset, y1, xOffset, y2, distance, 'vertical', config));
  }

  return elements;
}

function renderGridLineDimensions(model: BuildingModel, config: SvgRenderConfig, offset: number): string[] {
  if (!model.rendering?.grid_lines?.enabled) return [];

  const elements: string[] = [];
  const mod = model.moduleSize;

  // Compute grid-line positions (same logic as gridline-renderer)
  const xSpanMm = cumulativePositions(model.xSpans).map(g => g * mod);
  const ySpanMm = cumulativePositions(model.ySpans).map(g => g * mod);
  const extra = model.extraGridLines;
  const allXMm = deduplicatedSorted([...xSpanMm, ...extra.x]);
  const allYMm = deduplicatedSorted([...ySpanMm, ...extra.y]);

  // Only render if grid-line positions differ from span boundaries (extra lines exist)
  const xSpanSorted = deduplicatedSorted(xSpanMm);
  const ySpanSorted = deduplicatedSorted(ySpanMm);
  const xDiffers = allXMm.length !== xSpanSorted.length || allXMm.some((v, i) => v !== xSpanSorted[i]);
  const yDiffers = allYMm.length !== ySpanSorted.length || allYMm.some((v, i) => v !== ySpanSorted[i]);

  if (!xDiffers && !yDiffers) return [];

  if (xDiffers) {
    for (let i = 0; i < allXMm.length - 1; i++) {
      const x1 = allXMm[i];
      const x2 = allXMm[i + 1];
      elements.push(...renderTotalDimension(x1, offset, x2, offset, x2 - x1, 'horizontal', config));
    }
  }
  if (yDiffers) {
    for (let i = 0; i < allYMm.length - 1; i++) {
      const y1 = allYMm[i];
      const y2 = allYMm[i + 1];
      elements.push(...renderTotalDimension(offset, y1, offset, y2, y2 - y1, 'vertical', config));
    }
  }

  return elements;
}

function renderTotalDimension(
  x1mm: number, y1mm: number, x2mm: number, y2mm: number,
  distance: number,
  orientation: 'horizontal' | 'vertical',
  config: SvgRenderConfig,
): string[] {
  const p1 = mmToSvg(x1mm, y1mm, config);
  const p2 = mmToSvg(x2mm, y2mm, config);
  const elements: string[] = [];

  // Dimension line
  elements.push(
    `<line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}" stroke="#666" stroke-width="0.5"/>`
  );

  // End ticks
  if (orientation === 'horizontal') {
    elements.push(
      `<line x1="${p1.x.toFixed(2)}" y1="${(p1.y - TICK_SIZE).toFixed(2)}" x2="${p1.x.toFixed(2)}" y2="${(p1.y + TICK_SIZE).toFixed(2)}" stroke="#666" stroke-width="0.8"/>`,
      `<line x1="${p2.x.toFixed(2)}" y1="${(p2.y - TICK_SIZE).toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${(p2.y + TICK_SIZE).toFixed(2)}" stroke="#666" stroke-width="0.8"/>`,
    );
  } else {
    elements.push(
      `<line x1="${(p1.x - TICK_SIZE).toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${(p1.x + TICK_SIZE).toFixed(2)}" y2="${p1.y.toFixed(2)}" stroke="#666" stroke-width="0.8"/>`,
      `<line x1="${(p2.x - TICK_SIZE).toFixed(2)}" y1="${p2.y.toFixed(2)}" x2="${(p2.x + TICK_SIZE).toFixed(2)}" y2="${p2.y.toFixed(2)}" stroke="#666" stroke-width="0.8"/>`,
    );
  }

  // Black dots at endpoints
  elements.push(
    `<circle cx="${p1.x.toFixed(2)}" cy="${p1.y.toFixed(2)}" r="${DOT_RADIUS}" fill="#333"/>`,
    `<circle cx="${p2.x.toFixed(2)}" cy="${p2.y.toFixed(2)}" r="${DOT_RADIUS}" fill="#333"/>`,
  );

  // Label
  const midX = ((p1.x + p2.x) / 2).toFixed(2);
  const midY = ((p1.y + p2.y) / 2).toFixed(2);
  const label = `${distance.toLocaleString()}`;

  if (orientation === 'horizontal') {
    elements.push(
      `<text x="${midX}" y="${(parseFloat(midY) - LABEL_OFFSET_HORIZONTAL).toFixed(2)}" text-anchor="middle" font-size="${LABEL_FONT_SIZE}" font-family="sans-serif" fill="#666">${label}</text>`
    );
  } else {
    elements.push(
      `<text x="${(parseFloat(midX) - LABEL_OFFSET_VERTICAL).toFixed(2)}" y="${midY}" text-anchor="middle" font-size="${LABEL_FONT_SIZE}" font-family="sans-serif" fill="#666" transform="rotate(-90, ${(parseFloat(midX) - LABEL_OFFSET_VERTICAL).toFixed(2)}, ${midY})">${label}</text>`
    );
  }

  return elements;
}
