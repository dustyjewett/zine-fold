import './style.css';
import { PDFDocument } from 'pdf-lib';
import { planBooklet } from './imposition/booklet.ts';
import { MINI8_PAGES_PER_SHEET, planMini8 } from './imposition/mini8.ts';
import { planICut } from './imposition/i-cut.ts';
import { planRiverCut } from './imposition/river-cut.ts';
import { getPaper, landscape, PAPERS, portrait, UNITS, type UnitKey } from './imposition/paper.ts';
import type { FitMode, ImpositionPlan } from './imposition/types.ts';
import { parsePageRange } from './range.ts';
import { renderPlan, type RenderResult, type SplitMode } from './render.ts';
import { buildTestDocument } from './testdoc.ts';

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
};

const ui = {
  file: el<HTMLInputElement>('file'),
  fileInfo: el<HTMLParagraphElement>('file-info'),
  layout: el<HTMLSelectElement>('layout'),
  paper: el<HTMLSelectElement>('paper'),
  signature: el<HTMLSelectElement>('signature'),
  binding: el<HTMLSelectElement>('binding'),
  flip: el<HTMLSelectElement>('flip'),
  split: el<HTMLSelectElement>('split'),
  range: el<HTMLInputElement>('range'),
  fit: el<HTMLSelectElement>('fit'),
  panelMargin: el<HTMLInputElement>('panel-margin'),
  edgeMargin: el<HTMLInputElement>('edge-margin'),
  units: el<HTMLSelectElement>('units'),
  guides: el<HTMLInputElement>('guides'),
  numbers: el<HTMLInputElement>('numbers'),
  download: el<HTMLButtonElement>('download'),
  testdoc: el<HTMLButtonElement>('testdoc'),
  testdocPages: el<HTMLSelectElement>('testdoc-pages'),
  status: el<HTMLParagraphElement>('status'),
  sheetInfo: el<HTMLParagraphElement>('sheet-info'),
  previewLabel: el<HTMLSpanElement>('preview-label'),
  viewer: el<HTMLIFrameElement>('viewer'),
  placeholder: el<HTMLDivElement>('placeholder'),
};

interface State {
  /** The uploaded document, all pages, in file order. */
  source: PDFDocument | null;
  baseName: string;
  /** Subset of `source` in reading order, rebuilt when the page range changes. */
  subset: PDFDocument | null;
  subsetKey: string;
  result: RenderResult | null;
  previewUrl: string | null;
  /** Bumped per run so a slow render can't overwrite a newer one. */
  runId: number;
}

const state: State = {
  source: null,
  baseName: 'zine',
  subset: null,
  subsetKey: '',
  result: null,
  previewUrl: null,
  runId: 0,
};

for (const paper of PAPERS) {
  const option = document.createElement('option');
  option.value = paper.key;
  option.textContent = paper.label;
  ui.paper.append(option);
}

type Layout = 'mini8' | 'river-cut' | 'i-cut' | 'booklet';

function layout(): Layout {
  const value = ui.layout.value;
  return value === 'booklet' || value === 'river-cut' || value === 'i-cut' ? value : 'mini8';
}

function isBooklet(): boolean {
  return layout() === 'booklet';
}

function is16Page(): boolean {
  return layout() === 'river-cut' || layout() === 'i-cut';
}

/** Pages one sheet holds; for the booklet it depends on the signature size. */
function pagesPerSheet(): number {
  return is16Page() ? 16 : MINI8_PAGES_PER_SHEET;
}

function syncVisibility(): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-when]')) {
    node.hidden = node.dataset.when !== ui.layout.value;
  }
}

function toPoints(input: HTMLInputElement): number {
  const value = Number(input.value);
  const unit = UNITS[ui.units.value as UnitKey] ?? UNITS.mm;
  return Number.isFinite(value) && value > 0 ? value * unit : 0;
}

function sheetsPerSignature(): number | 'single' {
  return ui.signature.value === 'single' ? 'single' : Number(ui.signature.value);
}

function buildPlan(pageCount: number): ImpositionPlan {
  const paper = getPaper(ui.paper.value);
  const margins = { panel: toPoints(ui.panelMargin), edge: toPoints(ui.edgeMargin) };
  const guides = ui.guides.checked;

  switch (layout()) {
    case 'booklet':
      return planBooklet(pageCount, {
        paper,
        margins,
        guides,
        sheetsPerSignature: sheetsPerSignature(),
        binding: ui.binding.value === 'right' ? 'right' : 'left',
        rotateBacks: ui.flip.value === 'long',
      });
    case 'river-cut':
      return planRiverCut(pageCount, { paper, margins, guides });
    case 'i-cut':
      return planICut(pageCount, { paper, margins, guides });
    default:
      return planMini8(pageCount, { paper, margins, guides });
  }
}

/** Sheet dimensions as the current layout orients them. */
function sheetSize(): { width: number; height: number } {
  const paper = getPaper(ui.paper.value);
  return is16Page() ? portrait(paper) : landscape(paper);
}

/** Panel dimensions for the current layout — used to size the test document. */
function panelSize(): { width: number; height: number } {
  const { width, height } = sheetSize();
  switch (layout()) {
    case 'booklet': return { width: width / 2, height };
    case 'river-cut':
    case 'i-cut': return { width: width / 4, height: height / 4 };
    default: return { width: width / 4, height: height / 2 };
  }
}

/** Describe the sheet and finished page size under the paper picker. */
function syncSheetInfo(): void {
  const inches = (points: number) => points / 72;
  const { width, height } = sheetSize();
  const panel = panelSize();
  const unit = ui.units.value === 'in' ? 'in' : 'mm';
  const show = (points: number) =>
    unit === 'in' ? inches(points).toFixed(2) : (points / UNITS.mm).toFixed(0);

  ui.sheetInfo.textContent =
    `${show(width)} × ${show(height)} ${unit} ${width > height ? 'landscape' : 'portrait'}` +
    ` · finished page ${show(panel.width)} × ${show(panel.height)} ${unit}`;
}

function setStatus(message: string, isError = false): void {
  ui.status.textContent = message;
  ui.status.classList.toggle('error', isError);
}

function clearPreview(): void {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  state.result = null;
  ui.viewer.removeAttribute('src');
  ui.viewer.hidden = true;
  ui.placeholder.hidden = false;
  ui.download.disabled = true;
}

async function getSubset(indices: number[]): Promise<PDFDocument> {
  const source = state.source;
  if (!source) throw new Error('No source document');

  const identity =
    indices.length === source.getPageCount() && indices.every((v, i) => v === i);
  if (identity) return source;

  const key = indices.join(',');
  if (state.subset && state.subsetKey === key) return state.subset;

  const subset = await PDFDocument.create();
  const copied = await subset.copyPages(source, indices);
  for (const page of copied) subset.addPage(page);

  state.subset = subset;
  state.subsetKey = key;
  return subset;
}

async function regenerate(): Promise<void> {
  if (!state.source) return;

  const runId = ++state.runId;
  setStatus('Imposing…');

  try {
    const indices = parsePageRange(ui.range.value, state.source.getPageCount());
    const doc = await getSubset(indices);
    const plan = buildPlan(indices.length);
    const split = (isBooklet() ? ui.split.value : 'combined') as SplitMode;

    const result = await renderPlan(
      doc,
      plan,
      {
        fit: ui.fit.value as FitMode,
        numberOverlay: ui.numbers.checked,
        title: `${state.baseName} — ${isBooklet() ? 'booklet' : 'mini-zine'}`,
      },
      split,
      state.baseName,
    );

    if (runId !== state.runId) return; // a newer run already started

    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.result = result;

    const first = result.files[0]!;
    // Copy into a fresh buffer: pdf-lib returns a view that may sit inside a
    // larger pooled ArrayBuffer, which Blob would otherwise swallow whole.
    const blob = new Blob([first.bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
    state.previewUrl = URL.createObjectURL(blob);
    ui.viewer.src = state.previewUrl;
    ui.viewer.hidden = false;
    ui.placeholder.hidden = true;
    ui.download.disabled = false;

    ui.previewLabel.textContent =
      result.files.length > 1 ? `Preview — ${first.name} (of ${result.files.length} files)` : 'Preview';
    setStatus(describePlan(plan, indices.length, result));
  } catch (error) {
    if (runId !== state.runId) return;
    clearPreview();
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

function describePlan(plan: ImpositionPlan, pageCount: number, result: RenderResult): string {
  const parts: string[] = [];
  const physicalSheets = isBooklet() ? plan.sheets.length / 2 : plan.sheets.length;
  parts.push(`${pageCount} page${pageCount === 1 ? '' : 's'} → ${physicalSheets} sheet${physicalSheets === 1 ? '' : 's'}`);

  if (isBooklet()) {
    const sigs = new Set(plan.sheets.map((s) => s.signature)).size;
    parts.push(`${sigs} signature${sigs === 1 ? '' : 's'}`);
    parts.push(`${plan.sheets.length} sides, duplex`);
  } else {
    const zines = plan.sheets.length;
    if (zines > 1) parts.push(`${zines} separate mini-zines of ${pagesPerSheet()} pages`);
    parts.push('single-sided');
    const slits = plan.sheets[0]?.guides.filter((g) => g.kind === 'cut').length ?? 0;
    if (slits > 0) parts.push(`${slits} slit${slits === 1 ? '' : 's'} per sheet`);
  }

  if (plan.blanksAdded > 0) {
    parts.push(`${plan.blanksAdded} blank${plan.blanksAdded === 1 ? '' : 's'} added to fill out`);
  }
  if (result.files.length > 1) parts.push(`${result.files.length} files`);

  return parts.join(' · ');
}

function saveBytes(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(
    new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

let debounce: number | undefined;
function scheduleRegenerate(): void {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(() => void regenerate(), 250);
}

ui.file.addEventListener('change', async () => {
  const file = ui.file.files?.[0];
  if (!file) return;

  clearPreview();
  state.subset = null;
  state.subsetKey = '';
  setStatus('Reading…');

  try {
    const bytes = await file.arrayBuffer();
    state.source = await PDFDocument.load(bytes, { ignoreEncryption: true });
    state.baseName = file.name.replace(/\.pdf$/i, '') || 'zine';

    const count = state.source.getPageCount();
    ui.fileInfo.textContent = `${file.name} — ${count} page${count === 1 ? '' : 's'}`;
    await regenerate();
  } catch (error) {
    state.source = null;
    ui.fileInfo.textContent = 'No file loaded.';
    setStatus(
      error instanceof Error ? `Could not read that PDF: ${error.message}` : String(error),
      true,
    );
  }
});

ui.layout.addEventListener('change', () => {
  syncVisibility();
  syncSheetInfo();
  scheduleRegenerate();
});

for (const control of [
  ui.paper, ui.signature, ui.binding, ui.flip, ui.split,
  ui.fit, ui.units, ui.guides, ui.numbers,
]) {
  control.addEventListener('change', () => {
    syncSheetInfo();
    scheduleRegenerate();
  });
}
for (const control of [ui.range, ui.panelMargin, ui.edgeMargin]) {
  control.addEventListener('input', scheduleRegenerate);
}

ui.download.addEventListener('click', () => {
  const files = state.result?.files;
  if (!files?.length) return;
  files.forEach((file, i) => setTimeout(() => saveBytes(file.name, file.bytes), i * 400));
});

/** Pages in one finished zine or signature, for the current settings. */
function pagesPerZine(): number {
  if (!isBooklet()) return pagesPerSheet();
  const perSig = sheetsPerSignature();
  return perSig === 'single' ? 8 : perSig * 4;
}

ui.testdoc.addEventListener('click', async () => {
  const per = pagesPerZine();
  const choice = ui.testdocPages.value;
  const pages = choice === 'auto' ? per : Number(choice);

  const { width, height } = panelSize();
  setStatus('Building test document…');
  const bytes = await buildTestDocument(pages, width, height, per);
  saveBytes(`zine-test-${pages}pp.pdf`, bytes);

  const zines = Math.ceil(pages / per);
  const spread = zines > 1 ? ` across ${zines} zines of ${per}` : '';
  setStatus(
    `Test document saved — ${pages} numbered pages${spread}, sized to one panel. ` +
    'Load it above, print, fold.',
  );
});

syncVisibility();
syncSheetInfo();
setStatus('');
