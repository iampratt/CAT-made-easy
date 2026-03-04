import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';

export async function GET(_: Request, context: { params: Promise<{ mockId: string }> }) {
  try {
    const { mockId } = await context.params;
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from('mocks').select('*').eq('id', mockId).single();
    if (error) throw error;
    return NextResponse.json({ mock: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch mock' }, { status: 500 });
  }
}
