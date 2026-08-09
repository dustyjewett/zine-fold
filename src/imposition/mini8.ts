import { landscape, type Paper } from './paper.ts';
import { insetPanel, type Guide, type ImpositionPlan, type MarginOptions, type SheetPlan, type Slot } from './types.ts';

/**
 * Reader page for each cell of the 4x2 grid, left to right.
 *
 * The classic one-sheet mini-zine: fold the sheet in half the short way, then
 * in half twice more; unfold to the first fold and slit the centre; unfold,
 * fold the long way and push the ends together so the slit opens out.
 *
 *   +----+----+----+----+
 *   | S5 | S4 | S3 | S2 |   top row, printed upside down
 *   +----+----+----+----+
 *   |  6 |  7 |  8 |  1 |   bottom row, upright — page 1 is the front cover
 *   +----+----+----+----+
 */
const TOP_ROW = [5, 4, 3, 2];
const BOTTOM_ROW = [6, 7, 8, 1];

export const MINI8_PAGES_PER_SHEET = 8;

export interface Mini8Options {
  paper: Paper;
  margins: MarginOptions;
  guides: boolean;
}

export function planMini8(sourceCount: number, opts: Mini8Options): ImpositionPlan {
  const { width, height } = landscape(opts.paper);
  const pw = width / 4;
  const ph = height / 2;

  // Each group of 8 source pages becomes one independent single-sided sheet.
  const sheetCount = Math.max(1, Math.ceil(sourceCount / MINI8_PAGES_PER_SHEET));
  const slotCount = sheetCount * MINI8_PAGES_PER_SHEET;
  const sheets: SheetPlan[] = [];

  for (let s = 0; s < sheetCount; s++) {
    const base = s * MINI8_PAGES_PER_SHEET;
    const slots: Slot[] = [];

    const cell = (col: number, row: 0 | 1, localPage: number): Slot => {
      const raw = { x: col * pw, y: row === 0 ? ph : 0, w: pw, h: ph };
      const source = base + localPage - 1;
      return {
        source: source < sourceCount ? source : null,
        box: insetPanel(raw, width, height, opts.margins),
        rotate180: row === 0,
        readerPage: base + localPage,
      };
    };

    for (let col = 0; col < 4; col++) slots.push(cell(col, 0, TOP_ROW[col]!));
    for (let col = 0; col < 4; col++) slots.push(cell(col, 1, BOTTOM_ROW[col]!));

    sheets.push({
      width,
      height,
      slots,
      guides: opts.guides ? mini8Guides(width, height) : [],
      side: 'single',
      signature: s + 1,
    });
  }

  return { sheets, slotCount, blanksAdded: slotCount - Math.min(sourceCount, slotCount) };
}

function mini8Guides(width: number, height: number): Guide[] {
  const pw = width / 4;
  const ph = height / 2;
  const tick = Math.min(14, ph * 0.06);
  const guides: Guide[] = [];

  // Vertical folds: ticks bleeding in from the top and bottom edges.
  for (const x of [pw, 2 * pw, 3 * pw]) {
    guides.push({ kind: 'fold', x1: x, y1: 0, x2: x, y2: tick });
    guides.push({ kind: 'fold', x1: x, y1: height - tick, x2: x, y2: height });
  }
  // Horizontal fold: ticks from the left and right edges.
  guides.push({ kind: 'fold', x1: 0, y1: ph, x2: tick, y2: ph });
  guides.push({ kind: 'fold', x1: width - tick, y1: ph, x2: width, y2: ph });

  // The slit runs along the centre fold across the two middle panels only.
  guides.push({ kind: 'cut', x1: pw, y1: ph, x2: 3 * pw, y2: ph });

  return guides;
}
