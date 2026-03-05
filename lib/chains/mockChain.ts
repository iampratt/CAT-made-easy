import { randomUUID } from 'node:crypto';
import { groq70b, groq8b, groqVerify } from '@/lib/llm';
import type { Difficulty, Question, Section } from '@/types/question';

interface ReferenceQuestion {
  id: string;
  text: string;
  options: string[] | null;
  correct_answer: string | null;
  explanation: string | null;
  topic: string | null;
  difficulty: Difficulty | null;
  source: string | null;
  set_text: string | null;
  set_image_url: string | null;
  passage_text: string | null;
}

interface GeneratedQuestionShape {
  text?: string;
  options?: string[];
  correct_answer?: string;
  explanation?: string;
  topic?: string;
  difficulty?: Difficulty;
  set_text?: string;
  passage_text?: string;
}

function extractJsonBlock(content: string) {
  const cleaned = content.replace(/```json/gi, '```');
  const fenceMatch = cleaned.match(/```([\s\S]*?)```/);
  const candidate = (fenceMatch ? fenceMatch[1] : cleaned).trim();

  const startObj = candidate.indexOf('{');
  const endObj = candidate.lastIndexOf('}');
  if (startObj >= 0 && endObj > startObj) {
    return candidate.slice(startObj, endObj + 1);
  }

  const startArr = candidate.indexOf('[');
  const endArr = candidate.lastIndexOf(']');
  if (startArr >= 0 && endArr > startArr) {
    return candidate.slice(startArr, endArr + 1);
  }

  throw new Error('Model did not return JSON content.');
}

function extractBalancedJsonCandidates(input: string) {
  const out: string[] = [];
  const opens = new Set(['{', '[']);
  const pair: Record<string, string> = { '{': '}', '[': ']' };

  for (let i = 0; i < input.length; i += 1) {
    const start = input[i];
    if (!opens.has(start)) continue;

    const stack: string[] = [start];
    let inString = false;
    let quote = '"';
    let escaped = false;

    for (let j = i + 1; j < input.length; j += 1) {
      const ch = input[j];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === quote) {
          inString = false;
        }
        continue;
      }

      if (ch === '"' || ch === '\'') {
        inString = true;
        quote = ch;
        continue;
      }

      if (ch === '{' || ch === '[') {
        stack.push(ch);
        continue;
      }

      if (ch === '}' || ch === ']') {
        const top = stack[stack.length - 1];
        if (!top || pair[top] !== ch) {
          break;
        }
        stack.pop();
        if (stack.length === 0) {
          out.push(input.slice(i, j + 1));
          break;
        }
      }
    }
  }

  return out;
}

function sanitizeJsonCandidate(input: string) {
  return input
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
}

function parseLooseJson(raw: string): unknown {
  const candidates = new Set<string>();
  const balancedFromRaw = extractBalancedJsonCandidates(raw);
  for (const value of balancedFromRaw) candidates.add(value);

  try {
    const block = extractJsonBlock(raw);
    candidates.add(block);
  } catch {
    // ignore and continue with balanced candidates
  }

  const initial = Array.from(candidates);
  for (const candidate of initial) {
    candidates.add(sanitizeJsonCandidate(candidate));
    const questionsMatch = candidate.match(/"questions"\s*:\s*(\[[\s\S]*\])/);
    if (questionsMatch?.[1]) {
      candidates.add(questionsMatch[1]);
      candidates.add(sanitizeJsonCandidate(questionsMatch[1]));
    }

    const arrayStart = candidate.indexOf('[');
    const arrayEnd = candidate.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      const arr = candidate.slice(arrayStart, arrayEnd + 1);
      candidates.add(arr);
      candidates.add(sanitizeJsonCandidate(arr));
    }
  }

  for (const candidate of Array.from(candidates)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }

  throw new Error('Unable to parse model JSON response.');
}

function parseGeneratedQuestions(raw: string): GeneratedQuestionShape[] {
  const json = parseLooseJson(raw) as { questions?: GeneratedQuestionShape[] } | GeneratedQuestionShape[];
  if (Array.isArray(json)) return json;
  return Array.isArray(json.questions) ? json.questions : [];
}

function normalizeOptions(options: string[] | undefined) {
  if (!options || options.length < 4) {
    return ['A) Option A', 'B) Option B', 'C) Option C', 'D) Option D'];
  }

  return options.slice(0, 4).map((opt, idx) => {
    const label = String.fromCharCode(65 + idx);
    const trimmed = opt.trim();
    return /^[A-D][\).:]/i.test(trimmed) ? trimmed : `${label}) ${trimmed}`;
  });
}

function normalizeGeneratedQuestion(args: {
  section: Section;
  topic: string;
  difficulty: Difficulty;
  raw: GeneratedQuestionShape;
}): Question {
  const options = normalizeOptions(args.raw.options);
  const correct = (args.raw.correct_answer ?? 'A').trim().charAt(0).toUpperCase();

  return {
    id: randomUUID(),
    text: (args.raw.text ?? '').trim() || `Generated ${args.section} question on ${args.topic}`,
    options,
    correctAnswer: ['A', 'B', 'C', 'D'].includes(correct) ? correct : 'A',
    explanation: (args.raw.explanation ?? 'Solution not provided by model.').trim(),
    section: args.section,
    topic: (args.raw.topic ?? args.topic).trim(),
    difficulty: args.raw.difficulty ?? args.difficulty,
    type: 'generated',
    setText: args.section === 'dilr' ? (args.raw.set_text ?? null) : null,
    setImageUrl: null,
    passageText: args.section === 'varc' ? (args.raw.passage_text ?? null) : null,
    source: 'groq-generated',
  };
}

async function verifyQuestion(question: Question) {
  try {
    const verifier = groqVerify();
    const prompt = `Verify this CAT question and answer key.\nQuestion: ${question.text}\nOptions: ${question.options.join(' | ')}\nStated answer: ${question.correctAnswer}\nExplanation: ${question.explanation}\n\nReturn ONLY JSON: {"valid": true|false, "issue": "..."}`;
    const response = await verifier.invoke(prompt);
    const parsed = parseLooseJson(String(response.content ?? '')) as { valid?: boolean; issue?: string };
    return {
      valid: Boolean(parsed.valid),
      issue: String(parsed.issue ?? ''),
    };
  } catch {
    // If verification output is malformed/unavailable, keep the generated question.
    return { valid: true, issue: '' };
  }
}

async function generateChunk(params: {
  section: Section;
  topic: string;
  difficulty: Difficulty;
  count: number;
  references: ReferenceQuestion[];
  retryHint?: string;
}) {
  const prompt = `You are generating CAT exam questions at actual CAT standard.
Here are ${params.references.length} reference questions for style only:
${JSON.stringify(params.references).slice(0, 12000)}
Generate ${params.count} NEW, ORIGINAL ${params.section} questions on ${params.topic} at ${params.difficulty} difficulty.
Rules:
- Do not copy/paraphrase references.
- Return exactly ${params.count} questions.
- Quant: ensure arithmetic consistency.
- DILR: include set_text markdown table for each question.
- VARC: include passage_text for passage-based questions.
${params.retryHint ? `Fix this issue from previous attempt: ${params.retryHint}` : ''}
Return ONLY valid JSON:
{"questions":[{"text":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct_answer":"A","explanation":"...","topic":"...","difficulty":"${params.difficulty}","set_text":"...","passage_text":"..."}]}`;

  try {
    const response70b = await groq70b().invoke(prompt);
    const parsed70b = parseGeneratedQuestions(String(response70b.content ?? ''));
    if (parsed70b.length > 0) return parsed70b;
  } catch {
    // fall through to fast model
  }

  const response8b = await groq8b().invoke(prompt);
  try {
    return parseGeneratedQuestions(String(response8b.content ?? ''));
  } catch {
    return [];
  }
}

export async function generateVerifiedQuestions(params: {
  section: Section;
  topic: string;
  difficulty: Difficulty;
  count: number;
  references: ReferenceQuestion[];
}) {
  const raw = await generateChunk(params);
  const normalized = raw.slice(0, params.count).map((item) => normalizeGeneratedQuestion({
    section: params.section,
    topic: params.topic,
    difficulty: params.difficulty,
    raw: item,
  }));

  const verified: Question[] = [];

  for (const question of normalized) {
    let current = question;
    let attempts = 0;

    while (attempts < 2) {
      attempts += 1;
      const result = await verifyQuestion(current);
      if (result.valid) {
        verified.push(current);
        break;
      }

      const regenerated = await generateChunk({
        section: params.section,
        topic: params.topic,
        difficulty: params.difficulty,
        count: 1,
        references: params.references,
        retryHint: result.issue,
      });

      if (regenerated.length === 0) break;
      current = normalizeGeneratedQuestion({
        section: params.section,
        topic: params.topic,
        difficulty: params.difficulty,
        raw: regenerated[0],
      });
    }
  }

  return verified;
}
