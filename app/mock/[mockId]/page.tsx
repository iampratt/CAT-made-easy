import { notFound } from 'next/navigation';
import { ExamUI } from '@/components/ExamUI';
import { requireServerUser } from '@/lib/auth';

export default async function MockExamPage({ params }: { params: Promise<{ mockId: string }> }) {
  const { mockId } = await params;
  const { user, supabase } = await requireServerUser();
  const { data, error } = await supabase
    .from('mocks')
    .select('id, question_payload')
    .eq('id', mockId)
    .eq('user_id', user.id)
    .single();

  if (error || !data?.question_payload) return notFound();

  return (
    <ExamUI mockId={mockId} questions={data.question_payload} initialSeconds={40 * 60} />
  );
}
