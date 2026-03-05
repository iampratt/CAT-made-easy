import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { createAdminSupabase } from '@/lib/supabase/admin';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = req.headers.get('x-admin-secret');
  if (!env.ADMIN_INGEST_SECRET || auth !== env.ADMIN_INGEST_SECRET) {
    return unauthorized();
  }

  try {
    const { id } = await params;
    const supabase = createAdminSupabase();

    const [{ data: run, error: runError }, { data: issues, error: issueError }] = await Promise.all([
      supabase
        .from('ingestion_runs')
        .select('*')
        .eq('id', id)
        .single(),
      supabase
        .from('ingestion_issues')
        .select('id, page_no, severity, code, detail, meta, created_at')
        .eq('run_id', id)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    if (runError || !run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (issueError) throw issueError;

    return NextResponse.json({ run, issues: issues ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch run summary' }, { status: 500 });
  }
}
