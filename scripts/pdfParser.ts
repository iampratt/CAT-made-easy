import fs from 'node:fs/promises';

export async function parsePdfText(filePath: string) {
  // Keep script compile-safe in strict TS; replace with pdf-parse extraction in production ingestion.
  const buffer = await fs.readFile(filePath);
  return buffer.toString('utf-8');
}

export function splitPages(rawText: string) {
  return rawText.split('\f').filter(Boolean);
}
