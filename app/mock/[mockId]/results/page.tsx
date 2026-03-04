import { createAdminSupabase } from '@/lib/supabase/admin';
import { ScoreCard } from '@/components/ScoreCard';

export default async function MockResultsPage({ params }: { params: Promise<{ mockId: string }> }) {
  const { mockId } = await params;
  const supabase = createAdminSupabase();
  const { data } = await supabase.from('mocks').select('score').eq('id', mockId).single();
  const score = (data?.score as Record<string, number>) ?? {};

  return (
    <section className="grid grid-3">
      <ScoreCard title="Total Score" value={score.total ?? '-'} />
      <ScoreCard title="Correct" value={score.correct ?? '-'} />
      <ScoreCard title="Percentile" value={score.percentile ?? '-'} />
    </section>
  );
}
