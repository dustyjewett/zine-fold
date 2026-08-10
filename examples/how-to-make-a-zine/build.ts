/**
 * "How to Make a Zine" — an 8-page mini zine, built with this project.
 *
 * Writes two files:
 *   how-to-make-a-zine.pdf          eight panel-sized pages, in reading order
 *   how-to-make-a-zine-imposed.pdf  the same, folded-ready on one sheet
 *
 * The page-order diagram on page 4 is drawn from `planMini8` itself rather than
 * redrawn by hand, so a zine that teaches the layout cannot teach a stale one.
 *
 * Optional art: drop files into ./images and they are used automatically.
 *   images/cover.(png|jpg)   full-bleed behind the title
 *   images/collage.(png|jpg) page 5
 *   images/stack.(png|jpg)   page 7
 * Without them the zine is complete — the space is given back to the text.
 *
 * Run: npm run example
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { planMini8 } from '../../src/imposition/mini8.ts';
import { getPaper } from '../../src/imposition/paper.ts';
import { renderPlan } from '../../src/render.ts';

const HERE = new URL('.', import.meta.url).pathname;

// One panel of an 8-page mini zine on Letter.
const W = 198;
const H = 306;
const M = 15;
const INNER = W - M * 2;

const INK = rgb(0.08, 0.08, 0.09);
const PAPER_WHITE = rgb(1, 1, 1);
const GREY = rgb(0.45, 0.45, 0.48);
const RULE = rgb(0.75, 0.75, 0.78);

interface Fonts {
  display: PDFFont;
  body: PDFFont;
  bodyBold: PDFFont;
}

// --- text -------------------------------------------------------------------

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    const bullet = para.startsWith('· ');
    const indent = bullet ? font.widthOfTextAtSize('· ', size) : 0;
    let line = '';
    for (const word of para.split(' ')) {
      const attempt = line ? `${line} ${word}` : word;
      const room = width - (out.length && line === '' && bullet ? indent : 0);
      if (line && font.widthOfTextAtSize(attempt, size) > room) {
        out.push(line);
        line = bullet ? ' '.repeat(Math.round(indent / font.widthOfTextAtSize(' ', size))) + word : word;
      } else {
        line = attempt;
      }
    }
    out.push(line);
  }
  return out;
}

/** Draw wrapped body text downwards from `y`; returns the new y. */
function body(page: PDFPage, fonts: Fonts, text: string, y: number, size = 7.6, lead = 10.2): number {
  const lines = wrap(text, fonts.body, size, INNER);
  let cursor = y;
  for (const line of lines) {
    if (line) page.drawText(line, { x: M, y: cursor, size, font: fonts.body, color: INK });
    cursor -= line ? lead : lead * 0.55;
  }
  return cursor;
}

/** Headline plus the rule under it; returns the y to start body text at. */
function headline(page: PDFPage, fonts: Fonts, text: string, size = 13): number {
  const top = H - M - size;
  page.drawText(text, { x: M, y: top, size, font: fonts.display, color: INK });
  const ruleY = top - 7;
  page.drawLine({
    start: { x: M, y: ruleY },
    end: { x: W - M, y: ruleY },
    thickness: 1.4,
    color: INK,
  });
  return ruleY - 15;
}

function footnote(page: PDFPage, fonts: Fonts, text: string): void {
  for (const [i, line] of wrap(text, fonts.body, 6.2, INNER).entries()) {
    page.drawText(line, { x: M, y: M + 12 - i * 8, size: 6.2, font: fonts.body, color: GREY });
  }
}

// --- art --------------------------------------------------------------------

/** Load an optional image; returns null when the author has not supplied one. */
async function optionalImage(doc: PDFDocument, base: string) {
  for (const ext of ['png', 'jpg', 'jpeg'] as const) {
    try {
      const bytes = await readFile(`${HERE}images/${base}.${ext}`);
      return ext === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch {
      /* not supplied */
    }
  }
  return null;
}

/** The three halvings, drawn to scale, with the sheet shrinking each time. */
function foldStrip(page: PDFPage, y: number): number {
  let x = M;
  const tall = 40;
  const steps: { w: number; h: number; fold: 'v' | 'h' | null }[] = [
    { w: 52, h: tall, fold: 'v' },
    { w: 26, h: tall, fold: 'v' },
    { w: 13, h: tall, fold: 'h' },
    { w: 13, h: tall / 2, fold: null },
  ];

  for (const [i, step] of steps.entries()) {
    const top = y;
    page.drawRectangle({
      x, y: top - step.h, width: step.w, height: step.h,
      borderColor: INK, borderWidth: 0.8, color: PAPER_WHITE,
    });
    if (step.fold === 'v') {
      page.drawLine({
        start: { x: x + step.w / 2, y: top - step.h + 2 },
        end: { x: x + step.w / 2, y: top - 2 },
        thickness: 0.6, color: GREY, dashArray: [1.6, 1.6],
      });
    } else if (step.fold === 'h') {
      page.drawLine({
        start: { x: x + 2, y: top - step.h / 2 },
        end: { x: x + step.w - 2, y: top - step.h / 2 },
        thickness: 0.6, color: GREY, dashArray: [1.6, 1.6],
      });
    }
    x += step.w;
    if (i < steps.length - 1) {
      // Drawn rather than typed: the standard fonts have no arrow glyph.
      const mid = top - tall / 2;
      const from = x + 3;
      const to = x + 9;
      page.drawLine({ start: { x: from, y: mid }, end: { x: to, y: mid }, thickness: 0.7, color: GREY });
      page.drawLine({ start: { x: to - 2.2, y: mid + 2 }, end: { x: to, y: mid }, thickness: 0.7, color: GREY });
      page.drawLine({ start: { x: to - 2.2, y: mid - 2 }, end: { x: to, y: mid }, thickness: 0.7, color: GREY });
      x += 12;
    }
  }
  return y - tall - 8;
}

/**
 * The panel map, read straight off the planner: cell positions, page numbers,
 * which row is inverted, and where the slit goes.
 */
function panelMap(page: PDFPage, fonts: Fonts, y: number, width: number): number {
  const plan = planMini8(8, {
    paper: getPaper('letter'),
    margins: { panel: 0, edge: 0 },
    guides: true,
  });
  const sheet = plan.sheets[0]!;
  const scale = width / sheet.width;
  const height = sheet.height * scale;
  const left = M;
  const top = y;

  page.drawRectangle({
    x: left, y: top - height, width, height,
    borderColor: INK, borderWidth: 1, color: PAPER_WHITE,
  });

  for (const slot of sheet.slots) {
    const cx = left + (slot.box.x + slot.box.w / 2) * scale;
    const cy = top - height + (slot.box.y + slot.box.h / 2) * scale;
    const label = String(slot.readerPage);
    const size = 11;
    const half = fonts.display.widthOfTextAtSize(label, size) / 2;
    // Inverted panels are drawn inverted, which is the whole point of the page.
    page.drawText(label, {
      x: slot.rotate180 ? cx + half : cx - half,
      y: slot.rotate180 ? cy + size * 0.36 : cy - size * 0.36,
      size,
      font: fonts.display,
      color: INK,
      rotate: degrees(slot.rotate180 ? 180 : 0),
    });

    if (slot.box.x > 0) {
      page.drawLine({
        start: { x: left + slot.box.x * scale, y: top - height },
        end: { x: left + slot.box.x * scale, y: top },
        thickness: 0.5, color: RULE,
      });
    }
  }

  for (const guide of sheet.guides) {
    if (guide.kind !== 'cut') continue;
    page.drawLine({
      start: { x: left + guide.x1 * scale, y: top - height + guide.y1 * scale },
      end: { x: left + guide.x2 * scale, y: top - height + guide.y2 * scale },
      thickness: 1.6, color: INK, dashArray: [3, 2],
    });
  }

  page.drawText('dashed line = the cut', {
    x: left, y: top - height - 9.5, size: 6, font: fonts.body, color: GREY,
  });
  return top - height - 24;
}

// --- the pages --------------------------------------------------------------

const PAGES: ((page: PDFPage, fonts: Fonts, doc: PDFDocument) => Promise<void> | void)[] = [
  // 1 — front cover
  async (page, fonts, doc) => {
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: INK });
    const art = await optionalImage(doc, 'cover');
    if (art) {
      const scale = Math.max(W / art.width, H / art.height);
      page.drawImage(art, {
        x: (W - art.width * scale) / 2,
        y: (H - art.height * scale) / 2,
        width: art.width * scale,
        height: art.height * scale,
        opacity: 0.5,
      });
    }
    let y = H - 58;
    for (const line of ['HOW', 'TO MAKE', 'A ZINE']) {
      page.drawText(line, { x: M, y, size: 30, font: fonts.display, color: PAPER_WHITE });
      y -= 31;
    }
    page.drawLine({
      start: { x: M, y: y + 12 }, end: { x: W - M, y: y + 12 },
      thickness: 2, color: PAPER_WHITE,
    });
    let note = y - 6;
    for (const line of ['one sheet of paper', 'eight pages', "nobody's permission"]) {
      page.drawText(line, { x: M, y: note, size: 8.5, font: fonts.body, color: PAPER_WHITE });
      note -= 12;
    }
    // A ghost of the sheet itself, filling what was dead space.
    const gw = 104;
    const gh = gw * (612 / 792);
    const gx = M;
    const gy = 36;
    const faint = rgb(0.55, 0.55, 0.58);
    page.drawRectangle({ x: gx, y: gy, width: gw, height: gh, borderColor: faint, borderWidth: 0.8 });
    for (let c = 1; c < 4; c++) {
      page.drawLine({
        start: { x: gx + (gw / 4) * c, y: gy },
        end: { x: gx + (gw / 4) * c, y: gy + gh },
        thickness: 0.5, color: faint,
      });
    }
    page.drawLine({
      start: { x: gx + gw / 4, y: gy + gh / 2 },
      end: { x: gx + (gw / 4) * 3, y: gy + gh / 2 },
      thickness: 1.2, color: PAPER_WHITE, dashArray: [2.5, 2],
    });
    page.drawText('eight panels, one cut', {
      x: gx, y: gy - 9, size: 5.6, font: fonts.body, color: faint,
    });
    page.drawText('fold along the dotted lines of your life', {
      x: M, y: M + 2, size: 6, font: fonts.body, color: rgb(0.62, 0.62, 0.65),
    });
  },

  // 2 — what a zine is
  (page, fonts) => {
    const y = headline(page, fonts, 'WHAT IS A ZINE?');
    const after = body(page, fonts, [
      'A zine is a small thing you made and handed to someone.',
      '',
      'That is the entire definition.',
      '',
      'No publisher. No editor. No ISBN. No print run. No subject too small — there are zines about a single bus route.',
      '',
      'It is the cheapest way to put something into the world and the only one where nobody gets to say no first.',
    ].join('\n'), y);
    page.drawLine({
      start: { x: M, y: after - 4 }, end: { x: M + 40, y: after - 4 },
      thickness: 1, color: INK,
    });
    body(page, fonts, 'If you are waiting to be qualified: you already are.', after - 18, 8.4, 11);
  },

  // 3 — fold before you write
  (page, fonts) => {
    let y = headline(page, fonts, 'FOLD IT FIRST');
    y = body(page, fonts, [
      'Fold a blank sheet into a zine before you write a single word.',
      '',
      'Eight small pages are far less frightening than one big empty one, and you can see exactly how much room you have.',
    ].join('\n'), y);
    y = foldStrip(page, y - 6);
    body(page, fonts, [
      'In half, in half, in half again. Unfold. Cut the middle. Fold it back up.',
      '',
      'Now pencil a number in each panel. You are no longer facing a blank page — you are filling in eight small boxes.',
    ].join('\n'), y - 4);
  },

  // 4 — the page order
  (page, fonts) => {
    let y = headline(page, fonts, 'THE WEIRD PART');
    y = body(page, fonts, [
      'Unfold a finished zine and the page numbers look wrong. Half are upside down.',
      '',
      'Not a mistake — just what folding does. Copy this map:',
    ].join('\n'), y);
    y = panelMap(page, fonts, y - 8, 138);
    body(page, fonts, [
      'Page 1 is bottom right. Write the top row upside down and it reads the right way up once folded.',
    ].join('\n'), y - 2, 7.4, 9.8);
    footnote(page, fonts, 'Or let zine-fold.com do it for you.');
  },

  // 5 — what to put in it
  async (page, fonts, doc) => {
    let y = headline(page, fonts, 'WHAT GOES IN IT');
    y = body(page, fonts, 'Anything at all. These reliably work:', y);
    y = body(page, fonts, [
      '· one obsession, explained badly',
      '· a map of somewhere you know too well',
      '· instructions for something useless',
      '· twenty-four hours, hour by hour',
      '· a list you cannot stop adding to',
      '· an apology',
      '· everything you know about one very small thing',
    ].join('\n'), y - 2);

    const art = await optionalImage(doc, 'collage');
    if (art) {
      const w = INNER;
      const h = Math.min(70, (art.height / art.width) * w);
      page.drawImage(art, { x: M, y: y - h - 4, width: w, height: h });
      y -= h + 12;
    }
    body(page, fonts, 'Small and specific beats broad and vague. Nobody wants your general thoughts; they want the strange particular one.', y - 4);
  },

  // 6 — permission to be rough
  (page, fonts) => {
    let y = headline(page, fonts, 'MAKE IT ROUGH');
    y = body(page, fonts, [
      'Handwriting is fine. Tape is fine. Crooked is fine. Correction fluid is a design choice.',
      '',
      'Zines look like zines because they are photocopied: hard blacks, blown-out greys, the grain of a fifth-generation copy. Glue something down and copy it and the seams vanish.',
      '',
      'Polish is a different medium with different gatekeepers. This one is supposed to look made.',
    ].join('\n'), y);
    page.drawRectangle({
      x: M, y: y - 30, width: INNER, height: 24,
      borderColor: INK, borderWidth: 1, color: PAPER_WHITE,
    });
    page.drawText('DONE BEATS GOOD', {
      x: M + 8, y: y - 22, size: 11, font: fonts.display, color: INK,
    });
  },

  // 7 — distribution
  async (page, fonts, doc) => {
    let y = headline(page, fonts, 'GET IT OUT');
    y = body(page, fonts, [
      'Photocopy it. Black and white costs pennies, and the copy looks better than the original.',
      '',
      'Then give it away:',
    ].join('\n'), y);
    y = body(page, fonts, [
      '· trade with anyone else making one',
      '· leave stacks in cafés and libraries',
      '· slip one inside a book in a shop',
      '· post one to a stranger',
    ].join('\n'), y - 2);

    const art = await optionalImage(doc, 'stack');
    if (art) {
      const w = INNER;
      const h = Math.min(62, (art.height / art.width) * w);
      page.drawImage(art, { x: M, y: y - h - 4, width: w, height: h });
      y -= h + 12;
    }
    body(page, fonts, 'Selling them is allowed. Charging what it cost to copy is traditional. A zine nobody is holding is just paper.', y - 4);
  },

  // 8 — back cover
  (page, fonts) => {
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: INK });
    page.drawText('YOU ARE', { x: M, y: H - 62, size: 19, font: fonts.display, color: PAPER_WHITE });
    page.drawText('HOLDING ONE.', { x: M, y: H - 84, size: 19, font: fonts.display, color: PAPER_WHITE });

    let y = H - 116;
    for (const line of wrap(
      'Now unfold this sheet. The other side is completely blank.\n\nThat is your first zine.',
      fonts.body, 8.4, INNER,
    )) {
      if (line) page.drawText(line, { x: M, y, size: 8.4, font: fonts.body, color: PAPER_WHITE });
      y -= line ? 11.5 : 6;
    }

    page.drawLine({
      start: { x: M, y: 92 }, end: { x: W - M, y: 92 },
      thickness: 1, color: rgb(0.5, 0.5, 0.52),
    });
    let foot = 78;
    for (const line of [
      'Imposed with zine-fold.com',
      'Layout: 8-page mini zine',
      'One sheet, single-sided, one cut',
      '',
      'Copy this. Change it. Put your',
      'name on it. That is the tradition.',
    ]) {
      if (line) page.drawText(line, { x: M, y: foot, size: 7, font: fonts.body, color: rgb(0.78, 0.78, 0.8) });
      foot -= line ? 10 : 5;
    }
  },
];

// --- build ------------------------------------------------------------------

const doc = await PDFDocument.create();
doc.setTitle('How to Make a Zine');
doc.setSubject('An 8-page mini zine about making 8-page mini zines');
doc.setProducer('zine-fold');

const fonts: Fonts = {
  display: await doc.embedFont(StandardFonts.HelveticaBold),
  body: await doc.embedFont(StandardFonts.Courier),
  bodyBold: await doc.embedFont(StandardFonts.CourierBold),
};

for (const draw of PAGES) {
  const page = doc.addPage([W, H]);
  await draw(page, fonts, doc);
}

await mkdir(`${HERE}images`, { recursive: true });
const pages = await doc.save();
await writeFile(`${HERE}how-to-make-a-zine.pdf`, pages);

// Impose it with the real planner, so the example is also a smoke test.
const source = await PDFDocument.load(pages);
const plan = planMini8(8, {
  paper: getPaper('letter'),
  margins: { panel: 8.5, edge: 8.5 },
  guides: true,
});
const imposed = await renderPlan(
  source, plan,
  { fit: 'contain', numberOverlay: false, title: 'How to Make a Zine' },
  'combined', 'how-to-make-a-zine',
);
await writeFile(`${HERE}how-to-make-a-zine-imposed.pdf`, imposed.files[0]!.bytes);

console.log(`pages   ${(pages.length / 1024).toFixed(0)} kB  how-to-make-a-zine.pdf`);
console.log(`imposed ${(imposed.files[0]!.bytes.length / 1024).toFixed(0)} kB  how-to-make-a-zine-imposed.pdf`);
