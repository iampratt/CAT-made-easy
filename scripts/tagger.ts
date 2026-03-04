import { setTimeout as delay } from 'node:timers/promises';
import { groq8b } from '@/lib/llm';

export type IngestSourceType = 'past_paper' | 'book';

export interface TaggedQuestion {
  section: 'quant' | 'dilr' | 'varc';
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  type: IngestSourceType;
  correct_answer: string | null;
  explanation: string | null;
}

function extractJson(content: string) {
  const cleaned = content.replace(/```json/gi, '```');
  const fenced = cleaned.match(/```([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : cleaned).trim();
  const startArr = candidate.indexOf('[');
  const endArr = candidate.lastIndexOf(']');
  if (startArr >= 0 && endArr > startArr) return candidate.slice(startArr, endArr + 1);

  const startObj = candidate.indexOf('{');
  const endObj = candidate.lastIndexOf('}');
  if (startObj >= 0 && endObj > startObj) return candidate.slice(startObj, endObj + 1);

  throw new Error('Tagger did not return JSON.');
}

function normalizeSection(raw: string): 'quant' | 'dilr' | 'varc' {
  const value = raw.toLowerCase();
  if (value.includes('varc') || value.includes('verbal')) return 'varc';
  if (value.includes('dilr') || value.includes('lrdi') || value.includes('logical')) return 'dilr';
  return 'quant';
}

function normalizeDifficulty(raw: string): 'easy' | 'medium' | 'hard' {
  const value = raw.toLowerCase();
  if (value.includes('hard')) return 'hard';
  if (value.includes('easy')) return 'easy';
  return 'medium';
}

function fallbackTag(question: string, sourceType: IngestSourceType): TaggedQuestion {
  const lower = question.toLowerCase();
  const section = lower.length > 180 || /passage|author|inference|paragraph/.test(lower)
    ? 'varc'
    : /table|chart|arrangement|seating|distribution/.test(lower)
      ? 'dilr'
      : 'quant';

  return {
    section,
    topic: 'unclassified',
    difficulty: 'medium',
    type: sourceType,
    correct_answer: null,
    explanation: null,
  };
}

export async function tagBatch(questions: string[], sourceType: IngestSourceType): Promise<TaggedQuestion[]> {
  if (questions.length === 0) return [];

  const model = groq8b();
  const prompt = `You are tagging CAT exam questions.\nCAT DIFFICULTY CALIBRATION:\nEASY: 90th percentile under 60 sec.\nMEDIUM: 95th percentile 60-120 sec.\nHARD: 99th percentile 2-3 minutes or skip.\n\nFor each question return JSON with keys: section, topic, difficulty, type, correct_answer, explanation.\n- section in [quant,dilr,varc]\n- difficulty in [easy,medium,hard]\n- type must be \"${sourceType}\"\n- correct_answer null if unknown\n- explanation null if unknown\nReturn ONLY JSON array with exactly ${questions.length} objects in same order.\n\nQuestions:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n\n')}`;

  try {
    const response = await model.invoke(prompt);
    const raw = String(response.content ?? '');
    const parsed = JSON.parse(extractJson(raw)) as Array<Record<string, unknown>>;

    const normalized = parsed.map((item) => ({
      section: normalizeSection(String(item.section ?? 'quant')),
      topic: String(item.topic ?? 'unclassified').trim() || 'unclassified',
      difficulty: normalizeDifficulty(String(item.difficulty ?? 'medium')),
      type: sourceType,
      correct_answer: item.correct_answer ? String(item.correct_answer).trim().slice(0, 1).toUpperCase() : null,
      explanation: item.explanation ? String(item.explanation).trim() : null,
    })) as TaggedQuestion[];

    if (normalized.length !== questions.length) {
      throw new Error(`Tagger returned ${normalized.length} objects for ${questions.length} questions`);
    }

    return normalized;
  } catch {
    return questions.map((q) => fallbackTag(q, sourceType));
  }
}

export async function tagInBatches(questions: string[], sourceType: IngestSourceType, batchSize = 10, delayMs = 2000) {
  const out: TaggedQuestion[] = [];

  for (let i = 0; i < questions.length; i += batchSize) {
    const batch = questions.slice(i, i + batchSize);
    const tagged = await tagBatch(batch, sourceType);
    out.push(...tagged);
    if (i + batchSize < questions.length) {
      await delay(delayMs);
    }
  }

  return out;
}
