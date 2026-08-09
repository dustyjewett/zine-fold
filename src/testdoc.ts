import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * A throwaway document whose pages are sized to one panel of the chosen layout
 * and stamped with a huge page number plus a "TOP" marker. Impose it, print it,
 * fold it: if the numbers run 1..N in order and none are upside down, the
 * layout and duplex settings are right.
 */
export async function buildTestDocument(
  pageCount: number,
  panelWidth: number,
  panelHeight: number,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Zine fold test (${pageCount} pages)`);

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([panelWidth, panelHeight]);
    const inset = Math.min(panelWidth, panelHeight) * 0.04;

    page.drawRectangle({
      x: inset,
      y: inset,
      width: panelWidth - inset * 2,
      height: panelHeight - inset * 2,
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 1,
    });

    const label = String(i);
    const size = Math.min(panelWidth, panelHeight) * 0.45;
    page.drawText(label, {
      x: (panelWidth - bold.widthOfTextAtSize(label, size)) / 2,
      y: (panelHeight - size * 0.72) / 2,
      size,
      font: bold,
      color: rgb(0.1, 0.1, 0.12),
    });

    const marker = 'TOP';
    const markerSize = Math.max(7, Math.min(panelWidth, panelHeight) * 0.06);
    page.drawText(marker, {
      x: (panelWidth - regular.widthOfTextAtSize(marker, markerSize)) / 2,
      y: panelHeight - inset - markerSize * 1.4,
      size: markerSize,
      font: regular,
      color: rgb(0.55, 0.55, 0.6),
    });

    const foot = i === 1 ? 'FRONT COVER' : i === pageCount ? 'BACK COVER' : '';
    if (foot) {
      page.drawText(foot, {
        x: (panelWidth - regular.widthOfTextAtSize(foot, markerSize)) / 2,
        y: inset + markerSize * 0.6,
        size: markerSize,
        font: regular,
        color: rgb(0.55, 0.55, 0.6),
      });
    }
  }

  return doc.save();
}
