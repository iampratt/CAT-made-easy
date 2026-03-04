import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';

export async function requireServerUser() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect('/login');
  }

  return { user: data.user, supabase };
}
