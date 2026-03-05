#!/usr/bin/env tsx
import { createHash, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { getCheckpoint, upsertCheckpoint } from './checkpointer';
import { embedBatch } from './embedder';
import { extractImagesFromPdf, type ExtractedImage } from './imageExtractor';
import { runExtractionPipeline, type ParsedPage } from './extractionPipeline';
import { tagInBatches, type IngestSourceType } from './tagger';
import { uploadDilrImage } from './uploader';
import { describeDilrImage } from './visionTagger';
import { resolveAnswerWithConfidence } from './answerResolver';

type Section = 'quant' | 'dilr' | 'varc';

interface IngestOptions {
  file?: string;
  dir?: string;
  section: Section | 'auto';
  sourceType: IngestSourceType;
  sourceLabel?: string;
  examYear?: number;
  slot?: number;
  dryRun: boolean;
  limitPages?: number;
  skipTagging: boolean;
  skipEmbedding: boolean;
  skipVision: boolean;
  strictGate: boolean;
}

interface CandidateQuestion {
  text: string;
  options: string[];
  textHash: string;
  questionNo: number | null;
  subtype: string;
  extractionConfidence: number;
  pageNumber: number;
  sourceStage: 'deterministic' | 'external';
  sectionHint?: Section;
  passageText?: string | null;
  setText?: string | null;
  rawBlock?: string;
}

interface PageVisionMeta {
  setText: string;
  imageType: 'table' | 'bar_chart' | 'line_chart' | 'pie_chart' | 'venn' | 'network' | 'unknown';
  shouldSkip: boolean;
  imageUrl: string | null;
}

interface QualityGateResult {
  pass: boolean;
  issues: Array<{
    severity: 'warning' | 'error';
    code: string;
    detail: string;
    meta?: Record<string, unknown>;
  }>;
  summary: {
    totalPages: number;
    totalQuestions: number;
    lowConfidencePages: number;
    avgPageConfidence: number;
    avgOptionCompleteness: number;
  };
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

function dedupeByHash(items: Array<Omit<CandidateQuestion, 'textHash'>>): CandidateQuestion[] {
  const seen = new Set<string>();
  const out: CandidateQuestion[] = [];

  for (const item of items) {
    const text = item.text.trim();
    if (text.length < 20) continue;

    const textHash = createHash('md5').update(text).digest('hex');
    if (seen.has(textHash)) continue;
    seen.add(textHash);

    out.push({
      ...item,
      text,
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

function parseYearSlotFromName(filePath: string) {
  const base = path.basename(filePath).toLowerCase();
  const yearMatch = base.match(/\b(20\d{2})\b/);
  const slotMatch = base.match(/slot\s*[-_]?\s*(\d)/i);

  return {
    examYear: yearMatch ? Number(yearMatch[1]) : null,
    slot: slotMatch ? Number(slotMatch[1]) : null,
  };
}

function qualityGate(pages: ParsedPage[]): QualityGateResult {
  const totalPages = pages.length;
  const totalQuestions = pages.reduce((acc, page) => acc + page.questions.length, 0);
  const lowConfidencePages = pages.filter((page) => page.confidence < 0.55).length;
  const avgPageConfidence = totalPages === 0
    ? 0
    : pages.reduce((acc, page) => acc + page.confidence, 0) / totalPages;

  const avgOptionCompleteness = totalPages === 0
    ? 0
    : pages.reduce((acc, page) => acc + page.signals.optionCompleteness, 0) / totalPages;

  const issues: QualityGateResult['issues'] = [];

  if (totalQuestions === 0) {
    issues.push({
      severity: 'error',
      code: 'NO_QUESTIONS',
      detail: 'No extractable questions were detected from the file.',
    });
  }

  if (avgPageConfidence < 0.58) {
    issues.push({
      severity: 'error',
      code: 'LOW_PAGE_CONFIDENCE',
      detail: `Average page confidence ${avgPageConfidence.toFixed(2)} is below threshold 0.58.`,
      meta: { avgPageConfidence },
    });
  }

  if (avgOptionCompleteness < 0.65) {
    issues.push({
      severity: 'error',
      code: 'LOW_OPTION_COMPLETENESS',
      detail: `Average option completeness ${avgOptionCompleteness.toFixed(2)} is below threshold 0.65.`,
      meta: { avgOptionCompleteness },
    });
  }

  if (lowConfidencePages > Math.ceil(totalPages * 0.35)) {
    issues.push({
      severity: 'warning',
      code: 'HIGH_LOW_CONFIDENCE_PAGES',
      detail: `Low-confidence pages ${lowConfidencePages}/${totalPages} exceed 35%.`,
      meta: { lowConfidencePages, totalPages },
    });
  }

  return {
    pass: !issues.some((issue) => issue.severity === 'error'),
    issues,
    summary: {
      totalPages,
      totalQuestions,
      lowConfidencePages,
      avgPageConfidence,
      avgOptionCompleteness,
    },
  };
}

async function createRun(filePath: string, dryRun: boolean) {
  if (dryRun) return null;
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from('ingestion_runs')
    .insert({
      source_file: filePath,
      status: 'running',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw error;
  return String(data.id);
}

async function updateRun(runId: string | null, payload: Record<string, unknown>) {
  if (!runId) return;
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from('ingestion_runs')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', runId);
  if (error) throw error;
}

async function saveRunIssues(runId: string | null, fileName: string, issues: QualityGateResult['issues']) {
  if (!runId || issues.length === 0) return;
  const supabase = createAdminSupabase();
  const rows = issues.map((issue) => ({
    run_id: runId,
    file_name: fileName,
    severity: issue.severity,
    code: issue.code,
    detail: issue.detail,
    meta: issue.meta ?? null,
  }));

  const { error } = await supabase.from('ingestion_issues').insert(rows);
  if (error) throw error;
}

async function ingestOneFile(filePath: string, opts: Omit<IngestOptions, 'file' | 'dir'>) {
  const supabase = createAdminSupabase();
  const checkpoint = await getCheckpoint(filePath);
  const startPage = Number(checkpoint?.last_processed_page ?? 0);
  const source = opts.sourceLabel?.trim() || path.basename(filePath, path.extname(filePath));
  const derivedMeta = parseYearSlotFromName(filePath);
  const runId = await createRun(filePath, opts.dryRun);

  const extraction = await runExtractionPipeline(filePath);
  const effectivePages = typeof opts.limitPages === 'number'
    ? extraction.pages.slice(0, opts.limitPages)
    : extraction.pages;

  const gate = qualityGate(effectivePages);
  await saveRunIssues(runId, filePath, gate.issues);
  await updateRun(runId, {
    source_file: filePath,
    total_pages: effectivePages.length,
    pages_processed: 0,
    questions_extracted: gate.summary.totalQuestions,
    quality_summary: gate.summary,
  });

  if (opts.strictGate && !gate.pass) {
    await updateRun(runId, { status: 'gated' });
    throw new Error(`Quality gate failed for ${path.basename(filePath)}. Resolve ingestion issues before publishing.`);
  }

  const extractedImages: ExtractedImage[] = opts.dryRun || opts.skipVision ? [] : await extractImagesFromPdf(filePath);
  const imagesByPage = new Map<number, ExtractedImage[]>();
  for (const image of extractedImages) {
    const existing = imagesByPage.get(image.page) ?? [];
    existing.push(image);
    imagesByPage.set(image.page, existing);
  }

  const pageVisionCache = new Map<number, PageVisionMeta>();
  const pageGroupId = new Map<string, string>();

  async function getVisionMeta(pageNumber: number): Promise<PageVisionMeta | null> {
    if (opts.dryRun || opts.skipVision) return null;
    const cached = pageVisionCache.get(pageNumber);
    if (cached) return cached;

    const images = imagesByPage.get(pageNumber);
    if (!images || images.length === 0) return null;

    const primary = images[0];
    const vision = await describeDilrImage(primary.imagePath);
    let imageUrl: string | null = null;

    if (!vision.shouldSkip) {
      const remotePath = `ingest/${source}/page-${pageNumber}-${Date.now()}.png`;
      imageUrl = await uploadDilrImage(primary.imagePath, remotePath);
    }

    const meta: PageVisionMeta = {
      setText: vision.setText,
      imageType: vision.imageType,
      shouldSkip: vision.shouldSkip,
      imageUrl,
    };

    pageVisionCache.set(pageNumber, meta);
    return meta;
  }

  await upsertCheckpoint(filePath, {
    status: 'running',
    total_pages: effectivePages.length,
  });

  let inserted = Number(checkpoint?.questions_ingested ?? 0);
  let sinceLastCheckpoint = 0;

  for (let index = startPage; index < effectivePages.length; index += 1) {
    const page = effectivePages[index];

    const candidates = dedupeByHash(page.questions.map((q) => ({
      text: q.text,
      options: q.options,
      questionNo: q.questionNo,
      subtype: q.subtype,
      extractionConfidence: q.extractionConfidence,
      sourceStage: page.sourceStage,
      pageNumber: page.pageNumber,
      sectionHint: q.sectionHint,
      passageText: q.passageText,
      setText: q.setText,
      rawBlock: q.rawBlock,
    })));

    if (candidates.length === 0) {
      await upsertCheckpoint(filePath, {
        status: 'running',
        last_processed_page: index + 1,
        questions_ingested: inserted,
      });
      await updateRun(runId, {
        pages_processed: index + 1,
      });
      continue;
    }

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
      await updateRun(runId, {
        pages_processed: index + 1,
      });
      continue;
    }

    if (opts.dryRun) {
      inserted += toInsert.length;
      sinceLastCheckpoint += toInsert.length;
      continue;
    }

    const tagged = opts.skipTagging
      ? toInsert.map((q) => ({
        section: q.sectionHint ?? 'quant',
        topic: 'unclassified',
        subtype: q.subtype,
        difficulty: 'medium' as const,
        type: opts.sourceType,
        correct_answer: null,
        explanation: null,
      }))
      : await tagInBatches(toInsert.map((q) => q.text), opts.sourceType, 10, 2000);

    const embeddings = opts.skipEmbedding
      ? toInsert.map(() => null)
      : await embedInBatches(toInsert.map((q) => q.text), 32);

    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < toInsert.length; i += 1) {
      const question = toInsert[i];
      const taggedItem = tagged[i];
      const section = opts.section === 'auto' ? (taggedItem?.section ?? question.sectionHint ?? 'quant') : opts.section;

      let setId: string | null = null;
      let setText: string | null = section === 'dilr' ? (question.setText ?? null) : null;
      let setImageUrl: string | null = null;
      let setImageType: string | null = null;
      let groupId: string | null = null;

      if (section === 'dilr' || section === 'varc') {
        const groupKey = `${section}:${question.pageNumber}`;
        const existingGroupId = pageGroupId.get(groupKey);
        if (existingGroupId) {
          groupId = existingGroupId;
        } else {
          const candidateGroupId = randomUUID();
          groupId = candidateGroupId;
          pageGroupId.set(groupKey, candidateGroupId);

          const groupText = section === 'dilr'
            ? (question.setText ?? null)
            : (question.passageText ?? null);

          const { error: groupError } = await supabase.from('question_groups').insert({
            id: candidateGroupId,
            section,
            group_type: section === 'dilr' ? 'dilr_set' : 'rc_passage',
            group_text: groupText,
            source_page: question.pageNumber,
            ingestion_run_id: runId,
          });
          if (groupError) throw groupError;
        }
      }

      if (section === 'dilr') {
        const visionMeta = await getVisionMeta(question.pageNumber);
        if (visionMeta?.shouldSkip) {
          continue;
        }

        if (visionMeta) {
          setText = visionMeta.setText || setText;
          setImageUrl = visionMeta.imageUrl;
          setImageType = visionMeta.imageType;
        }

        setId = groupId;
      }

      const answerFromKey = question.questionNo ? extraction.answerKeyByQuestion.get(question.questionNo) ?? null : null;
      let resolvedAnswer = answerFromKey ?? taggedItem?.correct_answer ?? null;
      let resolvedExplanation = taggedItem?.explanation ?? null;
      let answerConfidence = answerFromKey ? 0.98 : 0.6;

      if (!resolvedAnswer) {
        const solved = await resolveAnswerWithConfidence({
          questionText: question.text,
          options: question.options,
        });
        resolvedAnswer = solved.correctAnswer;
        answerConfidence = solved.confidence;
        if (!resolvedExplanation && solved.explanation) {
          resolvedExplanation = solved.explanation;
        }
      }

      const minAnswerConfidence = env.MIN_ANSWER_CONFIDENCE ?? 0.85;
      const minExtractionConfidence = env.MIN_EXTRACTION_CONFIDENCE ?? 0.6;

      const isVerified =
        Boolean(resolvedAnswer) &&
        answerConfidence >= minAnswerConfidence &&
        question.extractionConfidence >= minExtractionConfidence;

      rows.push({
        text: question.text,
        options: question.options,
        correct_answer: resolvedAnswer,
        explanation: resolvedExplanation,
        section,
        topic: taggedItem?.topic ?? 'unclassified',
        subtype: taggedItem?.subtype ?? question.subtype ?? 'generic',
        difficulty: taggedItem?.difficulty ?? 'medium',
        source,
        type: opts.sourceType,
        origin: 'corpus',
        question_no: question.questionNo,
        exam_year: opts.examYear ?? derivedMeta.examYear,
        slot: opts.slot ?? derivedMeta.slot,
        set_id: setId,
        set_text: setText,
        set_image_url: setImageUrl,
        set_image_type: setImageType,
        group_id: groupId,
        passage_text: section === 'varc' ? (question.passageText ?? null) : null,
        embedding: embeddings[i] ?? null,
        text_hash: question.textHash,
        answer_confidence: answerConfidence,
        extraction_confidence: question.extractionConfidence,
        is_verified: isVerified,
        source_page: question.pageNumber,
        source_bbox_json: {
          source_stage: question.sourceStage,
          raw_block: question.rawBlock ?? null,
          page_confidence: page.confidence,
          signals: page.signals,
        },
        ingestion_run_id: runId,
      });
    }

    if (rows.length > 0) {
      const { error } = await supabase.from('questions').insert(rows);
      if (error) throw error;
      inserted += rows.length;
      sinceLastCheckpoint += rows.length;
    }

    await updateRun(runId, {
      pages_processed: index + 1,
      questions_published: inserted,
    });

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

  if (!opts.dryRun) {
    await updateRun(runId, {
      status: gate.pass ? 'approved' : 'gated',
      completed_at: new Date().toISOString(),
      pages_processed: effectivePages.length,
      questions_published: inserted,
      quality_summary: gate.summary,
    });
  }

  return { filePath, inserted, runId, quality: gate.summary };
}

function parseCli(): IngestOptions {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', short: 'f' },
      dir: { type: 'string', short: 'd' },
      section: { type: 'string' },
      'source-type': { type: 'string' },
      source: { type: 'string' },
      'exam-year': { type: 'string' },
      slot: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'limit-pages': { type: 'string' },
      'skip-tagging': { type: 'boolean' },
      'skip-embedding': { type: 'boolean' },
      'skip-vision': { type: 'boolean' },
      'strict-gate': { type: 'boolean' },
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

  const examYear = values['exam-year'] ? Number(values['exam-year']) : undefined;
  const slot = values.slot ? Number(values.slot) : undefined;

  return {
    file: values.file,
    dir: values.dir,
    section: sectionArg as Section | 'auto',
    sourceType: sourceTypeArg as IngestSourceType,
    sourceLabel: values.source,
    examYear: Number.isFinite(examYear) ? examYear : undefined,
    slot: Number.isFinite(slot) ? slot : undefined,
    dryRun: Boolean(values['dry-run']),
    limitPages,
    skipTagging: Boolean(values['skip-tagging']),
    skipEmbedding: Boolean(values['skip-embedding']),
    skipVision: Boolean(values['skip-vision']),
    strictGate: values['strict-gate'] ?? true,
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
      examYear: opts.examYear,
      slot: opts.slot,
      dryRun: opts.dryRun,
      limitPages: opts.limitPages,
      skipTagging: opts.skipTagging,
      skipEmbedding: opts.skipEmbedding,
      skipVision: opts.skipVision,
      strictGate: opts.strictGate,
    });

    totalInserted += result.inserted;
    console.log(`[ingest] ${path.basename(result.filePath)} | run=${result.runId ?? 'dry-run'} | running_total=${totalInserted}`);
  }

  console.log(`Ingestion complete. Total inserted (or parsed in dry-run): ${totalInserted}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
