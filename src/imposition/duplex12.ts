import { landscape, type Paper } from './paper.ts';
import { foldTicks } from './strip.ts';
import { insetPanel, type Guide, type ImpositionPlan, type MarginOptions, type SheetPlan, type Slot } from './types.ts';

/**
 * 12-page mini-zine from one duplex sheet, 4x2 per side, three cuts.
 *
 *   FRONT                          BACK (sheet flipped left-to-right)
 *   +----+----+----+----+          +----+----+----+----+
 *   | S8 | S7 | S6 | S5 |          | S4 |    |    | S9 |
 *   +----+----+----+----+          +----+----+----+----+
 *   | 11 | 12 |  1 |  2 |          |  3 |    |    | 10 |
 *   +----+----+----+----+          +----+----+----+----+
 *
 * Eight panels carry sixteen faces but only twelve pages. Flipping the sheet
 * left-to-right pairs front column c with back column 3-c, which puts pages
 * 8/9, 5/4, 11/10 and 2/3 back-to-back on four leaves. The middle two columns
 * have nothing on their reverse: those four faces are the front cover, the back
 * cover and the centre spread, and they end up buried in the folds. You only
 * see them by unfolding the whole thing, which makes them a decent hiding place
 * for a secret panel.
 *
 * A paired panel's two faces are one piece of paper, so they always share a
 * rotation — 8 and 9 are both inverted, 11 and 10 both upright. The tests lean
 * on that.
 *
 * Unlike [[river-cut]] and [[i-cut]], the cuts here cannot be derived from the
 * page order. Those are single-sided strips where consecutive pages must be
 * touching panels; here a page turn moves between stacked leaves that need not
 * be neighbours on the sheet, so the geometry is recorded rather than computed.
 */

/** `null` marks a face that finishes hidden inside the folds. */
type Face = number | null;

const FRONT: readonly (readonly Face[])[] = [
  [8, 7, 6, 5],
  [11, 12, 1, 2],
];

const BACK: readonly (readonly Face[])[] = [
  [4, null, null, 9],
  [3, null, null, 10],
];

const FLIPPED_ROWS = [true, false] as const;

export const DUPLEX12_PAGES_PER_SHEET = 12;

export interface Duplex12Options {
  paper: Paper;
  margins: MarginOptions;
  guides: boolean;
  /** True when the printer's duplex flip leaves the reverse upside down. */
  rotateBacks: boolean;
}

export function planDuplex12(sourceCount: number, opts: Duplex12Options): ImpositionPlan {
  const { width, height } = landscape(opts.paper);
  const rows = FRONT.length;
  const cols = FRONT[0]!.length;
  const pw = width / cols;
  const ph = height / rows;

  const zineCount = Math.max(1, Math.ceil(sourceCount / DUPLEX12_PAGES_PER_SHEET));
  const cuts = duplex12Cuts(width, height);
  const sheets: SheetPlan[] = [];

  for (let z = 0; z < zineCount; z++) {
    const base = z * DUPLEX12_PAGES_PER_SHEET;

    const build = (map: readonly (readonly Face[])[], side: 'front' | 'back'): SheetPlan => {
      const rotate = side === 'back' && opts.rotateBacks;
      const slots: Slot[] = [];

      map.forEach((cells, row) => {
        cells.forEach((page, col) => {
          if (page === null) return;
          // Pre-rotating the whole sheet moves every panel to the diagonally
          // opposite cell, so place it there and invert it.
          const placedRow = rotate ? rows - 1 - row : row;
          const placedCol = rotate ? cols - 1 - col : col;
          const flipped = FLIPPED_ROWS[row] ?? false;

          const raw = { x: placedCol * pw, y: (rows - 1 - placedRow) * ph, w: pw, h: ph };
          const source = base + page - 1;
          slots.push({
            source: source < sourceCount ? source : null,
            box: insetPanel(raw, width, height, opts.margins),
            rotate180: rotate ? !flipped : flipped,
            readerPage: base + page,
          });
        });
      });

      return {
        width,
        height,
        slots,
        // Cut marks belong on the side you are looking at when you cut, and you
        // only cut once. Repeating them on the reverse just spends ink.
        guides: opts.guides && side === 'front' ? cuts : [],
        side,
        signature: z + 1,
      };
    };

    sheets.push(build(FRONT, 'front'));
    sheets.push(build(BACK, 'back'));
  }

  const slotCount = zineCount * DUPLEX12_PAGES_PER_SHEET;
  return { sheets, slotCount, blanksAdded: slotCount - Math.min(sourceCount, slotCount) };
}

/**
 * A short dash in from each end of the centre line, and a stroke rising from
 * the middle of it to the top edge.
 */
function duplex12Cuts(width: number, height: number): Guide[] {
  const pw = width / 4;
  const ph = height / 2;
  const cuts: Guide[] = [
    { kind: 'cut', x1: 0, y1: ph, x2: pw, y2: ph },
    { kind: 'cut', x1: 3 * pw, y1: ph, x2: width, y2: ph },
    { kind: 'cut', x1: 2 * pw, y1: ph, x2: 2 * pw, y2: height },
  ];
  return [...cuts, ...foldTicks(cuts, 4, 2, width, height)];
}
