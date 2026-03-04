import { NextResponse } from 'next/server';
import { submitMock } from '@/lib/mockRepo';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const score = await submitMock({ mockId: body.mockId, answers: body.answers ?? {} });
    return NextResponse.json({ ok: true, score });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Submission failed' }, { status: 500 });
  }
}
