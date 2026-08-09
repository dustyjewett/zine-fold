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
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { planBooklet } from '../src/imposition/booklet.ts';
import { planMini8 } from '../src/imposition/mini8.ts';
import { planMini16 } from '../src/imposition/mini16.ts';
import { getPaper, landscape, PAPERS, portrait } from '../src/imposition/paper.ts';
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

section('mini-zine: 8 panels on one single-sided sheet');
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

section('mini-zine: short document pads to 8, long document splits');
{
  const short = await imposeMini8(5);
  check('5 pages still make one sheet', short.plan.sheets.length === 1);
  check('3 blanks added', short.plan.blanksAdded === 3, `got ${short.plan.blanksAdded}`);
  const glyphs = await readGlyphs(short.bytes, 1);
  check('no page 6 drawn', !findNumber(glyphs, 6));
  check('page 5 still drawn', !!findNumber(glyphs, 5));

  const long = planMini8(20, { paper: getPaper('letter'), margins: NO_MARGINS, guides: false });
  check('20 pages make 3 mini-zines', long.sheets.length === 3, `got ${long.sheets.length}`);
  check('4 blanks added', long.blanksAdded === 4, `got ${long.blanksAdded}`);
}

section('16-page mini-zine: 4x4 snaking layout');
{
  const paper = getPaper('letter');
  const sheet = portrait(paper);
  const pw = sheet.width / 4;
  const ph = sheet.height / 4;

  const testBytes = await buildTestDocument(16, pw, ph);
  const src = await PDFDocument.load(testBytes);
  const plan = planMini16(16, { paper, margins: NO_MARGINS, guides: true });
  const result = await renderPlan(src, plan, { fit: 'contain', numberOverlay: false }, 'combined', 'test');

  check('one output sheet', plan.sheets.length === 1, `got ${plan.sheets.length}`);
  check('sheet is portrait', sheet.height > sheet.width, `${sheet.width} x ${sheet.height}`);
  check('no blanks needed', plan.blanksAdded === 0);

  const glyphs = await readGlyphs(result.files[0]!.bytes, 1);
  // row 0 is the top of the sheet; rows 0 and 2 print upside down
  const expected: Record<number, { col: number; row: number }> = {
    4: { col: 0, row: 0 }, 3: { col: 1, row: 0 }, 2: { col: 2, row: 0 }, 1: { col: 3, row: 0 },
    5: { col: 0, row: 1 }, 6: { col: 1, row: 1 }, 7: { col: 2, row: 1 }, 8: { col: 3, row: 1 },
    12: { col: 0, row: 2 }, 11: { col: 1, row: 2 }, 10: { col: 2, row: 2 }, 9: { col: 3, row: 2 },
    13: { col: 0, row: 3 }, 14: { col: 1, row: 3 }, 15: { col: 2, row: 3 }, 16: { col: 3, row: 3 },
  };

  let placed = 0;
  for (const [pageStr, want] of Object.entries(expected)) {
    const n = Number(pageStr);
    const g = findNumber(glyphs, n);
    if (!g) { check(`page ${n} present`, false); continue; }
    const col = Math.floor(g.x / pw);
    const row = 3 - Math.floor(g.y / ph);
    const wantAngle = want.row % 2 === 0 ? 180 : 0;
    if (col === want.col && row === want.row && g.angle === wantAngle) placed++;
    else {
      check(`page ${n} → col ${want.col} row ${want.row} @${wantAngle}°`, false,
        `got col ${col} row ${row} @${g.angle}°`);
    }
  }
  check('all 16 panels placed and oriented correctly', placed === 16, `${placed}/16`);

  // Consecutive pages must be orthogonally adjacent, or the strip is severed.
  const cellOf = (n: number) => expected[n]!;
  const breaks: string[] = [];
  for (let n = 1; n < 16; n++) {
    const a = cellOf(n);
    const b = cellOf(n + 1);
    if (Math.abs(a.col - b.col) + Math.abs(a.row - b.row) !== 1) breaks.push(`${n}->${n + 1}`);
  }
  check('every page neighbours the next', breaks.length === 0, breaks.join(' '));
}

section('16-page mini-zine: cuts leave exactly the right hinges');
{
  const paper = getPaper('letter');
  const sheet = portrait(paper);
  const pw = sheet.width / 4;
  const ph = sheet.height / 4;
  const plan = planMini16(16, { paper, margins: NO_MARGINS, guides: true });
  const cuts = plan.sheets[0]!.guides.filter((g) => g.kind === 'cut');

  check('three cuts', cuts.length === 3, `got ${cuts.length}`);
  check('all cuts are horizontal', cuts.every((c) => Math.abs(c.y1 - c.y2) < 0.01));

  // Ordered top to bottom: below row 0, row 1, row 2.
  const byHeight = [...cuts].sort((a, b) => b.y1 - a.y1);
  const spans = byHeight.map((c) => {
    const x1 = Math.min(c.x1, c.x2) / pw;
    const x2 = Math.max(c.x1, c.x2) / pw;
    return `${x1.toFixed(0)}..${x2.toFixed(0)}`;
  });
  check('slits are right, left, right — 3 panels each',
    spans.join(' ') === '1..4 0..3 1..4', spans.join(' '));

  const heights = byHeight.map((c) => (c.y1 / ph).toFixed(0));
  check('cuts sit on the row boundaries', heights.join(',') === '3,2,1', heights.join(','));

  // The hinge is the panel each slit deliberately spares.
  const hinges = byHeight.map((c) => (Math.min(c.x1, c.x2) < 0.01 ? 'right' : 'left'));
  check('hinges alternate left, right, left', hinges.join(',') === 'left,right,left', hinges.join(','));
}

section('16-page mini-zine: padding and multiple zines');
{
  const paper = getPaper('letter');
  const short = planMini16(10, { paper, margins: NO_MARGINS, guides: false });
  check('10 pages still one sheet', short.sheets.length === 1);
  check('6 blanks added', short.blanksAdded === 6, `got ${short.blanksAdded}`);

  const long = planMini16(40, { paper, margins: NO_MARGINS, guides: false });
  check('40 pages make 3 zines', long.sheets.length === 3, `got ${long.sheets.length}`);
  check('8 blanks added', long.blanksAdded === 8, `got ${long.blanksAdded}`);
  const secondSheetPages = long.sheets[1]!.slots.map((s) => s.readerPage).sort((a, b) => a - b);
  check('second zine covers pages 17-32',
    secondSheetPages[0] === 17 && secondSheetPages[15] === 32,
    `${secondSheetPages[0]}..${secondSheetPages[15]}`);
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
    layout: ['mini8', 'mini16', 'booklet'],
    fit: ['contain', 'cover', 'stretch'],
    flip: ['short', 'long'],
    split: ['combined', 'split'],
    binding: ['left', 'right'],
    units: ['mm', 'in'],
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
