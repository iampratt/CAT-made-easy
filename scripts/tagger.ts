import { groq8b } from '@/lib/llm';

export async function tagBatch(questions: string[]) {
  const model = groq8b();
  const prompt = `Tag these CAT questions (section/topic/difficulty/type/correct_answer/explanation). Return JSON array.\n${questions.join('\n---\n')}`;
  const response = await model.invoke(prompt);
  return String(response.content);
}
