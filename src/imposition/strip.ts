import type { Paper } from './paper.ts';
import { landscape, portrait } from './paper.ts';
import { insetPanel, type Guide, type ImpositionPlan, type MarginOptions, type SheetPlan, type Slot } from './types.ts';

/**
 * Shared machinery for the single-sided fold-and-slit zines.
 *
 * All of them are the same idea: a grid of panels printed on one side of a
 * sheet, slit so the paper becomes a single strip running through the pages in
 * reading order. They differ only in how that strip is routed.
 *
 * Because the route determines everything, the slits are *derived* from the
 * panel map rather than written down beside it. Two panels that hold
 * consecutive pages must stay joined; every other boundary between neighbouring
 * panels has to be cut, or the sheet cannot open out. Getting the cuts wrong is
 * therefore impossible by construction — they cannot drift from the layout.
 */

/** `map[row][col]` is the 1-based reader page in that panel. Row 0 is the top. */
export type PanelMap = readonly (readonly number[])[];

export interface StripZine {
  /** Rows printed upside down, indexed like `map`. */
  readonly flippedRows: readonly boolean[];
  readonly map: PanelMap;
  readonly orientation: 'portrait' | 'landscape';
}

export interface StripOptions {
  paper: Paper;
  margins: MarginOptions;
  guides: boolean;
}

const hKey = (row: number, col: number) => `H${row}.${col}`; // boundary below `row`
const vKey = (col: number, row: number) => `V${col}.${row}`; // boundary right of `col`

function locate(map: PanelMap): Map<number, { row: number; col: number }> {
  const at = new Map<number, { row: number; col: number }>();
  map.forEach((cells, row) => cells.forEach((page, col) => at.set(page, { row, col })));
  return at;
}

/**
 * Boundaries the strip travels through, and so must not be cut. Includes the
 * wrap from the last page back to the cover when those panels are neighbours:
 * in the finished zine that boundary is the spine fold.
 */
function joinedEdges(map: PanelMap): Set<string> {
  const at = locate(map);
  const total = map.length * (map[0]?.length ?? 0);
  const kept = new Set<string>();

  const join = (a?: { row: number; col: number }, b?: { row: number; col: number }) => {
    if (!a || !b) return;
    if (a.col === b.col && Math.abs(a.row - b.row) === 1) kept.add(hKey(Math.min(a.row, b.row), a.col));
    if (a.row === b.row && Math.abs(a.col - b.col) === 1) kept.add(vKey(Math.min(a.col, b.col), a.row));
  };

  for (let page = 1; page < total; page++) join(at.get(page), at.get(page + 1));
  join(at.get(total), at.get(1));
  return kept;
}

/** Collapse a sorted list of indices into runs of consecutive values. */
function runs(indices: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const i of indices) {
    const last = out[out.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else out.push([i, i]);
  }
  return out;
}

export function deriveGuides(map: PanelMap, width: number, height: number): Guide[] {
  const rows = map.length;
  const cols = map[0]?.length ?? 0;
  const pw = width / cols;
  const ph = height / rows;
  const kept = joinedEdges(map);
  const guides: Guide[] = [];

  // y of the boundary below a row; row 0 sits at the top of the sheet.
  const boundaryY = (row: number) => (rows - 1 - row) * ph;

  const cuts: Guide[] = [];
  for (let row = 0; row < rows - 1; row++) {
    const open = [...Array(cols).keys()].filter((col) => !kept.has(hKey(row, col)));
    for (const [from, to] of runs(open)) {
      cuts.push({ kind: 'cut', x1: from * pw, y1: boundaryY(row), x2: (to + 1) * pw, y2: boundaryY(row) });
    }
  }
  for (let col = 0; col < cols - 1; col++) {
    const open = [...Array(rows).keys()].filter((row) => !kept.has(vKey(col, row)));
    for (const [from, to] of runs(open)) {
      // `from` is the topmost row of the run, so it gives the higher y.
      cuts.push({ kind: 'cut', x1: (col + 1) * pw, y1: boundaryY(to), x2: (col + 1) * pw, y2: (rows - from) * ph });
    }
  }
  guides.push(...cuts);

  guides.push(...foldTicks(cuts, cols, rows, width, height));
  return guides;
}

/**
 * Short marks where each fold meets the paper's edge — but only where a slit
 * has not already reached that edge, since a fold mark on top of a cut
 * contradicts it.
 */
export function foldTicks(
  cuts: Guide[],
  cols: number,
  rows: number,
  width: number,
  height: number,
): Guide[] {
  const pw = width / cols;
  const ph = height / rows;
  const tick = Math.min(14, Math.min(pw, ph) * 0.09);
  const ticks: Guide[] = [];

  const touches = (x: number, y: number) =>
    cuts.some((c) =>
      Math.min(c.x1, c.x2) - 0.01 <= x && x <= Math.max(c.x1, c.x2) + 0.01 &&
      Math.min(c.y1, c.y2) - 0.01 <= y && y <= Math.max(c.y1, c.y2) + 0.01);

  for (let row = 0; row < rows - 1; row++) {
    const y = (rows - 1 - row) * ph;
    if (!touches(0, y)) ticks.push({ kind: 'fold', x1: 0, y1: y, x2: tick, y2: y });
    if (!touches(width, y)) ticks.push({ kind: 'fold', x1: width - tick, y1: y, x2: width, y2: y });
  }
  for (let col = 0; col < cols - 1; col++) {
    const x = (col + 1) * pw;
    if (!touches(x, 0)) ticks.push({ kind: 'fold', x1: x, y1: 0, x2: x, y2: tick });
    if (!touches(x, height)) ticks.push({ kind: 'fold', x1: x, y1: height - tick, x2: x, y2: height });
  }

  return ticks;
}

export function planStripZine(
  zine: StripZine,
  sourceCount: number,
  opts: StripOptions,
): ImpositionPlan {
  const { width, height } = zine.orientation === 'portrait' ? portrait(opts.paper) : landscape(opts.paper);
  const rows = zine.map.length;
  const cols = zine.map[0]?.length ?? 0;
  const perSheet = rows * cols;
  const pw = width / cols;
  const ph = height / rows;

  const sheetCount = Math.max(1, Math.ceil(sourceCount / perSheet));
  const guides = opts.guides ? deriveGuides(zine.map, width, height) : [];
  const sheets: SheetPlan[] = [];

  for (let s = 0; s < sheetCount; s++) {
    const base = s * perSheet;
    const slots: Slot[] = [];

    zine.map.forEach((cells, row) => {
      cells.forEach((localPage, col) => {
        const raw = { x: col * pw, y: (rows - 1 - row) * ph, w: pw, h: ph };
        const source = base + localPage - 1;
        slots.push({
          source: source < sourceCount ? source : null,
          box: insetPanel(raw, width, height, opts.margins),
          rotate180: zine.flippedRows[row] ?? false,
          readerPage: base + localPage,
        });
      });
    });

    sheets.push({ width, height, slots, guides, side: 'single', signature: s + 1 });
  }

  const slotCount = sheetCount * perSheet;
  return { sheets, slotCount, blanksAdded: slotCount - Math.min(sourceCount, slotCount) };
}
