/**
 * Visual style constants for renderers.
 *
 * Centralized so sizes, offsets, and colors of dimensions and grid-line markers
 * can be tuned in one place.
 */

// ─────────────────────────────────────────────
// Dimension renderer (寸法線・寸法ラベル)
// ─────────────────────────────────────────────

/** mm offset from building edge for dimension lines */
export const DIM_OFFSET = 250;

/** px — half-length of end ticks on dimension lines */
export const DIM_TICK_SIZE = 3;

/** px — filled dot radius at grid-line / dimension-line intersections */
export const DIM_DOT_RADIUS = 1.8;

/** px — dimension label text size */
export const DIM_LABEL_FONT_SIZE = 14;

/** px — label offset above horizontal dimension line */
export const DIM_LABEL_OFFSET_HORIZONTAL = 4;

/** px — label offset left of vertical dimension line */
export const DIM_LABEL_OFFSET_VERTICAL = 6;

// ─────────────────────────────────────────────
// Gridline renderer (通り芯・通り芯記号)
// ─────────────────────────────────────────────

/** mm — outermost dimension line distance from building edge (DIM_OFFSET × 3) */
export const GRID_DIM_OUTERMOST_MM = 750;

/** mm — clearance between outermost dimension line and gridline label */
export const GRID_CLEARANCE_MM = 200;

/** mm — how far the dash-dot grid line extends beyond the building */
export const GRID_EXTENSION_MM = GRID_DIM_OUTERMOST_MM + GRID_CLEARANCE_MM;

/** mm — center of the gridline label circle, beyond the extended line end */
export const GRID_LABEL_OFFSET_MM = GRID_DIM_OUTERMOST_MM + GRID_CLEARANCE_MM + 50;

/** px — radius of the circle around X1/Y1 etc. labels */
export const GRID_CIRCLE_RADIUS = 10;

/** px — text size inside the gridline label circle */
export const GRID_LABEL_FONT_SIZE = 10;

/** stroke color for gridlines, dimension lines, and label circles */
export const GRID_STROKE_COLOR = '#666';

/** fill color for gridline label text (X1, Y1, …) */
export const GRID_LABEL_TEXT_COLOR = '#333';

/** px — stroke width of dash-dot gridlines */
export const GRID_STROKE_WIDTH = 0.8;

/** px — stroke width of the label circle outline */
export const GRID_CIRCLE_STROKE_WIDTH = 1.0;

/** SVG stroke-dasharray pattern for the dash-dot gridline (一点鎖線) */
export const GRID_DASH_ARRAY = '12,4,2,4';
