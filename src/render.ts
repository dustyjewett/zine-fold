import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { describeSource, PageEmbedder, placePage, type SourcePage } from './imposition/place.ts';
import type { FitMode, ImpositionPlan, SheetPlan } from './imposition/types.ts';

export interface RenderOptions {
  fit: FitMode;
  /** Stamp each panel with the reader page number it holds — for test folds. */
  numberOverlay: boolean;
  title?: string;
}

export interface RenderResult {
  /** One entry per output PDF. More than one when fronts and backs are split. */
  files: { name: string; bytes: Uint8Array }[];
}

export type SplitMode = 'combined' | 'split';

const FOLD_COLOR = rgb(0.72, 0.72, 0.72);
const CUT_COLOR = rgb(0.45, 0.45, 0.45);

export async function renderPlan(
  src: PDFDocument,
  plan: ImpositionPlan,
  opts: RenderOptions,
  split: SplitMode,
  baseName: string,
): Promise<RenderResult> {
  const groups: { suffix: string; sheets: SheetPlan[] }[] =
    split === 'split'
      ? [
          { suffix: '-fronts', sheets: plan.sheets.filter((s) => s.side !== 'back') },
          { suffix: '-backs', sheets: plan.sheets.filter((s) => s.side === 'back') },
        ].filter((g) => g.sheets.length > 0)
      : [{ suffix: '', sheets: plan.sheets }];

  const files: RenderResult['files'] = [];
  for (const group of groups) {
    const bytes = await renderSheets(src, group.sheets, opts);
    files.push({ name: `${baseName}${group.suffix}.pdf`, bytes });
  }
  return { files };
}

async function renderSheets(
  src: PDFDocument,
  sheets: SheetPlan[],
  opts: RenderOptions,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setProducer('zine');
  out.setCreator('zine');
  if (opts.title) out.setTitle(opts.title);

  const embedder = new PageEmbedder(out);
  const sources: SourcePage[] = src.getPages().map((p, i) => describeSource(p, i));
  const font = opts.numberOverlay ? await out.embedFont(StandardFonts.Helvetica) : null;

  for (const sheet of sheets) {
    const page = out.addPage([sheet.width, sheet.height]);

    for (const slot of sheet.slots) {
      if (slot.source === null) continue;
      const source = sources[slot.source];
      if (!source) continue;
      await placePage(page, embedder, source, slot.box, slot.rotate180 ? 180 : 0, opts.fit);
    }

    for (const guide of sheet.guides) {
      page.drawLine({
        start: { x: guide.x1, y: guide.y1 },
        end: { x: guide.x2, y: guide.y2 },
        thickness: guide.kind === 'cut' ? 0.75 : 0.5,
        color: guide.kind === 'cut' ? CUT_COLOR : FOLD_COLOR,
        ...(guide.kind === 'cut' ? { dashArray: [4, 3] } : {}),
      });
    }

    if (font) {
      for (const slot of sheet.slots) {
        const size = 8;
        const label = slot.source === null ? 'blank' : String(slot.readerPage);
        // Sit the label just inside the panel corner that stays "bottom-left"
        // once the panel's own rotation is applied.
        const x = slot.rotate180 ? slot.box.x + slot.box.w - 2 : slot.box.x + 2;
        const y = slot.rotate180 ? slot.box.y + slot.box.h - size - 2 : slot.box.y + 2;
        page.drawText(label, {
          x: slot.rotate180 ? x - font.widthOfTextAtSize(label, size) : x,
          y,
          size,
          font,
          color: rgb(0.85, 0.2, 0.2),
        });
      }
    }
  }

  return out.save();
}
