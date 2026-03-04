import { NextResponse } from 'next/server';
import { createMock } from '@/lib/mockRepo';
import { createServerSupabase } from '@/lib/supabase/server';

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabase();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const result = await createMock({
      userId: auth.user.id,
      type: 'topic',
      section: body.section ?? 'quant',
      topic: body.topic ?? 'time and work',
      count: Number(body.count ?? 15),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to generate topic practice.' }, { status: 500 });
  }
}
