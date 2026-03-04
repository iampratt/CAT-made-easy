import { ChatGroq } from '@langchain/groq';
import { env } from '@/lib/env';

function client(model: string, temperature = 0.2) {
  if (!env.GROQ_API_KEY) {
    throw new Error('Missing GROQ_API_KEY');
  }
  return new ChatGroq({ apiKey: env.GROQ_API_KEY, model, temperature });
}

export const groq70b = () => client(env.GROQ_GENERATION_MODEL ?? 'llama-3.3-70b-versatile', 0.4);
export const groq8b = () => client(env.GROQ_FAST_MODEL ?? 'llama-3.1-8b-instant', 0.2);
export const groqVerify = () => client(env.GROQ_VERIFY_MODEL ?? 'llama-3.1-8b-instant', 0.1);
