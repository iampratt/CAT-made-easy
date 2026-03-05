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
  subtype?: string | null;
  difficulty: Difficulty | null;
  excludeIds: string[];
  count: number;
  requireVerified?: boolean;
  minAnswerConfidence?: number;
  minExtractionConfidence?: number;
}) {
  const supabase = createAdminSupabase();

  const { data, error } = await supabase.rpc('get_questions_for_mock_v2', {
    match_section: args.section,
    match_topic: args.topic,
    match_subtype: args.subtype ?? null,
    match_difficulty: args.difficulty,
    exclude_ids: args.excludeIds,
    require_verified: args.requireVerified ?? true,
    min_answer_confidence: args.minAnswerConfidence ?? 0.85,
    min_extraction_confidence: args.minExtractionConfidence ?? 0.6,
    match_count: args.count,
  });

  if (!error) return data ?? [];

  // Backward compatibility for DBs that haven't run migration 0003 yet.
  const fallback = await supabase.rpc('get_questions_for_mock', {
    match_section: args.section,
    match_topic: args.topic,
    match_difficulty: args.difficulty,
    exclude_ids: args.excludeIds,
    match_count: args.count,
  });

  if (fallback.error) throw fallback.error;
  return fallback.data ?? [];
}
