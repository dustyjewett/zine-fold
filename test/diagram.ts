/**
 * Renders the fold diagrams that appear in the README, straight from the plan
 * each layout actually produces. Page numbers, orientations and slit geometry
 * are all read back off the `ImpositionPlan`, so a diagram cannot drift away
 * from the code it documents — `verify.ts` fails if the README disagrees.
 *
 * Print them for pasting with: npm run diagrams
 */
import { planDuplex12 } from '../src/imposition/duplex12.ts';
import { planICut } from '../src/imposition/i-cut.ts';
import { planMini8 } from '../src/imposition/mini8.ts';
import { planRiverCut } from '../src/imposition/river-cut.ts';
import { getPaper } from '../src/imposition/paper.ts';
import type { SheetPlan } from '../src/imposition/types.ts';

/** A slit running down the page. Single-cell width, so the grid stays square. */
const CUT_DOWN = '⌇';
/** A slit running across it. */
const CUT_ACROSS = '~';
const FOLD = '-';

const CELL = 9;

interface Grid {
  cols: number;
  rows: number;
}

const centre = (text: string, width: number): string => {
  const pad = width - text.length;
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + text + ' '.repeat(pad - left);
};

export function renderSheet(sheet: SheetPlan, grid: Grid, notes: Record<number, string> = {}): string {
  const { cols, rows } = grid;
  const pw = sheet.width / cols;
  const ph = sheet.height / rows;
  const round = (n: number) => Math.round(n);

  // Panels, located by where the planner actually put them. Assumes the plan
  // was built without margins, so each box is exactly its cell.
  const pages = new Map<string, { page: number; flipped: boolean }>();
  for (const slot of sheet.slots) {
    const col = round(slot.box.x / pw);
    const row = rows - 1 - round(slot.box.y / ph);
    pages.set(`${row},${col}`, { page: slot.readerPage, flipped: slot.rotate180 });
  }

  // Slits, in grid terms: which columns are cut on each horizontal boundary,
  // and which rows are cut on each vertical one.
  const across = new Map<number, Set<number>>();
  const down = new Map<number, Set<number>>();
  for (const guide of sheet.guides) {
    if (guide.kind !== 'cut') continue;
    const [xa, xb] = [Math.min(guide.x1, guide.x2), Math.max(guide.x1, guide.x2)];
    const [ya, yb] = [Math.min(guide.y1, guide.y2), Math.max(guide.y1, guide.y2)];

    if (Math.abs(guide.y1 - guide.y2) < 0.01) {
      const row = rows - 1 - round(ya / ph);
      const set = across.get(row) ?? new Set();
      for (let c = round(xa / pw); c < round(xb / pw); c++) set.add(c);
      across.set(row, set);
    } else {
      const col = round(xa / pw) - 1;
      const set = down.get(col) ?? new Set();
      for (let r = rows - round(yb / ph); r <= rows - 1 - round(ya / ph); r++) set.add(r);
      down.set(col, set);
    }
  }

  const lines: string[] = [];

  let header = ' '.repeat(6);
  for (let c = 0; c < cols; c++) header += ' ' + centre(`col ${c}`, CELL);
  lines.push(header.trimEnd());

  /** The line below `row`; -1 is the sheet's top edge. */
  const boundary = (row: number): string => {
    const cut = across.get(row) ?? new Set<number>();
    let line = ' '.repeat(6);
    for (let c = 0; c < cols; c++) {
      if (c === 0) line += '+';
      else {
        // A junction is cut when a slit runs straight through it, either
        // along this boundary or as a vertical slit crossing over.
        const throughDown = (down.get(c - 1)?.has(row) ?? false) && (down.get(c - 1)?.has(row + 1) ?? false);
        const throughAcross = cut.has(c - 1) && cut.has(c);
        line += throughAcross ? CUT_ACROSS : throughDown ? CUT_DOWN : '+';
      }
      line += (cut.has(c) ? CUT_ACROSS : FOLD).repeat(CELL);
    }
    return line + '+';
  };

  lines.push(boundary(-1));
  for (let row = 0; row < rows; row++) {
    let line = `row ${row} `;
    let flipped = false;
    for (let c = 0; c < cols; c++) {
      line += c === 0 ? '|' : (down.get(c - 1)?.has(row) ? CUT_DOWN : '|');
      const cell = pages.get(`${row},${c}`);
      if (cell?.flipped) flipped = true;
      line += centre(cell ? String(cell.page) : '', CELL);
    }
    line += '|';
    if (flipped) line += '   prints upside down';
    lines.push(line.trimEnd());

    let below = boundary(row);
    if (notes[row]) below += '   ' + notes[row];
    lines.push(below.trimEnd());
  }

  const legend = down.size > 0
    ? `      ${FOLD.repeat(3)}  fold      ${CUT_ACROSS.repeat(3)}  cut across      ${CUT_DOWN}  cut down`
    : `      ${FOLD.repeat(3)}  fold      ${CUT_ACROSS.repeat(3)}  cut`;

  return `${lines.join('\n')}\n\n${legend}`;
}

const PAPER = getPaper('letter');
const OPTS = { paper: PAPER, margins: { panel: 0, edge: 0 }, guides: true };

/** Every diagram the README carries, keyed by the heading it sits under. */
export function readmeDiagrams(): Record<string, string> {
  const mini8 = planMini8(8, OPTS);
  const river = planRiverCut(16, OPTS);
  const icut = planICut(16, OPTS);
  const duplex = planDuplex12(12, { ...OPTS, rotateBacks: false });

  return {
    'mini8': renderSheet(mini8.sheets[0]!, { cols: 4, rows: 2 }, {
      0: 'cut these two panels only',
    }),
    'river-cut': renderSheet(river.sheets[0]!, { cols: 4, rows: 4 }, {
      0: 'cut in from the RIGHT — col 0 is the hinge',
      1: 'cut in from the LEFT  — col 3 is the hinge',
      2: 'cut in from the RIGHT — col 0 is the hinge',
    }),
    'i-cut': renderSheet(icut.sheets[0]!, { cols: 4, rows: 4 }, {
      0: 'top crossbar of the Ɪ',
      1: 'a dash in from each edge',
      2: 'bottom crossbar of the Ɪ',
    }),
    'duplex12-front': renderSheet(duplex.sheets[0]!, { cols: 4, rows: 2 }, {
      0: 'a dash in from each edge; the stroke rises through row 0',
    }),
    'duplex12-back': renderSheet(duplex.sheets[1]!, { cols: 4, rows: 2 }),
  };
}

// `npm run diagrams` prints them ready to paste into the README.
if (process.argv[1]?.endsWith('diagram.ts')) {
  for (const [name, diagram] of Object.entries(readmeDiagrams())) {
    console.log(`=== ${name} ===\n${diagram}\n`);
  }
}
