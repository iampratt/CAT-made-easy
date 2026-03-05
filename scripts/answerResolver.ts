import { groq8b } from '@/lib/llm';

export interface AnswerResolution {
  correctAnswer: string | null;
  explanation: string | null;
  confidence: number;
}

function normalizeAnswer(raw: string | null | undefined) {
  if (!raw) return null;
  const value = raw.trim().toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(value)) return value;
  const first = value.charAt(0);
  if (['A', 'B', 'C', 'D'].includes(first)) return first;
  return null;
}

function extractJson(text: string) {
  const cleaned = text.replace(/```json/gi, '```');
  const fenced = cleaned.match(/```([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : cleaned).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) return candidate.slice(start, end + 1);
  throw new Error('No JSON object in response');
}

export async function resolveAnswerWithConfidence(args: {
  questionText: string;
  options: string[];
}): Promise<AnswerResolution> {
  const model = groq8b();
  const prompt = `Solve this CAT question and return only JSON.\n\nQuestion: ${args.questionText}\nOptions: ${args.options.join(' | ')}\n\nReturn JSON exactly in shape:\n{"correct_answer":"A|B|C|D|null","confidence":0-1,"explanation":"short reason"}`;

  try {
    const response = await model.invoke(prompt);
    const raw = String(response.content ?? '');
    const parsed = JSON.parse(extractJson(raw)) as {
      correct_answer?: string | null;
      confidence?: number;
      explanation?: string;
    };

    const correctAnswer = normalizeAnswer(parsed.correct_answer);
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));

    return {
      correctAnswer,
      confidence,
      explanation: parsed.explanation?.trim() ?? null,
    };
  } catch {
    return {
      correctAnswer: null,
      confidence: 0,
      explanation: null,
    };
  }
}
