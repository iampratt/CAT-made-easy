import { NextResponse } from 'next/server';
import { saveMockProgress } from '@/lib/mockRepo';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await saveMockProgress({ mockId: body.mockId, answers: body.answers ?? {} });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Progress save failed' }, { status: 500 });
  }
}
