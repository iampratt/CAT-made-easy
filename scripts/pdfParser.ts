import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface ParsedPdfPage {
  pageNumber: number;
  text: string;
  hasImage: boolean;
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function parsePdfPages(filePath: string): Promise<ParsedPdfPage[]> {
  const require = createRequire(import.meta.url);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = (pdfjs as unknown as { OPS?: Record<string, number> }).OPS;
  const data = await readFile(filePath);
  const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const standardFontDataUrl = path.join(pdfRoot, 'standard_fonts/');
  const wasmUrl = path.join(pdfRoot, 'wasm/');

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl,
    wasmUrl,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  const pages: ParsedPdfPage[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const operatorList = await page.getOperatorList();
    const fnArray = operatorList.fnArray as number[];
    const hasImage = OPS
      ? fnArray.some((fn) =>
        fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintJpegXObject)
      : false;
    const items = content.items as Array<{ str?: string; hasEOL?: boolean }>;

    const lineParts: string[] = [];
    for (const item of items) {
      const value = (item.str ?? '').trim();
      if (!value) continue;
      lineParts.push(value);
      if (item.hasEOL) lineParts.push('\n');
    }

    const raw = lineParts.join(' ').replace(/\n\s+/g, '\n');
    pages.push({ pageNumber, text: normalizeWhitespace(raw), hasImage });
  }

  return pages;
}
