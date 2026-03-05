import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { createAdminSupabase } from '@/lib/supabase/admin';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = req.headers.get('x-admin-secret');
  if (!env.ADMIN_INGEST_SECRET || auth !== env.ADMIN_INGEST_SECRET) {
    return unauthorized();
  }

  try {
    const { id } = await params;
    const supabase = createAdminSupabase();

    const { data: issues, error: issuesError } = await supabase
      .from('ingestion_issues')
      .select('id')
      .eq('run_id', id)
      .eq('severity', 'error')
      .limit(1);

    if (issuesError) throw issuesError;
    if ((issues ?? []).length > 0) {
      return NextResponse.json({ error: 'Run has blocking errors and cannot be approved.' }, { status: 409 });
    }

    const { data, error } = await supabase
      .from('ingestion_runs')
      .update({
        status: 'published',
        approved_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, status, approved_at')
      .single();

    if (error || !data) throw error ?? new Error('Run not found');

    return NextResponse.json({ run: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to approve run' }, { status: 500 });
  }
}
