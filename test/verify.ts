/**
 * Imposition verification.
 *
 * Builds numbered test documents, imposes them, then reads the *output* back
 * with pdf.js and checks where each glyph actually landed and which way up it
 * is. That keeps the check independent of the placement code being tested.
 *
 * Run: npm test
 */
import { readFile } from 'node:fs/promises';
import { PDFDocument, degrees } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildDocxTemplate } from '../src/docx.ts';
import { planBooklet } from '../src/imposition/booklet.ts';
import { readmeDiagrams } from './diagram.ts';
import { planDuplex12 } from '../src/imposition/duplex12.ts';
import { planICut } from '../src/imposition/i-cut.ts';
import { planMini8 } from '../src/imposition/mini8.ts';
import { planRiverCut } from '../src/imposition/river-cut.ts';
import { getPaper, landscape, PAPERS, portrait } from '../src/imposition/paper.ts';
import type { Guide } from '../src/imposition/types.ts';
import { parsePageRange } from '../src/range.ts';
import { renderPlan } from '../src/render.ts';
import { buildTestDocument } from '../src/testdoc.ts';

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail = ''): void {
  checks++;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name: string): void {
  console.log(`\n${name}`);
}

interface Glyph {
  text: string;
  x: number;
  y: number;
  /** 0 for upright, 180 for upside down, etc. */
  angle: number;
}

/** Pull every glyph run out of one page of a rendered PDF, in user space. */
async function readGlyphs(bytes: Uint8Array, pageNumber: number): Promise<Glyph[]> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();

  const glyphs: Glyph[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const [a, b, , , e, f] = item.transform as number[];
    const angle = ((Math.round(Math.atan2(b!, a!) * (180 / Math.PI) / 90) * 90) % 360 + 360) % 360;
    glyphs.push({ text: item.str.trim(), x: e!, y: f!, angle });
  }
  await task.destroy();
  return glyphs;
}

/** The big page number is the largest glyph run that is purely digits. */
function findNumber(glyphs: Glyph[], value: number): Glyph | undefined {
  return glyphs.find((g) => g.text === String(value));
}

const SHEET = landscape(getPaper('letter'));
const NO_MARGINS = { panel: 0, edge: 0 };

/**
 * Render the cut guides in panel units so a slit pattern can be asserted as a
 * readable string. "H y=2 x=0..3" is a horizontal slit along the second panel
 * boundary up, running from the left edge across three panels.
 */
function describeCuts(guides: Guide[], pw: number, ph: number): string[] {
  return guides
    .filter((g) => g.kind === 'cut')
    .map((g) => {
      const lo = (v: number, unit: number) => (Math.min(v, v) / unit).toFixed(0);
      if (Math.abs(g.y1 - g.y2) < 0.01) {
        const x1 = (Math.min(g.x1, g.x2) / pw).toFixed(0);
        const x2 = (Math.max(g.x1, g.x2) / pw).toFixed(0);
        return `H y=${lo(g.y1, ph)} x=${x1}..${x2}`;
      }
      const y1 = (Math.min(g.y1, g.y2) / ph).toFixed(0);
      const y2 = (Math.max(g.y1, g.y2) / ph).toFixed(0);
      return `V x=${lo(g.x1, pw)} y=${y1}..${y2}`;
    })
    .sort();
}

async function imposeMini8(pages: number) {
  const testBytes = await buildTestDocument(pages, SHEET.width / 4, SHEET.height / 2);
  const src = await PDFDocument.load(testBytes);
  const plan = planMini8(pages, {
    paper: getPaper('letter'),
    margins: NO_MARGINS,
    guides: false,
  });
  const result = await renderPlan(src, plan, { fit: 'contain', numberOverlay: false }, 'combined', 'test');
  return { plan, bytes: result.files[0]!.bytes };
}

async function imposeBooklet(pages: number, over: Partial<Parameters<typeof planBooklet>[1]> = {}) {
  const testBytes = await buildTestDocument(pages, SHEET.width / 2, SHEET.height);
  const src = await PDFDocument.load(testBytes);
  const plan = planBooklet(pages, {
    paper: getPaper('letter'),
    margins: NO_MARGINS,
    guides: false,
    sheetsPerSignature: 'single',
    binding: 'left',
    rotateBacks: false,
    ...over,
  });
  const result = await renderPlan(src, plan, { fit: 'contain', numberOverlay: false }, 'combined', 'test');
  return { plan, bytes: result.files[0]!.bytes };
}

// ---------------------------------------------------------------------------

section('sanity: pdf.js reads the test document in PDF user space');
{
  const bytes = await buildTestDocument(2, 200, 400);
  const glyphs = await readGlyphs(bytes, 1);
  const one = findNumber(glyphs, 1);
  check('page 1 contains the numeral 1', !!one);
  check('numeral is upright', one?.angle === 0, `angle=${one?.angle}`);
  check(
    'numeral sits near the horizontal centre',
    !!one && Math.abs(one.x - 100) < 60,
    `x=${one?.x.toFixed(1)} (page is 200 wide)`,
  );
  check(
    'y grows upwards (TOP marker is above the numeral)',
    !!one && glyphs.some((g) => g.text === 'TOP' && g.y > one.y),
  );
}

section('8-page mini zine: 8 panels on one single-sided sheet');
{
  const { plan, bytes } = await imposeMini8(8);
  check('one output sheet', plan.sheets.length === 1, `got ${plan.sheets.length}`);
  check('no blanks needed', plan.blanksAdded === 0);

  const glyphs = await readGlyphs(bytes, 1);
  const pw = SHEET.width / 4;
  const ph = SHEET.height / 2;

  // column index 0..3 from the left, row 'top' | 'bottom'
  const expect: Record<number, { col: number; row: 'top' | 'bottom' }> = {
    5: { col: 0, row: 'top' }, 4: { col: 1, row: 'top' },
    3: { col: 2, row: 'top' }, 2: { col: 3, row: 'top' },
    6: { col: 0, row: 'bottom' }, 7: { col: 1, row: 'bottom' },
    8: { col: 2, row: 'bottom' }, 1: { col: 3, row: 'bottom' },
  };

  for (const [pageStr, want] of Object.entries(expect)) {
    const n = Number(pageStr);
    const g = findNumber(glyphs, n);
    if (!g) {
      check(`page ${n} is present`, false);
      continue;
    }
    const col = Math.floor(g.x / pw);
    const row = g.y >= ph ? 'top' : 'bottom';
    const wantAngle = want.row === 'top' ? 180 : 0;
    check(
      `page ${n} → col ${want.col}, ${want.row} row, ${wantAngle}°`,
      col === want.col && row === want.row && g.angle === wantAngle,
      `got col ${col}, ${row} row, ${g.angle}° (x=${g.x.toFixed(0)}, y=${g.y.toFixed(0)})`,
    );
  }
}

section('8-page mini zine: short document pads to 8, long document splits');
{
  const short = await imposeMini8(5);
  check('5 pages still make one sheet', short.plan.sheets.length === 1);
  check('3 blanks added', short.plan.blanksAdded === 3, `got ${short.plan.blanksAdded}`);
  const glyphs = await readGlyphs(short.bytes, 1);
  check('no page 6 drawn', !findNumber(glyphs, 6));
  check('page 5 still drawn', !!findNumber(glyphs, 5));

  const long = planMini8(20, { paper: getPaper('letter'), margins: NO_MARGINS, guides: false });
  check('20 pages make 3 zines', long.sheets.length === 3, `got ${long.sheets.length}`);
  check('4 blanks added', long.blanksAdded === 4, `got ${long.blanksAdded}`);
}

section('cut derivation reproduces the known 8-page slit');
{
  // The 8-page zine's centre slit is long-established, so deriving it from the
  // panel map instead of hard-coding it is a check on the derivation itself.
  const sheet = landscape(getPaper('letter'));
  const plan = planMini8(8, { paper: getPaper('letter'), margins: NO_MARGINS, guides: true });
  const cuts = describeCuts(plan.sheets[0]!.guides, sheet.width / 4, sheet.height / 2);
  check('one slit across the two middle panels', cuts.join(' | ') === 'H y=1 x=1..3', cuts.join(' | '));
}

for (const variant of [
  {
    name: 'River Cut',
    plan: planRiverCut,
    cells: {
      4: [0, 0], 3: [0, 1], 2: [0, 2], 1: [0, 3],
      5: [1, 0], 6: [1, 1], 7: [1, 2], 8: [1, 3],
      12: [2, 0], 11: [2, 1], 10: [2, 2], 9: [2, 3],
      13: [3, 0], 14: [3, 1], 15: [3, 2], 16: [3, 3],
    } as Record<number, [number, number]>,
    // three slits entering from alternating edges — the meander
    cuts: ['H y=1 x=1..4', 'H y=2 x=0..3', 'H y=3 x=1..4'],
  },
  {
    name: '-\uA7AE- cut',
    plan: planICut,
    cells: {
      9: [0, 0], 8: [0, 1], 7: [0, 2], 6: [0, 3],
      10: [1, 0], 11: [1, 1], 4: [1, 2], 5: [1, 3],
      13: [2, 0], 12: [2, 1], 3: [2, 2], 2: [2, 3],
      14: [3, 0], 15: [3, 1], 16: [3, 2], 1: [3, 3],
    } as Record<number, [number, number]>,
    // a vertical stroke with a crossbar at each end, plus a dash at either edge
    cuts: ['H y=1 x=1..3', 'H y=2 x=0..1', 'H y=2 x=3..4', 'H y=3 x=1..3', 'V x=2 y=1..3'],
  },
]) {
  section(`micro zine: ${variant.name} panel map`);
  {
    const paper = getPaper('letter');
    const sheet = portrait(paper);
    const pw = sheet.width / 4;
    const ph = sheet.height / 4;

    const src = await PDFDocument.load(await buildTestDocument(16, pw, ph));
    const plan = variant.plan(16, { paper, margins: NO_MARGINS, guides: true });
    const out = await renderPlan(src, plan, { fit: 'contain', numberOverlay: false }, 'combined', 't');

    check('one output sheet', plan.sheets.length === 1, `got ${plan.sheets.length}`);
    check('sheet is portrait', sheet.height > sheet.width);
    check('no blanks needed', plan.blanksAdded === 0);

    const glyphs = await readGlyphs(out.files[0]!.bytes, 1);
    let placed = 0;
    for (const [pageStr, [wantRow, wantCol]] of Object.entries(variant.cells)) {
      const n = Number(pageStr);
      const g = findNumber(glyphs, n);
      if (!g) { check(`page ${n} present`, false); continue; }
      const col = Math.floor(g.x / pw);
      const row = 3 - Math.floor(g.y / ph);
      const wantAngle = wantRow % 2 === 0 ? 180 : 0;
      if (col === wantCol && row === wantRow && g.angle === wantAngle) placed++;
      else check(`page ${n} -> row ${wantRow} col ${wantCol} @${wantAngle}deg`, false,
        `got row ${row} col ${col} @${g.angle}deg`);
    }
    check('all 16 panels placed and oriented correctly', placed === 16, `${placed}/16`);

    // The strip has to stay connected: consecutive pages must be neighbours.
    const breaks: string[] = [];
    for (let n = 1; n < 16; n++) {
      const a = variant.cells[n]!;
      const b = variant.cells[n + 1]!;
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1) breaks.push(`${n}->${n + 1}`);
    }
    check('every page neighbours the next', breaks.length === 0, breaks.join(' '));
  }

  section(`micro zine: ${variant.name} slits`);
  {
    const paper = getPaper('letter');
    const sheet = portrait(paper);
    const plan = variant.plan(16, { paper, margins: NO_MARGINS, guides: true });
    const cuts = describeCuts(plan.sheets[0]!.guides, sheet.width / 4, sheet.height / 4);
    check(`slits match the ${variant.name} pattern`,
      cuts.join(' | ') === variant.cuts.join(' | '),
      cuts.join(' | '));
  }
}

section('micro zine: padding and multiple zines');
{
  const paper = getPaper('letter');
  const short = planRiverCut(10, { paper, margins: NO_MARGINS, guides: false });
  check('10 pages still one sheet', short.sheets.length === 1);
  check('6 blanks added', short.blanksAdded === 6, `got ${short.blanksAdded}`);

  const long = planICut(40, { paper, margins: NO_MARGINS, guides: false });
  check('40 pages make 3 zines', long.sheets.length === 3, `got ${long.sheets.length}`);
  check('8 blanks added', long.blanksAdded === 8, `got ${long.blanksAdded}`);
  const second = long.sheets[1]!.slots.map((s) => s.readerPage).sort((a, b) => a - b);
  check('second zine covers pages 17-32', second[0] === 17 && second[15] === 32,
    `${second[0]}..${second[15]}`);
}

section('12-page mini zine: both sides');
{
  const paper = getPaper('letter');
  const sheet = landscape(paper);
  const pw = sheet.width / 4;
  const ph = sheet.height / 2;

  const src = await PDFDocument.load(await buildTestDocument(12, pw, ph));
  const plan = planDuplex12(12, { paper, margins: NO_MARGINS, guides: true, rotateBacks: false });
  const out = await renderPlan(src, plan, { fit: 'contain', numberOverlay: false }, 'combined', 'd');

  check('12 pages → one sheet, two sides', plan.sheets.length === 2, `got ${plan.sheets.length}`);
  check('sides are front then back',
    plan.sheets.map((s) => s.side).join(',') === 'front,back');
  check('no blanks needed', plan.blanksAdded === 0);

  const cell = (g: Glyph) => ({ col: Math.floor(g.x / pw), row: g.y >= ph ? 0 : 1 });

  const front = await readGlyphs(out.files[0]!.bytes, 1);
  const wantFront: Record<number, [number, number]> = {
    8: [0, 0], 7: [0, 1], 6: [0, 2], 5: [0, 3],
    11: [1, 0], 12: [1, 1], 1: [1, 2], 2: [1, 3],
  };
  let ok = 0;
  for (const [n, [row, col]] of Object.entries(wantFront)) {
    const g = findNumber(front, Number(n));
    const at = g && cell(g);
    const wantAngle = row === 0 ? 180 : 0;
    if (at && at.row === row && at.col === col && g.angle === wantAngle) ok++;
    else check(`front page ${n} -> row ${row} col ${col}`, false,
      `got row ${at?.row} col ${at?.col} @${g?.angle}deg`);
  }
  check('all eight front panels correct', ok === 8, `${ok}/8`);

  const back = await readGlyphs(out.files[0]!.bytes, 2);
  const wantBack: Record<number, [number, number]> = {
    4: [0, 0], 9: [0, 3], 3: [1, 0], 10: [1, 3],
  };
  let okBack = 0;
  for (const [n, [row, col]] of Object.entries(wantBack)) {
    const g = findNumber(back, Number(n));
    const at = g && cell(g);
    const wantAngle = row === 0 ? 180 : 0;
    if (at && at.row === row && at.col === col && g.angle === wantAngle) okBack++;
    else check(`back page ${n} -> row ${row} col ${col}`, false,
      `got row ${at?.row} col ${at?.col} @${g?.angle}deg`);
  }
  check('all four back panels correct', okBack === 4, `${okBack}/4`);

  const middles = back.filter((g) => /^\d+$/.test(g.text)).map((g) => cell(g).col);
  check('back middle columns are empty', !middles.includes(1) && !middles.includes(2),
    `columns used: ${[...new Set(middles)].sort().join(',')}`);

  // Flipping left-to-right pairs front column c with back column 3-c. Each
  // paired panel is one leaf, so its two faces must share a rotation.
  const pairs: [number, number][] = [[8, 9], [5, 4], [11, 10], [2, 3]];
  const mismatched = pairs.filter(([f, b]) => {
    const fg = findNumber(front, f);
    const bg = findNumber(back, b);
    if (!fg || !bg) return true;
    const fc = cell(fg);
    const bc = cell(bg);
    return fc.row !== bc.row || fc.col !== 3 - bc.col || fg.angle !== bg.angle;
  });
  check('paired faces share a panel and a rotation', mismatched.length === 0,
    mismatched.map((p) => p.join('/')).join(' '));
}

section('12-page mini zine: cuts and duplex flip');
{
  const paper = getPaper('letter');
  const sheet = landscape(paper);
  const plan = planDuplex12(12, { paper, margins: NO_MARGINS, guides: true, rotateBacks: false });
  const cuts = describeCuts(plan.sheets[0]!.guides, sheet.width / 4, sheet.height / 2);
  check('a dash in from each end plus a stroke up the middle',
    cuts.join(' | ') === 'H y=1 x=0..1 | H y=1 x=3..4 | V x=2 y=1..2', cuts.join(' | '));
  check('cut marks are on the front only',
    plan.sheets[1]!.guides.length === 0, `${plan.sheets[1]!.guides.length} on the back`);

  // Long-edge flip pre-rotates the reverse, so every panel moves diagonally.
  const rotated = planDuplex12(12, { paper, margins: NO_MARGINS, guides: false, rotateBacks: true });
  const plain = plan.sheets[1]!.slots;
  const flipped = rotated.sheets[1]!.slots;
  const find = (slots: typeof plain, page: number) => slots.find((s) => s.readerPage === page);
  const four = find(plain, 4)!;
  const fourFlipped = find(flipped, 4)!;
  check('rotating the back moves page 4 to the opposite corner',
    Math.abs(fourFlipped.box.x - (sheet.width - four.box.x - four.box.w)) < 0.01 &&
    Math.abs(fourFlipped.box.y - (sheet.height - four.box.y - four.box.h)) < 0.01,
    `${four.box.x},${four.box.y} -> ${fourFlipped.box.x},${fourFlipped.box.y}`);
  check('and inverts it', fourFlipped.rotate180 === !four.rotate180);
}

section('12-page mini zine: padding and multiple zines');
{
  const paper = getPaper('letter');
  const short = planDuplex12(7, { paper, margins: NO_MARGINS, guides: false, rotateBacks: false });
  check('7 pages still one sheet', short.sheets.length === 2);
  check('5 blanks added', short.blanksAdded === 5, `got ${short.blanksAdded}`);

  const long = planDuplex12(20, { paper, margins: NO_MARGINS, guides: false, rotateBacks: false });
  check('20 pages make 2 zines', long.sheets.length === 4, `got ${long.sheets.length / 2}`);
  check('4 blanks added', long.blanksAdded === 4, `got ${long.blanksAdded}`);
  const secondFront = long.sheets[2]!.slots.map((s) => s.readerPage).sort((a, b) => a - b);
  check('second zine starts at page 13', secondFront[0] === 13, `${secondFront[0]}`);
}

section('booklet: saddle-stitch page order, backs upright');
{
  const { plan, bytes } = await imposeBooklet(8);
  check('8 pages → 4 sides', plan.sheets.length === 4, `got ${plan.sheets.length}`);
  check('sides alternate front/back', plan.sheets.map((s) => s.side).join(',') === 'front,back,front,back');

  // [left, right] expected on each printed side, in output order.
  const expected: [number, number][] = [[8, 1], [2, 7], [6, 3], [4, 5]];
  const mid = SHEET.width / 2;

  for (const [i, [wantLeft, wantRight]] of expected.entries()) {
    const glyphs = await readGlyphs(bytes, i + 1);
    const left = findNumber(glyphs, wantLeft);
    const right = findNumber(glyphs, wantRight);
    check(
      `side ${i + 1}: ${wantLeft} | ${wantRight}`,
      !!left && !!right && left.x < mid && right.x > mid,
      `left ${wantLeft} at x=${left?.x.toFixed(0)}, right ${wantRight} at x=${right?.x.toFixed(0)}, mid=${mid.toFixed(0)}`,
    );
    check(
      `side ${i + 1}: both upright`,
      left?.angle === 0 && right?.angle === 0,
      `${left?.angle}° / ${right?.angle}°`,
    );
  }
}

section('booklet: long-edge duplex pre-rotates and swaps the backs');
{
  const { bytes } = await imposeBooklet(8, { rotateBacks: true });
  const mid = SHEET.width / 2;

  const front = await readGlyphs(bytes, 1);
  check('front side unchanged: 8 left, 1 right',
    findNumber(front, 8)!.x < mid && findNumber(front, 1)!.x > mid);
  check('front side upright', findNumber(front, 1)!.angle === 0);

  // Conceptually the back is [2 | 7]. Pre-rotated by 180 the whole sheet turns
  // over, so 2 must be drawn on the right of the PDF page to print on the left.
  const back = await readGlyphs(bytes, 2);
  const two = findNumber(back, 2)!;
  const seven = findNumber(back, 7)!;
  check('back page 2 drawn on the right half', two.x > mid, `x=${two.x.toFixed(0)}`);
  check('back page 7 drawn on the left half', seven.x < mid, `x=${seven.x.toFixed(0)}`);
  check('back panels rotated 180°', two.angle === 180 && seven.angle === 180, `${two.angle}° / ${seven.angle}°`);
}

section('booklet: multiple signatures');
{
  const sig = (pages: number, sheetsPerSignature: number) =>
    planBooklet(pages, {
      paper: getPaper('letter'), margins: NO_MARGINS, guides: false,
      sheetsPerSignature, binding: 'left', rotateBacks: false,
    });

  // 32 pages at 4 sheets each = two full 16-page signatures.
  const full = sig(32, 4);
  check('32 pages → 16 sides', full.sheets.length === 16, `got ${full.sheets.length}`);
  check('2 signatures', new Set(full.sheets.map((s) => s.signature)).size === 2);
  check('no blanks', full.blanksAdded === 0, `got ${full.blanksAdded}`);

  // Each signature restarts its own nesting, so signature 2 opens on 17 and
  // closes on 32 rather than continuing signature 1's arithmetic.
  const sig2Outer = full.sheets.find((s) => s.signature === 2)!;
  check('signature 2 outer sheet holds 32 | 17',
    sig2Outer.slots.map((s) => s.readerPage).join(',') === '32,17',
    sig2Outer.slots.map((s) => s.readerPage).join(','));

  // The last signature shrinks instead of padding out to a full one.
  const short = sig(24, 4);
  check('24 pages → 6 sheets, not 8', short.sheets.length === 12, `got ${short.sheets.length / 2} sheets`);
  check('24 pages → 0 blanks', short.blanksAdded === 0, `got ${short.blanksAdded}`);
  const sizes = [1, 2].map((n) => short.sheets.filter((s) => s.signature === n).length / 2);
  check('signatures are 4 + 2 sheets', sizes.join('+') === '4+2', sizes.join('+'));

  // Odd page counts still round up to a whole sheet.
  const odd = sig(13, 4);
  check('13 pages → 4 sheets', odd.sheets.length === 8, `got ${odd.sheets.length / 2} sheets`);
  check('13 pages → 3 blanks', odd.blanksAdded === 3, `got ${odd.blanksAdded}`);
}

section('booklet: right-edge binding mirrors each spread');
{
  const { bytes } = await imposeBooklet(8, { binding: 'right' });
  const mid = SHEET.width / 2;
  const glyphs = await readGlyphs(bytes, 1);
  check('cover (page 1) sits on the left', findNumber(glyphs, 1)!.x < mid);
  check('page 8 sits on the right', findNumber(glyphs, 8)!.x > mid);
}

section('source pages with /Rotate are honoured');
{
  // /Rotate 90 means "turn the page 90 degrees clockwise when displaying it",
  // so a tall page becomes wide and its TOP marker swings round to the right.
  // The imposed sheet has to show the page the way a viewer would, and — the
  // part that is easy to get wrong — has to scale it using the *displayed*
  // dimensions, otherwise the content overflows its panel.
  const src = await PDFDocument.load(await buildTestDocument(8, 200, 400));
  for (const page of src.getPages()) page.setRotation(degrees(90));

  const plan = planBooklet(8, {
    paper: getPaper('letter'), margins: NO_MARGINS, guides: false,
    sheetsPerSignature: 'single', binding: 'left', rotateBacks: false,
  });
  const result = await renderPlan(src, plan, { fit: 'contain', numberOverlay: false }, 'combined', 'rot');
  const glyphs = await readGlyphs(result.files[0]!.bytes, 1);

  const eight = findNumber(glyphs, 8);
  check('rotated source page still lands on the sheet', !!eight);
  check('content turned 90° clockwise', eight?.angle === 270, `angle=${eight?.angle}`);

  // The left panel holds page 8; keep to its glyphs so the right panel's
  // content doesn't look like an overflow.
  const panelW = SHEET.width / 2;
  const left = glyphs.filter((g) => g.x < panelW);

  const top = left.find((g) => g.text === 'TOP');
  check("the page's top edge now faces right", !!top && !!eight && top.x > eight.x,
    `TOP x=${top?.x.toFixed(0)} vs numeral x=${eight?.x.toFixed(0)}`);

  // Scaling off the un-rotated 200x400 would need 1.53x and throw a 612pt-wide
  // footprint into a 396pt panel, pushing the TOP marker past the fold.
  const inside = left.every((g) => g.x >= -1 && g.x <= panelW + 1 && g.y >= -1 && g.y <= SHEET.height + 1);
  check('scaled with swapped dimensions — nothing spills out of the panel', inside,
    left.map((g) => `${g.text}@${g.x.toFixed(0)},${g.y.toFixed(0)}`).join(' '));
}

section('fit modes');
{
  const paper = getPaper('letter');
  const src = await PDFDocument.load(await buildTestDocument(8, 400, 100)); // very wide pages
  const plan = planBooklet(8, {
    paper, margins: NO_MARGINS, guides: false,
    sheetsPerSignature: 'single', binding: 'left', rotateBacks: false,
  });

  for (const fit of ['contain', 'cover', 'stretch'] as const) {
    const result = await renderPlan(src, plan, { fit, numberOverlay: false }, 'combined', 'fit');
    const glyphs = await readGlyphs(result.files[0]!.bytes, 1);
    check(`fit=${fit} renders both panels`, !!findNumber(glyphs, 8) && !!findNumber(glyphs, 1));
  }
}

section('test documents mark covers per zine, not just at the ends');
{
  /** Page numbers carrying each cover marker. */
  async function covers(pageCount: number, pagesPerZine: number) {
    const bytes = await buildTestDocument(pageCount, 153, 198, pagesPerZine);
    const task = getDocument({ data: bytes.slice(), verbosity: 0 });
    const doc = await task.promise;
    const front: number[] = [];
    const back: number[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const text = (await (await doc.getPage(i)).getTextContent()).items
        .map((it) => ('str' in it ? it.str : ''))
        .join('');
      if (text.includes('FRONT COVER')) front.push(i);
      if (text.includes('BACK COVER')) back.push(i);
    }
    await task.destroy();
    return { front, back, pages: doc.numPages };
  }

  const single = await covers(16, 16);
  check('16-page document has 16 pages', single.pages === 16, `${single.pages}`);
  check('one front cover, on page 1', single.front.join(',') === '1', single.front.join(','));
  check('one back cover, on page 16', single.back.join(',') === '16', single.back.join(','));

  const three = await covers(32, 16);
  check('32 pages at 16 per zine: fronts on 1 and 17',
    three.front.join(',') === '1,17', three.front.join(','));
  check('32 pages at 16 per zine: backs on 16 and 32',
    three.back.join(',') === '16,32', three.back.join(','));

  // A run that stops mid-zine still marks its final page, so the tail is obvious.
  const ragged = await covers(24, 16);
  check('24 pages at 16 per zine: fronts on 1 and 17',
    ragged.front.join(',') === '1,17', ragged.front.join(','));
  check('24 pages at 16 per zine: backs on 16 and 24',
    ragged.back.join(',') === '16,24', ragged.back.join(','));

  const eight = await covers(8, 8);
  check('8-page default is unchanged',
    eight.front.join(',') === '1' && eight.back.join(',') === '8',
    `${eight.front.join(',')} / ${eight.back.join(',')}`);
}

section('README fold diagrams match the layouts they document');
{
  // The diagrams are rendered from each planner's own output, so this catches
  // a layout change that leaves the documentation describing the old fold.
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  for (const [name, diagram] of Object.entries(readmeDiagrams())) {
    const present = readme.includes(diagram);
    check(`${name} diagram is current`, present,
      present ? '' : `README is stale — run \`npm run diagrams\`:\n${diagram}`);
  }

  check('diagrams use a single-cell glyph for vertical slits',
    [...Object.values(readmeDiagrams()).join('')].every((c) => c !== '︴'),
    'a wide character would break the monospace grid');
}

section('Word template is a valid docx sized to the panel');
{
  // unzipSync is an independent ZIP implementation, so it checks the archive
  // this project hand-writes rather than merely re-reading it with the same code.
  // It verifies CRCs, so a corrupt entry throws rather than passing quietly.
  const letter = getPaper('letter');
  const micro = portrait(letter);          // 16-page folds: sixteenth of a sheet
  const mini = landscape(letter);          // 8- and 12-page: eighth of a sheet

  const bytes = buildDocxTemplate({
    pageCount: 16,
    widthPt: micro.width / 4,
    heightPt: micro.height / 4,
    marginPt: 8.5,
    pagesPerZine: 16,
    layoutName: '16-page micro zine — River Cut',
  });

  check('starts with the ZIP magic number',
    bytes[0] === 0x50 && bytes[1] === 0x4b, `${bytes[0]},${bytes[1]}`);

  const parts = unzipSync(bytes);
  const names = Object.keys(parts).sort();
  check('holds exactly the three parts Word needs',
    names.join(' | ') === '[Content_Types].xml | _rels/.rels | word/document.xml',
    names.join(' | '));

  const xml = new TextDecoder().decode(parts['word/document.xml']!);

  // Letter portrait / 4 = 153 x 198 pt, and Word counts in twentieths of a point.
  const pgSz = /<w:pgSz w:w="(\d+)" w:h="(\d+)"/.exec(xml);
  check('page is one panel: 153 x 198 pt in twips',
    pgSz?.[1] === '3060' && pgSz?.[2] === '3960', pgSz?.slice(1).join(' x ') ?? 'no pgSz');
  check('margin carried through', /<w:pgMar w:top="170"/.test(xml));
  check('portrait panels get no landscape flag', !xml.includes('w:orient'));

  const breaks = xml.match(/<w:br w:type="page"\/>/g)?.length ?? 0;
  check('15 breaks makes 16 pages', breaks === 15, `${breaks}`);
  check('page 1 names the layout', xml.includes('Page 1 — front cover · 16-page micro zine'));
  check('page 16 is marked the back cover', xml.includes('Page 16 — back cover'));

  // A run spanning several zines repeats the covers, as the test PDF does.
  const long = new TextDecoder().decode(
    unzipSync(buildDocxTemplate({
      pageCount: 24, widthPt: 100, heightPt: 200, marginPt: 5,
      pagesPerZine: 16, layoutName: 'x',
    }))['word/document.xml']!);
  check('multi-zine run repeats the covers',
    long.includes('Page 17 — front cover') && long.includes('Page 24 — back cover'));

  // A mini zine panel is an eighth of a landscape sheet: 198 x 306 pt.
  const miniXml = new TextDecoder().decode(
    unzipSync(buildDocxTemplate({
      pageCount: 8, widthPt: mini.width / 4, heightPt: mini.height / 2, marginPt: 0,
      pagesPerZine: 8, layoutName: 'y',
    }))['word/document.xml']!);
  check('mini zine panel is 198 x 306 pt',
    /<w:pgSz w:w="3960" w:h="6120"/.test(miniXml),
    /<w:pgSz[^/]*/.exec(miniXml)?.[0] ?? '');

  // Landscape panels must carry the orientation flag or Word rotates them back.
  const wide = new TextDecoder().decode(
    unzipSync(buildDocxTemplate({
      pageCount: 1, widthPt: 400, heightPt: 200, marginPt: 0, pagesPerZine: 1, layoutName: 'z',
    }))['word/document.xml']!);
  check('a landscape panel is flagged landscape', wide.includes('w:orient="landscape"'));

  const twice = buildDocxTemplate({
    pageCount: 16, widthPt: micro.width / 4, heightPt: micro.height / 4,
    marginPt: 8.5, pagesPerZine: 16, layoutName: '16-page micro zine — River Cut',
  });
  check('output is byte-for-byte reproducible',
    Buffer.from(bytes).equals(Buffer.from(twice)));
}

section('page range parsing');
{
  check('blank means all', parsePageRange('', 4).join(',') === '0,1,2,3');
  check('list and ranges', parsePageRange('1-3, 5', 6).join(',') === '0,1,2,4');
  check('descending range reverses', parsePageRange('4-2', 6).join(',') === '3,2,1');
  check('rejects out of bounds', (() => { try { parsePageRange('9', 4); return false; } catch { return true; } })());
  check('rejects garbage', (() => { try { parsePageRange('a-b', 4); return false; } catch { return true; } })());
}

section('split output');
{
  const testBytes = await buildTestDocument(8, SHEET.width / 2, SHEET.height);
  const src = await PDFDocument.load(testBytes);
  const plan = planBooklet(8, {
    paper: getPaper('letter'), margins: NO_MARGINS, guides: false,
    sheetsPerSignature: 'single', binding: 'left', rotateBacks: false,
  });
  const result = await renderPlan(src, plan, { fit: 'contain', numberOverlay: false }, 'split', 'doc');
  check('two files produced', result.files.length === 2, `got ${result.files.length}`);
  check('named -fronts and -backs',
    result.files[0]!.name === 'doc-fronts.pdf' && result.files[1]!.name === 'doc-backs.pdf');

  const task = getDocument({ data: result.files[0]!.bytes.slice(), verbosity: 0 });
  const fronts = await task.promise;
  check('fronts file has 2 pages', fronts.numPages === 2, `got ${fronts.numPages}`);
  await task.destroy();
}

section('ui wiring: every element main.ts grabs exists in index.html');
{
  const root = new URL('..', import.meta.url);
  const main = await readFile(new URL('src/main.ts', root), 'utf8');
  const html = await readFile(new URL('index.html', root), 'utf8');

  const wanted = [...main.matchAll(/\bel<[^>]+>\('([^']+)'\)/g)].map((m) => m[1]!);
  const present = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!));

  check('main.ts looks up at least a dozen elements', wanted.length >= 12, `found ${wanted.length}`);
  const missing = wanted.filter((id) => !present.has(id));
  check('no missing ids', missing.length === 0, missing.join(', '));

  // Options the code branches on have to exist as real <option> values.
  for (const [select, values] of Object.entries({
    layout: ['mini8', 'river-cut', 'i-cut', 'duplex12', 'booklet'],
    fit: ['contain', 'cover', 'stretch'],
    flip: ['short', 'long'],
    split: ['combined', 'split'],
    binding: ['left', 'right'],
    units: ['mm', 'in'],
    'testdoc-pages': ['auto', '8', '16', '24', '32'],
  })) {
    const block = html.slice(html.indexOf(`id="${select}"`));
    const body = block.slice(0, block.indexOf('</select>'));
    const missingValues = values.filter((v) => !body.includes(`value="${v}"`));
    check(`#${select} offers ${values.join(', ')}`, missingValues.length === 0, missingValues.join(', '));
  }

  for (const key of PAPERS.map((p) => p.key)) {
    check(`paper "${key}" round-trips through getPaper`, getPaper(key).key === key);
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
