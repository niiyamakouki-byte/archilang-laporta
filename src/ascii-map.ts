import { InspectionReport } from './inspect.js';

/**
 * Render an ASCII map of the occupancy grid.
 * Y axis is displayed with top = max (architectural convention: north up).
 */
export function renderAsciiMap(report: InspectionReport): string {
  const { occupancyGrid, grid } = report;
  const { totalX, totalY } = grid;

  // Build short labels for room IDs (max 4 chars)
  const shortLabels = buildShortLabels(report.rooms.map(r => r.id));
  const cellWidth = 4;

  const lines: string[] = [];

  // Header: X axis labels
  const xHeader = '   ' + Array.from({ length: totalX }, (_, i) =>
    String(i).padStart(cellWidth)
  ).join('');
  lines.push(xHeader);

  // Rows: Y from top (totalY-1) to bottom (0)
  for (let y = totalY - 1; y >= 0; y--) {
    const rowLabel = String(y).padStart(2);
    const cells: string[] = [];
    for (let x = 0; x < totalX; x++) {
      const roomId = occupancyGrid[y]?.[x] ?? '';
      if (roomId === '') {
        cells.push(' '.repeat(cellWidth));
      } else {
        cells.push((shortLabels.get(roomId) ?? roomId.slice(0, cellWidth)).padEnd(cellWidth));
      }
    }

    // Insert wall separators between cells
    let row = rowLabel + ' ';
    for (let x = 0; x < totalX; x++) {
      const curr = occupancyGrid[y]?.[x] ?? '';
      const prev = x > 0 ? (occupancyGrid[y]?.[x - 1] ?? '') : '__boundary__';

      if (x === 0) {
        row += curr ? '|' : ' ';
      } else if (curr !== prev) {
        row += '|';
      } else {
        row += ' ';
      }
      row += cells[x];
    }
    // Right boundary
    const lastCell = occupancyGrid[y]?.[totalX - 1] ?? '';
    row += lastCell ? '|' : ' ';

    // Horizontal separators (top of each row)
    if (y === totalY - 1) {
      // Top border
      const border = '   ' + buildHorizontalBorder(occupancyGrid, y, totalX, cellWidth, 'top');
      lines.push(border);
    }

    lines.push(row);

    // Bottom border of this row (between y and y-1)
    const border = '   ' + buildHorizontalBorder(occupancyGrid, y, totalX, cellWidth, 'bottom');
    lines.push(border);
  }

  return lines.join('\n');
}

function buildHorizontalBorder(
  grid: string[][],
  y: number,
  totalX: number,
  cellWidth: number,
  position: 'top' | 'bottom',
): string {
  let border = '';
  for (let x = 0; x < totalX; x++) {
    const curr = grid[y]?.[x] ?? '';
    const adjacent = position === 'top'
      ? (grid[y + 1]?.[x] ?? '')
      : (grid[y - 1]?.[x] ?? '');

    const needsBorder = curr !== adjacent;
    const prevCurr = x > 0 ? (grid[y]?.[x - 1] ?? '') : '';
    const prevAdj = position === 'top'
      ? (x > 0 ? (grid[y + 1]?.[x - 1] ?? '') : '')
      : (x > 0 ? (grid[y - 1]?.[x - 1] ?? '') : '');

    // Corner/junction
    const hasVerticalWall = x === 0 || curr !== prevCurr || adjacent !== prevAdj;
    border += hasVerticalWall ? '+' : (needsBorder ? '-' : ' ');
    border += needsBorder ? '-'.repeat(cellWidth) : ' '.repeat(cellWidth);
  }
  // Final corner
  const lastCurr = grid[y]?.[totalX - 1] ?? '';
  const lastAdj = position === 'top'
    ? (grid[y + 1]?.[totalX - 1] ?? '')
    : (grid[y - 1]?.[totalX - 1] ?? '');
  border += (lastCurr !== lastAdj || lastCurr !== '') ? '+' : ' ';

  return border;
}

function buildShortLabels(roomIds: string[]): Map<string, string> {
  const labels = new Map<string, string>();
  const used = new Set<string>();

  for (const id of roomIds) {
    // Try first 4 chars
    let label = id.slice(0, 4);
    if (!used.has(label)) {
      used.add(label);
      labels.set(id, label);
      continue;
    }
    // Try first 3 + number
    for (let i = 1; i <= 9; i++) {
      label = id.slice(0, 3) + i;
      if (!used.has(label)) {
        used.add(label);
        labels.set(id, label);
        break;
      }
    }
  }

  return labels;
}
