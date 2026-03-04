import { groq8b } from '@/lib/llm';

export async function describeDilrImage(base64Image: string) {
  const model = groq8b();
  const prompt = `Convert this DILR image to structured text with exact values.\nImage(base64): ${base64Image.slice(0, 120)}...`;
  const response = await model.invoke(prompt);
  return String(response.content);
}
