import { NextResponse } from 'next/server';
import { createMock } from '@/lib/mockRepo';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await createMock({
      userId: body.userId ?? null,
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
