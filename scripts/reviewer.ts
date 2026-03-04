#!/usr/bin/env tsx
import { parseArgs } from 'node:util';
import { parsePdfPages } from './pdfParser';
import { splitQuantVarcQuestions } from './questionSplitter';

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', short: 'f' },
      pages: { type: 'string' },
    },
  });

  const file = values.file;
  if (!file) throw new Error('Use --file <pdf-path>');

  const pageLimit = values.pages ? Number(values.pages) : 20;
  const pages = await parsePdfPages(file);
  const samplePages = pages.slice(0, Number.isFinite(pageLimit) ? pageLimit : 20);

  const sample = samplePages.flatMap((page) =>
    splitQuantVarcQuestions(page.text).map((q) => ({ page: page.pageNumber, ...q })),
  );

  const preview = sample.slice(0, 60);
  console.log(`Found ${sample.length} parsed questions in first ${samplePages.length} pages. Previewing ${preview.length}:`);

  for (const [idx, item] of preview.entries()) {
    console.log(`\n${idx + 1}. [p${item.page}] ${item.text.slice(0, 180)}`);
    console.log(`   ${item.options.join(' | ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
