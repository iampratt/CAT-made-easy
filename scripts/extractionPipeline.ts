import path from 'node:path';
import { parsePdfPages } from './pdfParser';
import { splitQuantVarcQuestions, type ParsedQuestionChunk } from './questionSplitter';
import { parsePdfWithExternalService } from './externalParser';

export type Section = 'quant' | 'dilr' | 'varc';

export interface AnswerKeyEntry {
  section: Section | null;
  questionNo: number;
  answer: string;
}

export interface ParsedQuestion {
  pageNumber: number;
  questionNo: number | null;
  text: string;
  options: string[];
  sectionHint?: Section;
  subtype: string;
  extractionConfidence: number;
  rawBlock?: string;
  passageText?: string | null;
  setText?: string | null;
}

export interface ParsedPage {
  pageNumber: number;
  sourceStage: 'deterministic' | 'external';
  confidence: number;
  signals: {
    questionStarts: number;
    parsedQuestions: number;
    optionCompleteness: number;
    hasAnswerKeyPattern: boolean;
  };
  rawText: string;
  questions: ParsedQuestion[];
  answerKeys: AnswerKeyEntry[];
}

export interface ExtractionOutput {
  filePath: string;
  pages: ParsedPage[];
  answerKeyByQuestion: Map<number, string>;
  summary: {
    totalPages: number;
    totalQuestions: number;
    lowConfidencePages: number;
    answerKeysFound: number;
  };
}

function normalizeAnswer(value: string): string | null {
  const clean = value.trim().toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(clean)) return clean;
  const first = clean.charAt(0);
  if (['A', 'B', 'C', 'D'].includes(first)) return first;
  return null;
}

export function detectAnswerKeys(pageText: string): AnswerKeyEntry[] {
  const text = pageText.replace(/\s+/g, ' ').trim();
  if (!/answer\s*keys?/i.test(text)) return [];

  const entries: AnswerKeyEntry[] = [];
  const match = text.match(/question\s*no\.?\s*answer([\s\S]*)/i);
  const candidate = match ? match[1] : text;

  const pairRegex = /(\d{1,3})\s+([A-D]|[1-4])/gi;
  for (const pair of candidate.matchAll(pairRegex)) {
    const questionNo = Number(pair[1]);
    if (!Number.isFinite(questionNo)) continue;

    const mapped = normalizeAnswer(pair[2]);
    if (!mapped) continue;

    entries.push({
      section: null,
      questionNo,
      answer: mapped,
    });
  }

  return entries;
}

function computePageSignals(pageText: string, parsed: ParsedQuestionChunk[]) {
  const questionStarts = Array.from(pageText.matchAll(/(?:^|\n)\s*(?:Q(?:uestion)?\s*)?\d{1,3}[\).:-]\s+/gi)).length;

  const optionCompleteness = parsed.length === 0
    ? 0
    : parsed
      .map((q) => q.options.filter((o) => !/not found/i.test(o)).length / 4)
      .reduce((acc, cur) => acc + cur, 0) / parsed.length;

  return {
    questionStarts,
    parsedQuestions: parsed.length,
    optionCompleteness,
    hasAnswerKeyPattern: /answer\s*keys?/i.test(pageText),
  };
}

function computePageConfidence(signals: ReturnType<typeof computePageSignals>) {
  let score = 0.2;
  if (signals.questionStarts > 0) score += 0.25;
  if (signals.parsedQuestions > 0) score += 0.25;
  score += Math.min(0.25, signals.optionCompleteness * 0.25);
  if (signals.hasAnswerKeyPattern) score += 0.05;
  return Math.max(0, Math.min(1, score));
}

function toParsedQuestions(pageNumber: number, chunks: ParsedQuestionChunk[]): ParsedQuestion[] {
  return chunks.map((chunk) => ({
    pageNumber,
    questionNo: chunk.questionNo ?? null,
    text: chunk.text,
    options: chunk.options,
    sectionHint: chunk.sectionHint,
    subtype: chunk.subtype ?? 'generic',
    extractionConfidence: chunk.extractionConfidence ?? 0.5,
    rawBlock: chunk.rawBlock,
    passageText: chunk.passageText,
    setText: chunk.setText,
  }));
}

function mergeAnswerKey(entries: AnswerKeyEntry[]) {
  const out = new Map<number, string>();
  for (const entry of entries) {
    if (!out.has(entry.questionNo)) {
      out.set(entry.questionNo, entry.answer);
    }
  }
  return out;
}

export async function runExtractionPipeline(filePath: string): Promise<ExtractionOutput> {
  const pages = await parsePdfPages(filePath);
  const external = await parsePdfWithExternalService(filePath);

  const parsedPages: ParsedPage[] = [];
  const allAnswerKeys: AnswerKeyEntry[] = [];

  for (const page of pages) {
    const deterministicChunks = splitQuantVarcQuestions(page.text);
    const deterministicSignals = computePageSignals(page.text, deterministicChunks);
    let confidence = computePageConfidence(deterministicSignals);
    let sourceStage: ParsedPage['sourceStage'] = 'deterministic';
    let rawText = page.text;
    let parsedQuestions = toParsedQuestions(page.pageNumber, deterministicChunks);

    const externalPage = external?.get(page.pageNumber);
    if (confidence < 0.55 && externalPage) {
      const externalChunks = splitQuantVarcQuestions(externalPage.text);
      const externalSignals = computePageSignals(externalPage.text, externalChunks);
      const externalConfidence = computePageConfidence(externalSignals);

      if (externalConfidence > confidence) {
        sourceStage = 'external';
        confidence = externalConfidence;
        rawText = externalPage.text;
        parsedQuestions = toParsedQuestions(page.pageNumber, externalChunks);
      }
    }

    const answerKeys = detectAnswerKeys(rawText);
    allAnswerKeys.push(...answerKeys);

    parsedPages.push({
      pageNumber: page.pageNumber,
      sourceStage,
      confidence,
      signals: computePageSignals(rawText, parsedQuestions),
      rawText,
      questions: parsedQuestions,
      answerKeys,
    });
  }

  const totalQuestions = parsedPages.reduce((acc, page) => acc + page.questions.length, 0);
  const lowConfidencePages = parsedPages.filter((page) => page.confidence < 0.55).length;

  return {
    filePath: path.resolve(filePath),
    pages: parsedPages,
    answerKeyByQuestion: mergeAnswerKey(allAnswerKeys),
    summary: {
      totalPages: parsedPages.length,
      totalQuestions,
      lowConfidencePages,
      answerKeysFound: allAnswerKeys.length,
    },
  };
}
