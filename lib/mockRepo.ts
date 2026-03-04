import { randomUUID } from 'node:crypto';
import { createAdminSupabase } from '@/lib/supabase/admin';
import type { Question, Section } from '@/types/question';
import { scoreMock } from '@/lib/scoring';

const fallbackQuestion = (section: Section, topic = 'mixed'): Question => ({
  id: randomUUID(),
  text: `Sample ${section.toUpperCase()} question on ${topic}.`,
  options: ['A) Option 1', 'B) Option 2', 'C) Option 3', 'D) Option 4'],
  correctAnswer: 'A',
  explanation: 'Placeholder explanation.',
  section,
  topic,
  difficulty: 'medium',
  type: 'generated',
  setText: section === 'dilr' ? '| Team | Score |\n|---|---|\n| A | 42 |\n| B | 36 |' : null,
  setImageUrl: null,
  passageText: section === 'varc' ? 'Placeholder RC passage for demo rendering.' : null,
});

export async function createMock(args: { userId: string; type: 'full' | 'section' | 'topic'; section: Section; topic?: string; count: number }) {
  const supabase = createAdminSupabase();
  const questions: Question[] = Array.from({ length: args.count }).map(() => fallbackQuestion(args.section, args.topic));

  const payload = {
    user_id: args.userId,
    type: args.type,
    config: { type: args.type, section: args.section, topic: args.topic, count: args.count },
    question_ids: questions.map((q) => q.id),
    question_payload: questions,
  };

  const { data, error } = await supabase.from('mocks').insert(payload).select('id').single();
  if (error || !data) throw error ?? new Error('Unable to create mock');
  return { mockId: data.id };
}

export async function submitMock(args: { mockId: string; answers: Record<string, string> }) {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.from('mocks').select('question_payload').eq('id', args.mockId).single();
  if (error || !data?.question_payload) throw error ?? new Error('Mock not found');

  const score = scoreMock(data.question_payload, args.answers);
  const { error: updateError } = await supabase
    .from('mocks')
    .update({ score, completed_at: new Date().toISOString() })
    .eq('id', args.mockId);

  if (updateError) throw updateError;
  return score;
}

export async function saveMockProgress(args: { mockId: string; answers: Record<string, string> }) {
  const supabase = createAdminSupabase();
  const { error } = await supabase.from('mocks').update({ progress: args.answers }).eq('id', args.mockId);
  if (error) throw error;
}
