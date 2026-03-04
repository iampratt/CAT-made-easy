import { ChatGroq } from '@langchain/groq';
import { env } from '@/lib/env';

function client(model: string, temperature = 0.2) {
  if (!env.GROQ_API_KEY) {
    throw new Error('Missing GROQ_API_KEY');
  }
  return new ChatGroq({ apiKey: env.GROQ_API_KEY, model, temperature });
}

export const groq70b = () => client('llama-3.3-70b-versatile', 0.4);
export const groq8b = () => client('llama-3.1-8b-instant', 0.2);
export const groqVerify = () => client('gemma2-9b-it', 0.1);
