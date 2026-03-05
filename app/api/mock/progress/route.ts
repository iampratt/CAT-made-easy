import { NextResponse } from 'next/server';
import { saveMockProgress } from '@/lib/mockRepo';
import { createServerSupabase } from '@/lib/supabase/server';

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabase();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    await saveMockProgress({
      userId: auth.user.id,
      mockId: body.mockId,
      answers: body.answers ?? {},
      questionTimings: body.questionTimings ?? {},
      events: body.events ?? [],
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Progress save failed' }, { status: 500 });
  }
}
