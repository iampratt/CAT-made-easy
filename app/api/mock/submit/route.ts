import { NextResponse } from 'next/server';
import { submitMock } from '@/lib/mockRepo';
import { createServerSupabase } from '@/lib/supabase/server';

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabase();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const score = await submitMock({ userId: auth.user.id, mockId: body.mockId, answers: body.answers ?? {} });
    return NextResponse.json({ ok: true, score });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Submission failed' }, { status: 500 });
  }
}
