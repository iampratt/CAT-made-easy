import { z } from 'zod';

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_GENERATION_MODEL: z.string().optional(),
  GROQ_FAST_MODEL: z.string().optional(),
  GROQ_VERIFY_MODEL: z.string().optional(),
  ADMIN_INGEST_SECRET: z.string().optional(),
});

export const env = schema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GROQ_GENERATION_MODEL: process.env.GROQ_GENERATION_MODEL,
  GROQ_FAST_MODEL: process.env.GROQ_FAST_MODEL,
  GROQ_VERIFY_MODEL: process.env.GROQ_VERIFY_MODEL,
  ADMIN_INGEST_SECRET: process.env.ADMIN_INGEST_SECRET,
});

export function assertServerEnv() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase server environment variables.');
  }
}
