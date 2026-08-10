/**
 * A Word template sized to one panel of the chosen layout, so pages can be
 * authored at the finished size instead of guessed at and scaled.
 *
 * A .docx is a ZIP of XML parts. Only three are needed for Word to open the
 * file, and the XML is small, so the archive is written uncompressed (STORE)
 * and the whole thing costs about eighty lines instead of a dependency.
 */

const enc = new TextEncoder();

/** CRC-32 (IEEE), the checksum every ZIP entry carries. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Minimal stored (uncompressed) ZIP. Timestamps are fixed at the epoch DOS
 * understands, so the same input always produces byte-identical output.
 */
function zipStore(entries: ZipEntry[]): Uint8Array {
  const DOS_DATE = 0x0021; // 1980-01-01
  const DOS_TIME = 0;
  const UTF8_NAMES = 0x0800;

  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, entry.data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, UTF8_NAMES, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, DOS_TIME, true);
    dir.setUint16(14, DOS_DATE, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, size, true);
    dir.setUint32(24, size, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + size;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of all) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Word measures pages in twips — twentieths of a point. */
const twips = (points: number) => Math.round(points * 20);

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

export interface DocxTemplateOptions {
  pageCount: number;
  /** Finished page size in points — one panel of the layout. */
  widthPt: number;
  heightPt: number;
  /** Page margin in points. */
  marginPt: number;
  /** Pages in one zine, so cover markers repeat for a multi-zine run. */
  pagesPerZine: number;
  /** Shown on page 1 so the file explains itself once opened. */
  layoutName: string;
}

export function buildDocxTemplate(opts: DocxTemplateOptions): Uint8Array {
  const { pageCount, widthPt, heightPt, marginPt, pagesPerZine, layoutName } = opts;
  const per = Math.max(1, pagesPerZine);

  const label = (page: number): string => {
    const role = (page - 1) % per === 0
      ? 'front cover'
      : page % per === 0 || page === pageCount
        ? 'back cover'
        : '';
    return role ? `Page ${page} — ${role}` : `Page ${page}`;
  };

  const body: string[] = [];
  for (let page = 1; page <= pageCount; page++) {
    // The page break rides on the label's run, so no stray empty paragraph
    // is left at the top of each page for the author to delete.
    const brk = page > 1 ? '<w:r><w:br w:type="page"/></w:r>' : '';
    const note = page === 1 ? `${label(page)} · ${layoutName}` : label(page);
    body.push(
      '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>' + brk +
      '<w:r><w:rPr><w:color w:val="AAAAAA"/><w:sz w:val="14"/></w:rPr>' +
      `<w:t xml:space="preserve">${escapeXml(note)}</w:t></w:r></w:p>`,
      '<w:p/>',
    );
  }

  const landscape = widthPt > heightPt;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${body.join('\n')}
<w:sectPr>
<w:pgSz w:w="${twips(widthPt)}" w:h="${twips(heightPt)}"${landscape ? ' w:orient="landscape"' : ''}/>
<w:pgMar w:top="${twips(marginPt)}" w:right="${twips(marginPt)}" w:bottom="${twips(marginPt)}" w:left="${twips(marginPt)}" w:header="0" w:footer="0" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`;

  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
    { name: 'word/document.xml', data: enc.encode(document) },
  ]);
}
