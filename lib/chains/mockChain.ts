import type { Section } from '@/types/question';
import { getQuestionsForMock } from '@/lib/supabase/queries';
import { groq70b, groqVerify } from '@/lib/llm';

export async function generateSectionQuestions(params: {
  section: Section;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  count: number;
  excludeIds: string[];
}) {
  const references = await getQuestionsForMock({
    section: params.section,
    topic: params.topic,
    difficulty: params.difficulty,
    count: Math.max(10, params.count),
    excludeIds: params.excludeIds,
  });

  const model = groq70b();
  const verifier = groqVerify();

  const prompt = `You are generating CAT questions.\nGenerate ${params.count} NEW ${params.section} questions on ${params.topic} at ${params.difficulty}.\nReferences:\n${JSON.stringify(references).slice(0, 7000)}\nReturn JSON: {"questions": [...]}`;
  const generated = await model.invoke(prompt);

  const verify = await verifier.invoke(`Validate JSON shape and key correctness.\n${generated.content}`);
  return { generated: generated.content, verify: verify.content };
}
