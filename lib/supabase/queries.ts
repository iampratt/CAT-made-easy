import { createAdminSupabase } from '@/lib/supabase/admin';
import type { Difficulty, Section } from '@/types/question';

export async function searchPyq(searchQuery: string, filterSection: Section | null, limit = 10) {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc('search_pyq', {
    search_query: searchQuery,
    filter_section: filterSection,
    match_count: limit,
  });
  if (error) throw error;
  return data ?? [];
}

export async function getQuestionsForMock(args: {
  section: Section;
  topic: string | null;
  difficulty: Difficulty | null;
  excludeIds: string[];
  count: number;
}) {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc('get_questions_for_mock', {
    match_section: args.section,
    match_topic: args.topic,
    match_difficulty: args.difficulty,
    exclude_ids: args.excludeIds,
    match_count: args.count,
  });
  if (error) throw error;
  return data ?? [];
}
