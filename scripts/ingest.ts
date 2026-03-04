#!/usr/bin/env tsx
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getCheckpoint, upsertCheckpoint } from './checkpointer';
import { embedBatch } from './embedder';
import { parsePdfPages } from './pdfParser';
import { splitQuantVarcQuestions } from './questionSplitter';
import { tagInBatches, type IngestSourceType } from './tagger';

type Section = 'quant' | 'dilr' | 'varc';

interface IngestOptions {
  file?: string;
  dir?: string;
  section: Section | 'auto';
  sourceType: IngestSourceType;
  sourceLabel?: string;
  dryRun: boolean;
  limitPages?: number;
  skipTagging: boolean;
  skipEmbedding: boolean;
}

interface CandidateQuestion {
  text: string;
  options: string[];
  textHash: string;
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
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

function dedupeByHash(items: Array<{ text: string; options: string[] }>): CandidateQuestion[] {
  const seen = new Set<string>();
  const out: CandidateQuestion[] = [];

  for (const item of items) {
    const text = item.text.trim();
    if (text.length < 20) continue;

    const textHash = createHash('md5').update(text).digest('hex');
    if (seen.has(textHash)) continue;
    seen.add(textHash);

    out.push({
      text,
      options: item.options,
      textHash,
    });
  }

  return out;
}

async function embedInBatches(texts: string[], batchSize = 32): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const output = await embedBatch(batch);
    vectors.push(...output);
  }
  return vectors;
}

async function ingestOneFile(filePath: string, opts: Omit<IngestOptions, 'file' | 'dir'>) {
  const supabase = createAdminSupabase();
  const checkpoint = await getCheckpoint(filePath);
  const startPage = Number(checkpoint?.last_processed_page ?? 0);
  const source = opts.sourceLabel?.trim() || path.basename(filePath, path.extname(filePath));

  const pages = await parsePdfPages(filePath);
  const effectivePages = typeof opts.limitPages === 'number' ? pages.slice(0, opts.limitPages) : pages;

  await upsertCheckpoint(filePath, {
    status: 'running',
    total_pages: effectivePages.length,
  });

  let inserted = Number(checkpoint?.questions_ingested ?? 0);
  let sinceLastCheckpoint = 0;

  for (let index = startPage; index < effectivePages.length; index += 1) {
    const page = effectivePages[index];
    if (!page.text && page.hasImage) {
      await upsertCheckpoint(filePath, {
        status: 'running',
        last_processed_page: index + 1,
        questions_ingested: inserted,
      });
      continue;
    }

    const parsed = splitQuantVarcQuestions(page.text);
    const candidates = dedupeByHash(parsed);

    const toInsert: CandidateQuestion[] = [];
    for (const candidate of candidates) {
      if (opts.dryRun) {
        toInsert.push(candidate);
        continue;
      }

      const { data: existing, error: existingError } = await supabase
        .from('questions')
        .select('id')
        .eq('text_hash', candidate.textHash)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) toInsert.push(candidate);
    }

    if (toInsert.length === 0) {
      await upsertCheckpoint(filePath, {
        status: 'running',
        last_processed_page: index + 1,
        questions_ingested: inserted,
      });
      continue;
    }

    if (opts.dryRun) {
      inserted += toInsert.length;
      sinceLastCheckpoint += toInsert.length;
    } else {
      const tagged = opts.skipTagging
        ? toInsert.map(() => ({ section: 'quant' as Section, topic: 'unclassified', difficulty: 'medium' as const, type: opts.sourceType, correct_answer: null, explanation: null }))
        : await tagInBatches(toInsert.map((q) => q.text), opts.sourceType, 10, 2000);

      const embeddings = opts.skipEmbedding
        ? toInsert.map(() => null)
        : await embedInBatches(toInsert.map((q) => q.text), 32);

      const rows = toInsert.map((question, i) => ({
        text: question.text,
        options: question.options,
        correct_answer: tagged[i]?.correct_answer ?? null,
        explanation: tagged[i]?.explanation ?? null,
        section: opts.section === 'auto' ? (tagged[i]?.section ?? 'quant') : opts.section,
        topic: tagged[i]?.topic ?? 'unclassified',
        difficulty: tagged[i]?.difficulty ?? 'medium',
        source,
        type: opts.sourceType,
        embedding: embeddings[i] ?? null,
        text_hash: question.textHash,
      }));

      const { error } = await supabase.from('questions').insert(rows);
      if (error) throw error;

      inserted += rows.length;
      sinceLastCheckpoint += rows.length;
    }

    if (sinceLastCheckpoint >= 100 || (index + 1) % 5 === 0) {
      await upsertCheckpoint(filePath, {
        status: 'running',
        last_processed_page: index + 1,
        questions_ingested: inserted,
      });
      sinceLastCheckpoint = 0;
    }
  }

  await upsertCheckpoint(filePath, {
    status: 'completed',
    last_processed_page: effectivePages.length,
    questions_ingested: inserted,
  });

  return { filePath, inserted };
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
      'skip-tagging': { type: 'boolean' },
      'skip-embedding': { type: 'boolean' },
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
    sourceType: sourceTypeArg as IngestSourceType,
    sourceLabel: values.source,
    dryRun: Boolean(values['dry-run']),
    limitPages,
    skipTagging: Boolean(values['skip-tagging']),
    skipEmbedding: Boolean(values['skip-embedding']),
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

  let totalInserted = 0;
  for (const filePath of files) {
    const result = await ingestOneFile(filePath, {
      section: opts.section,
      sourceType: opts.sourceType,
      sourceLabel: opts.sourceLabel,
      dryRun: opts.dryRun,
      limitPages: opts.limitPages,
      skipTagging: opts.skipTagging,
      skipEmbedding: opts.skipEmbedding,
    });

    totalInserted += result.inserted;
    console.log(`[ingest] ${path.basename(result.filePath)} | running_total=${totalInserted}`);
  }

  console.log(`Ingestion complete. Total inserted (or parsed in dry-run): ${totalInserted}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
