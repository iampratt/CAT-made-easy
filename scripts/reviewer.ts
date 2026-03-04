#!/usr/bin/env tsx
import { parseArgs } from 'node:util';
import { parsePdfText } from './pdfParser';

async function main() {
  const { values } = parseArgs({ options: { file: { type: 'string', short: 'f' } } });
  const file = values.file;
  if (!file) throw new Error('Use --file <pdf-path>');

  const text = await parsePdfText(file);
  const sample = text.split('\n').filter((line: string) => line.length > 30).slice(0, 60);
  console.log('Review sample (first 60 lines):');
  for (const [idx, line] of sample.entries()) {
    console.log(`${idx + 1}. ${line}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
