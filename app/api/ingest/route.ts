import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

export async function POST(req: Request) {
  const auth = req.headers.get('x-admin-secret');
  if (!env.ADMIN_INGEST_SECRET || auth !== env.ADMIN_INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    message: 'Use /api/ingest/run to create a run, /api/ingest/run/:id to inspect quality, and /api/ingest/run/:id/approve to publish.',
  });
}
