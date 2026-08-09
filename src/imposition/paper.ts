export interface Paper {
  key: string;
  label: string;
  /** Portrait dimensions in points. */
  width: number;
  height: number;
}

const IN = 72;
const MM = 72 / 25.4;

export const PAPERS: Paper[] = [
  { key: 'letter', label: 'Letter (8.5 x 11 in)', width: 8.5 * IN, height: 11 * IN },
  { key: 'a4', label: 'A4 (210 x 297 mm)', width: 210 * MM, height: 297 * MM },
  { key: 'legal', label: 'Legal (8.5 x 14 in)', width: 8.5 * IN, height: 14 * IN },
  { key: 'tabloid', label: 'Tabloid (11 x 17 in)', width: 11 * IN, height: 17 * IN },
  { key: 'a3', label: 'A3 (297 x 420 mm)', width: 297 * MM, height: 420 * MM },
];

export function getPaper(key: string): Paper {
  return PAPERS.find((p) => p.key === key) ?? PAPERS[0]!;
}

/** Both supported layouts fold a landscape sheet, so the long edge is always horizontal. */
export function landscape(paper: Paper): { width: number; height: number } {
  return {
    width: Math.max(paper.width, paper.height),
    height: Math.min(paper.width, paper.height),
  };
}

export const UNITS = { in: IN, mm: MM } as const;
export type UnitKey = keyof typeof UNITS;
