/**
 * Parse a page range like "1-4, 7, 12-9" into 0-based indices.
 * Descending ranges count backwards, which is a cheap way to reverse a section.
 * Returns all pages when the expression is blank.
 */
export function parsePageRange(expr: string, pageCount: number): number[] {
  const trimmed = expr.trim();
  if (!trimmed) return Array.from({ length: pageCount }, (_, i) => i);

  const out: number[] = [];
  for (const part of trimmed.split(',')) {
    const chunk = part.trim();
    if (!chunk) continue;

    const match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(chunk);
    if (!match) throw new Error(`Can't read "${chunk}" as a page or range`);

    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < 1 || from > pageCount || to > pageCount) {
      throw new Error(`"${chunk}" is outside 1-${pageCount}`);
    }

    const step = to >= from ? 1 : -1;
    for (let p = from; step > 0 ? p <= to : p >= to; p += step) out.push(p - 1);
  }

  if (out.length === 0) throw new Error('That page range selects nothing');
  return out;
}
