import fs from 'node:fs/promises';
import { createAdminSupabase } from '@/lib/supabase/admin';

export async function uploadDilrImage(localPath: string, remotePath: string) {
  const supabase = createAdminSupabase();
  const file = await fs.readFile(localPath);
  const { error } = await supabase.storage.from('dilr-images').upload(remotePath, file, {
    upsert: true,
    contentType: 'image/png',
  });
  if (error) throw error;
  const { data } = supabase.storage.from('dilr-images').getPublicUrl(remotePath);
  return data.publicUrl;
}
