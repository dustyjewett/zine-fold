import { planStripZine, type StripOptions, type StripZine } from './strip.ts';
import type { ImpositionPlan } from './types.ts';

/**
 * "River Cut" — 16 pages, 4x4, single-sided, three slits.
 *
 *   +----+----+----+----+
 *   | S4 | S3 | S2 | S1 |   rows 0 and 2 print upside down
 *   +----+----+----+----+
 *   |  5 |  6 |  7 |  8 |
 *   +----+----+----+----+
 *   | 1Z | 11 | 10 |  9 |
 *   +----+----+----+----+
 *   | 13 | 14 | 15 | 16 |
 *   +----+----+----+----+
 *
 * The reading order snakes back and forth along each row, turning at
 * alternating ends. Each slit therefore stops one panel short, and the spared
 * panel is the hinge that carries you into the next row: 4->5 on the left,
 * 8->9 on the right, 12->13 on the left again. The three slits enter from
 * alternating edges, which is the meander the name refers to.
 *
 * Compare [[i-cut]], which routes the same grid differently.
 */
export const RIVER_CUT: StripZine = {
  orientation: 'portrait',
  flippedRows: [true, false, true, false],
  map: [
    [4, 3, 2, 1],
    [5, 6, 7, 8],
    [12, 11, 10, 9],
    [13, 14, 15, 16],
  ],
};

export const RIVER_CUT_PAGES_PER_SHEET = 16;

export function planRiverCut(sourceCount: number, opts: StripOptions): ImpositionPlan {
  return planStripZine(RIVER_CUT, sourceCount, opts);
}
