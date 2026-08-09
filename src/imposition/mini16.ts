import { portrait, type Paper } from './paper.ts';
import { insetPanel, type Guide, type ImpositionPlan, type MarginOptions, type SheetPlan, type Slot } from './types.ts';

/**
 * 16-page one-sheet mini-zine: a 4x4 grid, printed on one side, folded and slit
 * so the whole sheet becomes a single snaking strip of panels in reading order.
 *
 *   +----+----+----+----+
 *   | S4 | S3 | S2 | S1 |   rows 0 and 2 print upside down
 *   +----+----+----+----+
 *   |  5 |  6 |  7 |  8 |
 *   +----+----+----+----+
 *   | 1Z | 11 | 10 |  9 |
 *   +----+----+----+----+
 *   | 13 | 14 | 15 | 16 |   page 1 is the cover, top right
 *   +----+----+----+----+
 *
 * Consecutive pages are always neighbours, so each row boundary is slit for
 * three of its four panels and left joined at the fourth — that hinge is what
 * carries the reader from one row to the next. The hinges alternate sides
 * (left, right, left), which is why two slits open from the right edge and one
 * from the left.
 */
const ROWS: { pages: [number, number, number, number]; flip: boolean }[] = [
  { pages: [4, 3, 2, 1], flip: true },
  { pages: [5, 6, 7, 8], flip: false },
  { pages: [12, 11, 10, 9], flip: true },
  { pages: [13, 14, 15, 16], flip: false },
];

/** Column holding the uncut hinge below each row; the slit covers the rest. */
const HINGE_COLUMN = [0, 3, 0];

export const MINI16_PAGES_PER_SHEET = 16;

export interface Mini16Options {
  paper: Paper;
  margins: MarginOptions;
  guides: boolean;
}

export function planMini16(sourceCount: number, opts: Mini16Options): ImpositionPlan {
  // Portrait stock, unlike the 8-page zine: a 4x4 grid on a portrait sheet
  // gives portrait pages, which is the right shape for a booklet.
  const { width, height } = portrait(opts.paper);
  const pw = width / 4;
  const ph = height / 4;

  const sheetCount = Math.max(1, Math.ceil(sourceCount / MINI16_PAGES_PER_SHEET));
  const sheets: SheetPlan[] = [];

  for (let s = 0; s < sheetCount; s++) {
    const base = s * MINI16_PAGES_PER_SHEET;
    const slots: Slot[] = [];

    for (const [rowIndex, row] of ROWS.entries()) {
      for (const [col, localPage] of row.pages.entries()) {
        // Row 0 is the top of the sheet, so its box sits at the highest y.
        const raw = { x: col * pw, y: (3 - rowIndex) * ph, w: pw, h: ph };
        const source = base + localPage - 1;
        slots.push({
          source: source < sourceCount ? source : null,
          box: insetPanel(raw, width, height, opts.margins),
          rotate180: row.flip,
          readerPage: base + localPage,
        });
      }
    }

    sheets.push({
      width,
      height,
      slots,
      guides: opts.guides ? mini16Guides(width, height) : [],
      side: 'single',
      signature: s + 1,
    });
  }

  const slotCount = sheetCount * MINI16_PAGES_PER_SHEET;
  return { sheets, slotCount, blanksAdded: slotCount - Math.min(sourceCount, slotCount) };
}

function mini16Guides(width: number, height: number): Guide[] {
  const pw = width / 4;
  const ph = height / 4;
  const tick = Math.min(14, pw * 0.09);
  const guides: Guide[] = [];

  // Vertical folds run the full height and are never cut.
  for (const x of [pw, 2 * pw, 3 * pw]) {
    guides.push({ kind: 'fold', x1: x, y1: 0, x2: x, y2: tick });
    guides.push({ kind: 'fold', x1: x, y1: height - tick, x2: x, y2: height });
  }

  for (const [i, hinge] of HINGE_COLUMN.entries()) {
    const y = (3 - i) * ph; // boundary below row i
    if (hinge === 0) {
      // Hinge on the left: slit opens from the right edge across cols 1-3.
      guides.push({ kind: 'cut', x1: pw, y1: y, x2: width, y2: y });
      guides.push({ kind: 'fold', x1: 0, y1: y, x2: tick, y2: y });
    } else {
      // Hinge on the right: slit opens from the left edge across cols 0-2.
      guides.push({ kind: 'cut', x1: 0, y1: y, x2: 3 * pw, y2: y });
      guides.push({ kind: 'fold', x1: width - tick, y1: y, x2: width, y2: y });
    }
  }

  return guides;
}
