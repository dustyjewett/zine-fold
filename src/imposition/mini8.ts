import { planStripZine, type StripOptions, type StripZine } from './strip.ts';
import type { ImpositionPlan } from './types.ts';

/**
 * The classic 8-page one-sheet mini-zine: 4x2, single-sided, one centre slit.
 *
 *   +-----+-----+-----+-----+
 *   |  S5 |  S4 |  S3 |  S2 |   top row prints upside down
 *   +-----+-- cut ----+-----+
 *   |  6  |  7  |  8  |  1  |   page 1 is the front cover
 *   +-----+-----+-----+-----+
 *
 * Fold the sheet in half the short way, then in half twice more; unfold to the
 * first fold and slit the centre; unfold, fold the long way and push the ends
 * together so the slit opens out.
 *
 * The slit spanning the two middle panels is derived, not declared: pages 5-6
 * turn at the left edge and pages 8-1 wrap at the right, so those two
 * boundaries are hinges and the two between them must be cut. See `strip.ts`.
 */
export const MINI8: StripZine = {
  orientation: 'landscape',
  flippedRows: [true, false],
  map: [
    [5, 4, 3, 2],
    [6, 7, 8, 1],
  ],
};

export const MINI8_PAGES_PER_SHEET = 8;

export function planMini8(sourceCount: number, opts: StripOptions): ImpositionPlan {
  return planStripZine(MINI8, sourceCount, opts);
}
