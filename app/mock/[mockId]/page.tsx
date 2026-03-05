import { notFound } from 'next/navigation';
import { ExamUI } from '@/components/ExamUI';
import { requireServerUser } from '@/lib/auth';
import type { MockConfig } from '@/types/mock';

export default async function MockExamPage({ params }: { params: Promise<{ mockId: string }> }) {
  const { mockId } = await params;
  const { user, supabase } = await requireServerUser();
  const { data, error } = await supabase
    .from('mocks')
    .select('id, type, config, question_payload')
    .eq('id', mockId)
    .eq('user_id', user.id)
    .single();

  if (error || !data?.question_payload) return notFound();

  const config = (data.config ?? {}) as MockConfig;
  const initialSeconds = Number(config.durationSeconds)
    || (data.type === 'full' ? 120 * 60 : 40 * 60);

  return (
    <ExamUI mockId={mockId} questions={data.question_payload} initialSeconds={initialSeconds} />
  );
}
