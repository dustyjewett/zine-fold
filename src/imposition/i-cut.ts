import { planStripZine, type StripOptions, type StripZine } from './strip.ts';
import type { ImpositionPlan } from './types.ts';

/**
 * "-Ɪ- cut" — 16 pages, 4x4, single-sided, named for the shape its slits make.
 *
 *   +----+----+----+----+
 *   |  9 |  8 |  7 |  6 |   rows 0 and 2 print upside down
 *   +----+---- cut ----+
 *   | 10 | 11 |  4 |  5 |
 *   +cut+    cut     +cut+
 *   | 13 | 12 |  3 |  2 |
 *   +----+---- cut ----+
 *   | 14 | 15 | 16 |  1 |
 *   +----+----+----+----+
 *
 * The strip spirals rather than snaking: out from the cover at the bottom
 * right, up and around the right half, across the top, then back down through
 * the left half. Pages 16 and 1 end up side by side, and that boundary is the
 * spine fold where the finished zine wraps shut, so it is left uncut.
 *
 * Slitting every boundary the route does not use leaves a vertical stroke down
 * the middle with a crossbar at each end, plus a short dash at either edge on
 * the centre line — which reads as -Ɪ-, hence the name. Those cuts are derived
 * from the map in `strip.ts`, not written out here.
 *
 * Adapted from the Idaho Commission for Libraries template, renumbered so the
 * front cover is page 1 and the back cover is page 16.
 *
 * Compare [[river-cut]], which routes the same grid as a simple boustrophedon.
 */
export const I_CUT: StripZine = {
  orientation: 'portrait',
  flippedRows: [true, false, true, false],
  map: [
    [9, 8, 7, 6],
    [10, 11, 4, 5],
    [13, 12, 3, 2],
    [14, 15, 16, 1],
  ],
};

export const I_CUT_PAGES_PER_SHEET = 16;

export function planICut(sourceCount: number, opts: StripOptions): ImpositionPlan {
  return planStripZine(I_CUT, sourceCount, opts);
}
