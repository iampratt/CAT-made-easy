import type { Section } from '@/types/question';
import { searchPyq } from '@/lib/supabase/queries';

export async function runPyqSearch(query: string, section: Section | null) {
  if (!query.trim()) return [];
  return searchPyq(query, section, 20);
}
