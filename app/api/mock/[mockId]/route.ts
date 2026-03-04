import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';

export async function GET(_: Request, context: { params: Promise<{ mockId: string }> }) {
  try {
    const serverSupabase = await createServerSupabase();
    const { data: auth } = await serverSupabase.auth.getUser();
    if (!auth.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { mockId } = await context.params;
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from('mocks').select('*').eq('id', mockId).eq('user_id', auth.user.id).single();
    if (error) throw error;
    return NextResponse.json({ mock: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch mock' }, { status: 500 });
  }
}
