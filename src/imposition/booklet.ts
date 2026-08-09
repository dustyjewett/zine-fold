import { landscape, type Paper } from './paper.ts';
import { insetPanel, type Guide, type ImpositionPlan, type MarginOptions, type SheetPlan, type Slot } from './types.ts';

export interface BookletOptions {
  paper: Paper;
  margins: MarginOptions;
  guides: boolean;
  /** Sheets of paper per signature; each sheet carries 4 pages. */
  sheetsPerSignature: number | 'single';
  binding: 'left' | 'right';
  /**
   * True when the printer's duplex flip leaves the reverse side upside down
   * relative to the front (long-edge binding on a landscape sheet).
   */
  rotateBacks: boolean;
}

export function planBooklet(sourceCount: number, opts: BookletOptions): ImpositionPlan {
  const { width, height } = landscape(opts.paper);
  const pw = width / 2;

  const totalSheets = Math.max(1, Math.ceil(sourceCount / 4));
  const maxPerSig = opts.sheetsPerSignature === 'single'
    ? totalSheets
    : Math.max(1, Math.floor(opts.sheetsPerSignature));

  // Fill signatures to `maxPerSig` and let the last one be short, so a 24-page
  // document at 4 sheets/signature binds as 4 + 2 sheets with nothing wasted
  // rather than 4 + 4 with eight blanks.
  const sigSizes: number[] = [];
  for (let left = totalSheets; left > 0; left -= maxPerSig) {
    sigSizes.push(Math.min(maxPerSig, left));
  }

  const slotCount = sigSizes.reduce((sum, n) => sum + n * 4, 0);
  const sheets: SheetPlan[] = [];
  let base = 0;

  for (const [sigIndex, sheetsInSig] of sigSizes.entries()) {
    const n = sheetsInSig * 4; // pages carried by this signature
    const first = base; // 0-based index of this signature's first page
    base += n;

    const makeSheet = (pair: [number, number], side: 'front' | 'back'): SheetPlan => {
      const [leftPage, rightPage] = opts.binding === 'right' ? [pair[1], pair[0]] : pair;
      const rotate180 = side === 'back' && opts.rotateBacks;

      const slot = (col: 0 | 1, localPage: number): Slot => {
        const raw = { x: col * pw, y: 0, w: pw, h: height };
        const source = first + localPage - 1;
        return {
          source: source < sourceCount ? source : null,
          box: insetPanel(raw, width, height, opts.margins),
          rotate180,
          readerPage: first + localPage,
        };
      };

      return {
        width,
        height,
        // Turning the whole sheet upside down swaps which half is physically on
        // the left, so when we pre-rotate we also have to swap the two panels.
        slots: rotate180
          ? [slot(0, rightPage), slot(1, leftPage)]
          : [slot(0, leftPage), slot(1, rightPage)],
        guides: opts.guides ? bookletGuides(width, height) : [],
        side,
        signature: sigIndex + 1,
      };
    };

    for (let i = 0; i < sheetsInSig; i++) {
      // Saddle stitch: the outermost sheet carries the first and last pages,
      // and each sheet inwards moves two pages in from each end.
      sheets.push(makeSheet([n - 2 * i, 1 + 2 * i], 'front'));
      sheets.push(makeSheet([2 + 2 * i, n - 1 - 2 * i], 'back'));
    }
  }

  return { sheets, slotCount, blanksAdded: slotCount - Math.min(sourceCount, slotCount) };
}

function bookletGuides(width: number, height: number): Guide[] {
  const x = width / 2;
  const tick = Math.min(18, height * 0.05);
  return [
    { kind: 'fold', x1: x, y1: 0, x2: x, y2: tick },
    { kind: 'fold', x1: x, y1: height - tick, x2: x, y2: height },
  ];
}
