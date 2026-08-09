import { degrees, type PDFDocument, type PDFEmbeddedPage, type PDFPage } from 'pdf-lib';
import type { Box, FitMode } from './types.ts';

export interface BBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface SourcePage {
  index: number;
  page: PDFPage;
  /** CropBox in the page's own coordinate space (may not start at the origin). */
  crop: BBox;
  /** The page's /Rotate entry, normalised to 0 | 90 | 180 | 270 (clockwise). */
  rotation: number;
}

const norm360 = (a: number) => ((Math.round(a / 90) * 90) % 360 + 360) % 360;

export function describeSource(page: PDFPage, index: number): SourcePage {
  const c = page.getCropBox();
  return {
    index,
    page,
    crop: { left: c.x, bottom: c.y, right: c.x + c.width, top: c.y + c.height },
    rotation: norm360(page.getRotation().angle),
  };
}

/**
 * pdf-lib creates a fresh form XObject per embedPage call, so identical
 * (page, clip) pairs are shared rather than duplicated in the output file.
 */
export class PageEmbedder {
  private readonly cache = new Map<string, Promise<PDFEmbeddedPage>>();
  private readonly out: PDFDocument;

  constructor(out: PDFDocument) {
    this.out = out;
  }

  get(src: SourcePage, bbox: BBox): Promise<PDFEmbeddedPage> {
    const key = [src.index, bbox.left, bbox.bottom, bbox.right, bbox.top]
      .map((n) => (typeof n === 'number' ? n.toFixed(4) : n))
      .join(':');

    let hit = this.cache.get(key);
    if (!hit) {
      // The BBox clips in *form* space, and the matrix then moves the clipped
      // region's bottom-left corner onto the origin. Without the translation a
      // page whose CropBox is offset from (0,0) would draw off-panel.
      hit = this.out.embedPage(src.page, bbox, [1, 0, 0, 1, -bbox.left, -bbox.bottom]);
      this.cache.set(key, hit);
    }
    return hit;
  }
}

/**
 * Draw one source page into one panel.
 *
 * pdf-lib's `drawPage` scales the embedded page to `width`/`height` and then
 * rotates it counter-clockwise *about the (x, y) anchor*, so the anchor is only
 * the panel's bottom-left corner at 0 degrees. The switch below moves the anchor
 * to whichever corner leaves the rotated footprint sitting inside the panel.
 */
export async function placePage(
  sheet: PDFPage,
  embedder: PageEmbedder,
  src: SourcePage,
  panel: Box,
  extraRotation: 0 | 180,
  fit: FitMode,
): Promise<void> {
  // Baking in /Rotate means rotating the content clockwise, i.e. 360 - angle CCW.
  const theta = norm360(360 - src.rotation + extraRotation);
  const swap = theta === 90 || theta === 270;

  const iw = src.crop.right - src.crop.left;
  const ih = src.crop.top - src.crop.bottom;
  if (iw <= 0 || ih <= 0) return;

  let bbox = src.crop;
  // Content-space dimensions of what we draw, before rotation.
  let w: number;
  let h: number;
  // Bottom-left of the rotated footprint on the sheet.
  let fx: number;
  let fy: number;

  if (fit === 'stretch') {
    // Footprint is exactly the panel; un-rotate it to get content dimensions.
    w = swap ? panel.h : panel.w;
    h = swap ? panel.w : panel.h;
    fx = panel.x;
    fy = panel.y;
  } else {
    // Footprint dimensions per unit scale.
    const fw = swap ? ih : iw;
    const fh = swap ? iw : ih;
    const scale =
      fit === 'cover'
        ? Math.max(panel.w / fw, panel.h / fh)
        : Math.min(panel.w / fw, panel.h / fh);

    if (fit === 'cover') {
      // Keep only the centre slice that the panel can actually show.
      const clipW = (swap ? panel.h : panel.w) / scale;
      const clipH = (swap ? panel.w : panel.h) / scale;
      const left = src.crop.left + (iw - clipW) / 2;
      const bottom = src.crop.bottom + (ih - clipH) / 2;
      bbox = { left, bottom, right: left + clipW, top: bottom + clipH };
      w = clipW * scale;
      h = clipH * scale;
      fx = panel.x;
      fy = panel.y;
    } else {
      w = iw * scale;
      h = ih * scale;
      fx = panel.x + (panel.w - fw * scale) / 2;
      fy = panel.y + (panel.h - fh * scale) / 2;
    }
  }

  let ax = fx;
  let ay = fy;
  switch (theta) {
    case 90:
      ax = fx + h;
      break;
    case 180:
      ax = fx + w;
      ay = fy + h;
      break;
    case 270:
      ay = fy + w;
      break;
  }

  const embedded = await embedder.get(src, bbox);
  sheet.drawPage(embedded, { x: ax, y: ay, width: w, height: h, rotate: degrees(theta) });
}
