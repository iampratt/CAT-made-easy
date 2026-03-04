#!/usr/bin/env tsx
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { parsePdfText, splitPages } from './pdfParser';
import { splitQuantVarcQuestions } from './questionSplitter';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getCheckpoint, upsertCheckpoint } from './checkpointer';

async function main() {
  const { values } = parseArgs({ options: { file: { type: 'string', short: 'f' }, section: { type: 'string' } } });
  const file = values.file;
  const section = (values.section ?? 'quant') as 'quant' | 'dilr' | 'varc';
  if (!file) throw new Error('Use --file <pdf-path>');

  const checkpoint = await getCheckpoint(file);
  const startPage = Number(checkpoint?.last_processed_page ?? 0);

  const rawText = await parsePdfText(file);
  const pages = splitPages(rawText);
  const supabase = createAdminSupabase();

  await upsertCheckpoint(file, { status: 'running', total_pages: pages.length });

  let inserted = Number(checkpoint?.questions_ingested ?? 0);
  for (let pageNo = startPage; pageNo < pages.length; pageNo += 1) {
    const page = pages[pageNo];
    const chunks = splitQuantVarcQuestions(page);

    for (const chunk of chunks) {
      const textHash = createHash('md5').update(chunk.text).digest('hex');
      const { data: existing } = await supabase.from('questions').select('id').eq('text_hash', textHash).maybeSingle();
      if (existing) continue;

      const { error } = await supabase.from('questions').insert({
        text: chunk.text,
        options: chunk.options,
        correct_answer: 'A',
        explanation: 'Source explanation pending.',
        section,
        topic: 'unclassified',
        difficulty: 'medium',
        source: file,
        type: 'past_paper',
        text_hash: textHash,
      });
      if (error) throw error;
      inserted += 1;
    }

    if ((pageNo + 1) % 10 === 0) {
      await upsertCheckpoint(file, {
        status: 'running',
        last_processed_page: pageNo + 1,
        questions_ingested: inserted,
      });
    }
  }

  await upsertCheckpoint(file, {
    status: 'completed',
    last_processed_page: pages.length,
    questions_ingested: inserted,
  });

  console.log(`Ingestion complete. Inserted: ${inserted}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
