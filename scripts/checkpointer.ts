import { createAdminSupabase } from '@/lib/supabase/admin';

export async function upsertCheckpoint(fileName: string, updates: Record<string, unknown>) {
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from('ingestion_checkpoints')
    .upsert({ file_name: fileName, ...updates, updated_at: new Date().toISOString() }, { onConflict: 'file_name' });
  if (error) throw error;
}

export async function getCheckpoint(fileName: string) {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.from('ingestion_checkpoints').select('*').eq('file_name', fileName).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}
