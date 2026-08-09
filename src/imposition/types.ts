/** Everything in this module works in PDF points (1/72 inch), origin bottom-left. */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How a source page is sized into its panel. */
export type FitMode = 'contain' | 'cover' | 'stretch';

/**
 * One source page dropped into one panel of an output sheet.
 * `source` is a 0-based index into the (already range-filtered) source page
 * list, or `null` for a padding blank.
 */
export interface Slot {
  source: number | null;
  box: Box;
  /** Panels in the top row of a mini-zine are printed upside down. */
  rotate180: boolean;
  /** 1-based position in the finished, folded zine. Used for the debug overlay. */
  readerPage: number;
}

export type GuideKind = 'fold' | 'cut';

/**
 * A fold or cut mark. Folds render as short ticks bleeding in from the sheet
 * edge (minimal ink, still easy to line up); cuts render as a full dashed line
 * because you have to follow them with scissors.
 */
export interface Guide {
  kind: GuideKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SheetPlan {
  /** Output page size, always landscape for the layouts we support. */
  width: number;
  height: number;
  slots: Slot[];
  guides: Guide[];
  /** Which physical side this is; drives the duplex 180-degree correction. */
  side: 'front' | 'back' | 'single';
  /** 1-based signature number, for the status readout. */
  signature: number;
}

export interface ImpositionPlan {
  sheets: SheetPlan[];
  /** Total slots, i.e. source pages after padding to a full signature. */
  slotCount: number;
  /** How many blanks were appended to fill out the last signature. */
  blanksAdded: number;
}

export interface MarginOptions {
  /** Inset applied to every side of every panel (the fold-side gutter). */
  panel: number;
  /** Extra inset added only on panel sides that touch the paper edge. */
  edge: number;
}

/** Inset a panel, adding `edge` on whichever sides sit against the sheet border. */
export function insetPanel(box: Box, sheetW: number, sheetH: number, m: MarginOptions): Box {
  const eps = 0.01;
  const left = box.x <= eps ? m.panel + m.edge : m.panel;
  const right = box.x + box.w >= sheetW - eps ? m.panel + m.edge : m.panel;
  const bottom = box.y <= eps ? m.panel + m.edge : m.panel;
  const top = box.y + box.h >= sheetH - eps ? m.panel + m.edge : m.panel;

  return {
    x: box.x + left,
    y: box.y + bottom,
    w: Math.max(1, box.w - left - right),
    h: Math.max(1, box.h - bottom - top),
  };
}
