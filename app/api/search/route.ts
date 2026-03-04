import { NextResponse } from 'next/server';
import { runPyqSearch } from '@/lib/chains/pyqChain';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const query = String(body.query ?? '');
    const section = body.section ?? null;
    const results = await runPyqSearch(query, section);
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Search failed' }, { status: 500 });
  }
}
