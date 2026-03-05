import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { createAdminSupabase } from '@/lib/supabase/admin';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST(req: Request) {
  const auth = req.headers.get('x-admin-secret');
  if (!env.ADMIN_INGEST_SECRET || auth !== env.ADMIN_INGEST_SECRET) {
    return unauthorized();
  }

  try {
    const body = await req.json();
    const sourceFile = String(body.sourceFile ?? '').trim();
    if (!sourceFile) {
      return NextResponse.json({ error: 'sourceFile is required' }, { status: 400 });
    }

    const supabase = createAdminSupabase();
    const { data, error } = await supabase
      .from('ingestion_runs')
      .insert({
        source_file: sourceFile,
        status: 'pending',
        quality_summary: null,
      })
      .select('id, source_file, status, created_at')
      .single();

    if (error || !data) throw error ?? new Error('Unable to create run');
    return NextResponse.json({ run: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create ingestion run' }, { status: 500 });
  }
}
