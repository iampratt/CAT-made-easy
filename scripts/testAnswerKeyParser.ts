#!/usr/bin/env tsx
import { detectAnswerKeys } from './extractionPipeline';

const sample = `Answer Keys: VARC DILR QUANT Question No. Answer Question No. Answer Question No. Answer 1 A 2 C 3 D 4 B 5 A 6 D`;

const parsed = detectAnswerKeys(sample);
if (parsed.length < 6) {
  console.error('Answer key parser failed. Parsed entries:', parsed.length);
  process.exit(1);
}

console.log('Answer key parser passed. Parsed entries:', parsed.length);
