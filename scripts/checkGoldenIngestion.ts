#!/usr/bin/env tsx
import { runExtractionPipeline } from './extractionPipeline';

const GOLDEN: Array<{ file: string; expected: number; tolerance: number }> = [
  { file: './books/CAT 2021-Slot-1- With Answer.pdf', expected: 66, tolerance: 10 },
  { file: './books/CAT 2021-Slot-2- With Answer.pdf', expected: 66, tolerance: 10 },
  { file: './books/CAT 2021-Slot-3- With Answer.pdf', expected: 66, tolerance: 10 },
];

async function main() {
  let failed = 0;

  for (const test of GOLDEN) {
    const extraction = await runExtractionPipeline(test.file);
    const actual = extraction.summary.totalQuestions;
    const delta = Math.abs(actual - test.expected);
    const pass = delta <= test.tolerance;

    console.log(`${pass ? 'PASS' : 'FAIL'} ${test.file}`);
    console.log(`  expected=${test.expected} tolerance=±${test.tolerance} actual=${actual} lowConfPages=${extraction.summary.lowConfidencePages}`);

    if (!pass) failed += 1;
  }

  if (failed > 0) {
    console.error(`Golden ingestion checks failed (${failed}).`);
    process.exit(1);
  }

  console.log('Golden ingestion checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
