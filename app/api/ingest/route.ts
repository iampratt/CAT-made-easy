import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

export async function POST(req: Request) {
  const auth = req.headers.get('x-admin-secret');
  if (!env.ADMIN_INGEST_SECRET || auth !== env.ADMIN_INGEST_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ ok: true, message: 'Ingestion trigger accepted. Run local scripts for actual ingestion.' });
}
