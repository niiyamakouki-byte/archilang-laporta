import { BuildingModel } from '../types.js';
import { SvgRenderConfig, mmToSvg, svgGroup, escapeXml } from '../svg-utils.js';
import {
  GRID_EXTENSION_MM as EXTENSION_MM,
  GRID_LABEL_OFFSET_MM as LABEL_OFFSET_MM,
  GRID_CIRCLE_RADIUS as CIRCLE_RADIUS,
  GRID_LABEL_FONT_SIZE as FONT_SIZE,
  GRID_STROKE_COLOR as STROKE_COLOR,
  GRID_LABEL_TEXT_COLOR as LABEL_TEXT_COLOR,
  GRID_STROKE_WIDTH as STROKE_WIDTH,
  GRID_CIRCLE_STROKE_WIDTH as CIRCLE_STROKE_WIDTH,
  GRID_DASH_ARRAY as DASH_ARRAY,
} from './style-constants.js';

/**
 * Render structural grid lines (通り芯).
 * Draws dash-dot lines at x_spans/y_spans boundary positions
 * with circle+label markers at both ends.
 */
export function renderGridLines(model: BuildingModel, config: SvgRenderConfig): string {
  const elements: string[] = [];
  const mod = model.moduleSize;
  const totalW = model.totalGridX * mod;
  const totalH = model.totalGridY * mod;

  // Merge span positions with extra grid lines, sort, deduplicate
  const xSpanMm = cumulativePositions(model.xSpans).map(g => g * mod);
  const ySpanMm = cumulativePositions(model.ySpans).map(g => g * mod);
  const extra = model.extraGridLines;
  const allXMm = deduplicatedSorted([...xSpanMm, ...extra.x]);
  const allYMm = deduplicatedSorted([...ySpanMm, ...extra.y]);

  // X-direction grid lines (vertical lines)
  allXMm.forEach((xMm, i) => {
    const p1 = mmToSvg(xMm, -EXTENSION_MM, config);
    const p2 = mmToSvg(xMm, totalH + EXTENSION_MM, config);

    elements.push(
      `<line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}" stroke="${STROKE_COLOR}" stroke-width="${STROKE_WIDTH}" stroke-dasharray="${DASH_ARRAY}" stroke-linecap="round"/>`
    );

    const label = `X${i + 1}`;
    const bottomPos = mmToSvg(xMm, -LABEL_OFFSET_MM, config);
    elements.push(renderCircleLabel(bottomPos.x, bottomPos.y, label));
    const topPos = mmToSvg(xMm, totalH + LABEL_OFFSET_MM, config);
    elements.push(renderCircleLabel(topPos.x, topPos.y, label));
  });

  // Y-direction grid lines (horizontal lines)
  allYMm.forEach((yMm, i) => {
    const p1 = mmToSvg(-EXTENSION_MM, yMm, config);
    const p2 = mmToSvg(totalW + EXTENSION_MM, yMm, config);

    elements.push(
      `<line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}" stroke="${STROKE_COLOR}" stroke-width="${STROKE_WIDTH}" stroke-dasharray="${DASH_ARRAY}" stroke-linecap="round"/>`
    );

    const label = `Y${i + 1}`;
    const leftPos = mmToSvg(-LABEL_OFFSET_MM, yMm, config);
    elements.push(renderCircleLabel(leftPos.x, leftPos.y, label));
    const rightPos = mmToSvg(totalW + LABEL_OFFSET_MM, yMm, config);
    elements.push(renderCircleLabel(rightPos.x, rightPos.y, label));
  });

  return svgGroup('gridlines', elements);
}

/** Compute the SVG px padding needed beyond the base margin for gridline labels. */
export function getGridLinePadding(config: SvgRenderConfig): number {
  const labelEdgePx = LABEL_OFFSET_MM * config.scale - config.margin + CIRCLE_RADIUS + CIRCLE_STROKE_WIDTH / 2;
  return Math.max(0, Math.ceil(labelEdgePx));
}

/** Sort and deduplicate numeric positions */
export function deduplicatedSorted(positions: number[]): number[] {
  return [...new Set(positions)].sort((a, b) => a - b);
}

/** Convert spans [3, 5] → cumulative positions [0, 3, 8] */
export function cumulativePositions(spans: number[]): number[] {
  const positions: number[] = [0];
  let acc = 0;
  for (const s of spans) {
    acc += s;
    positions.push(acc);
  }
  return positions;
}

/** Render a circle with a centered text label */
function renderCircleLabel(cx: number, cy: number, label: string): string {
  return [
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${CIRCLE_RADIUS}" stroke="${STROKE_COLOR}" stroke-width="${CIRCLE_STROKE_WIDTH}" fill="white"/>`,
    `<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="${FONT_SIZE}" fill="${LABEL_TEXT_COLOR}" font-family="sans-serif">${escapeXml(label)}</text>`,
  ].join('\n');
}
