#!/usr/bin/env tsx
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getCheckpoint, upsertCheckpoint } from './checkpointer';
import { parsePdfPages } from './pdfParser';
import { splitQuantVarcQuestions } from './questionSplitter';

type Section = 'quant' | 'dilr' | 'varc';
type SourceType = 'past_paper' | 'book';

interface IngestOptions {
  file?: string;
  dir?: string;
  section: Section | 'auto';
  sourceType: SourceType;
  sourceLabel?: string;
  dryRun: boolean;
  limitPages?: number;
}

function inferSection(filePath: string): Section {
  const lower = filePath.toLowerCase();
  if (lower.includes('varc') || lower.includes('verbal') || lower.includes('reading')) return 'varc';
  if (lower.includes('dilr') || lower.includes('lrdi') || lower.includes('logical')) return 'dilr';
  return 'quant';
}

async function listPdfFiles(rootDir: string): Promise<string[]> {
  const queue = [rootDir];
  const files: string[] = [];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

function dedupeByTextHash<T extends { text: string }>(items: T[]) {
  const seen = new Set<string>();
  const out: Array<T & { textHash: string }> = [];

  for (const item of items) {
    const textHash = createHash('md5').update(item.text).digest('hex');
    if (seen.has(textHash)) continue;
    seen.add(textHash);
    out.push({ ...item, textHash });
  }

  return out;
}

async function ingestOneFile(filePath: string, opts: Omit<IngestOptions, 'file' | 'dir'>) {
  const supabase = createAdminSupabase();
  const checkpoint = await getCheckpoint(filePath);
  const startPage = Number(checkpoint?.last_processed_page ?? 0);
  const section = opts.section === 'auto' ? inferSection(filePath) : opts.section;
  const source = opts.sourceLabel?.trim() || path.basename(filePath, path.extname(filePath));

  const pages = await parsePdfPages(filePath);
  const limitedPages = typeof opts.limitPages === 'number' ? pages.slice(0, opts.limitPages) : pages;

  await upsertCheckpoint(filePath, {
    status: 'running',
    total_pages: limitedPages.length,
  });

  let inserted = Number(checkpoint?.questions_ingested ?? 0);

  for (let index = startPage; index < limitedPages.length; index += 1) {
    const page = limitedPages[index];
    const chunks = dedupeByTextHash(splitQuantVarcQuestions(page.text));

    for (const chunk of chunks) {
      if (opts.dryRun) {
        inserted += 1;
        continue;
      }

      const { data: existing, error: existingError } = await supabase
        .from('questions')
        .select('id')
        .eq('text_hash', chunk.textHash)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) continue;

      const { error } = await supabase.from('questions').insert({
        text: chunk.text,
        options: chunk.options,
        correct_answer: null,
        explanation: null,
        section,
        topic: 'unclassified',
        difficulty: 'medium',
        source,
        type: opts.sourceType,
        text_hash: chunk.textHash,
      });
      if (error) throw error;
      inserted += 1;
    }

    if ((index + 1) % 10 === 0) {
      await upsertCheckpoint(filePath, {
        status: 'running',
        last_processed_page: index + 1,
        questions_ingested: inserted,
      });
    }
  }

  await upsertCheckpoint(filePath, {
    status: 'completed',
    last_processed_page: limitedPages.length,
    questions_ingested: inserted,
  });

  return { filePath, section, inserted };
}

function parseCli(): IngestOptions {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', short: 'f' },
      dir: { type: 'string', short: 'd' },
      section: { type: 'string' },
      'source-type': { type: 'string' },
      source: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'limit-pages': { type: 'string' },
    },
  });

  const sectionArg = (values.section ?? 'auto').toLowerCase();
  if (!['auto', 'quant', 'dilr', 'varc'].includes(sectionArg)) {
    throw new Error('section must be one of: auto, quant, dilr, varc');
  }

  const sourceTypeArg = (values['source-type'] ?? 'past_paper').toLowerCase();
  if (!['past_paper', 'book'].includes(sourceTypeArg)) {
    throw new Error('source-type must be one of: past_paper, book');
  }

  const limitPages = values['limit-pages'] ? Number(values['limit-pages']) : undefined;
  if (typeof limitPages === 'number' && (!Number.isFinite(limitPages) || limitPages <= 0)) {
    throw new Error('limit-pages must be a positive number');
  }

  return {
    file: values.file,
    dir: values.dir,
    section: sectionArg as Section | 'auto',
    sourceType: sourceTypeArg as SourceType,
    sourceLabel: values.source,
    dryRun: Boolean(values['dry-run']),
    limitPages,
  };
}

async function main() {
  const opts = parseCli();
  if (!opts.file && !opts.dir) {
    throw new Error('Use --file <pdf-path> or --dir <directory-with-pdfs>');
  }

  const files = opts.file ? [opts.file] : await listPdfFiles(opts.dir!);
  if (files.length === 0) {
    throw new Error('No PDF files found to ingest.');
  }

  let total = 0;
  for (const filePath of files) {
    const result = await ingestOneFile(filePath, {
      section: opts.section,
      sourceType: opts.sourceType,
      sourceLabel: opts.sourceLabel,
      dryRun: opts.dryRun,
      limitPages: opts.limitPages,
    });

    total += result.inserted;
    console.log(`[ingest] ${path.basename(result.filePath)} | section=${result.section} | running_total=${total}`);
  }

  console.log(`Ingestion complete. Total inserted (or parsed in dry-run): ${total}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
