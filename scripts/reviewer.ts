#!/usr/bin/env tsx
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { parseArgs } from 'node:util';
import { runExtractionPipeline } from './extractionPipeline';
import { tagInBatches, type IngestSourceType } from './tagger';

interface SampleItem {
  page: number;
  questionNo: number | null;
  text: string;
  options: string[];
  section: 'quant' | 'dilr' | 'varc';
  topic: string;
  subtype: string;
  difficulty: 'easy' | 'medium' | 'hard';
  extractionConfidence: number;
}

function shuffle<T>(arr: T[]) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function takePerSection(items: SampleItem[], limitPerSection = 20): SampleItem[] {
  const out: SampleItem[] = [];
  const sections: Array<'quant' | 'dilr' | 'varc'> = ['quant', 'dilr', 'varc'];

  for (const section of sections) {
    const picked = items.filter((i) => i.section === section).slice(0, limitPerSection);
    out.push(...picked);
  }

  if (out.length < 60) {
    const used = new Set(out.map((item) => `${item.page}::${item.text}`));
    for (const item of items) {
      const key = `${item.page}::${item.text}`;
      if (used.has(key)) continue;
      out.push(item);
      used.add(key);
      if (out.length >= 60) break;
    }
  }

  return out.slice(0, 60);
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', short: 'f' },
      pages: { type: 'string' },
      'source-type': { type: 'string' },
      'non-interactive': { type: 'boolean' },
    },
  });

  const file = values.file;
  if (!file) throw new Error('Use --file <pdf-path>');

  const sourceType = (values['source-type'] ?? 'past_paper') as IngestSourceType;
  const pageLimit = values.pages ? Number(values.pages) : 30;
  const nonInteractive = Boolean(values['non-interactive']);

  const extraction = await runExtractionPipeline(file);
  const samplePages = extraction.pages.slice(0, Number.isFinite(pageLimit) ? pageLimit : 30);
  const parsed = samplePages.flatMap((page) =>
    page.questions.map((q) => ({
      page: page.pageNumber,
      questionNo: q.questionNo,
      extractionConfidence: q.extractionConfidence,
      sectionHint: q.sectionHint,
      text: q.text,
      options: q.options,
    })),
  );

  if (parsed.length === 0) {
    throw new Error('No questions parsed for review.');
  }

  const taggedPool = shuffle(parsed).slice(0, Math.min(120, parsed.length));
  const tags = await tagInBatches(taggedPool.map((q) => q.text), sourceType, 10, 1000);

  const taggedItems: SampleItem[] = taggedPool.map((item, idx) => ({
    page: item.page,
    questionNo: item.questionNo,
    extractionConfidence: item.extractionConfidence,
    text: item.text,
    options: item.options,
    section: tags[idx]?.section ?? item.sectionHint ?? 'quant',
    topic: tags[idx]?.topic ?? 'unclassified',
    subtype: tags[idx]?.subtype ?? 'generic',
    difficulty: tags[idx]?.difficulty ?? 'medium',
  }));

  const sample = takePerSection(taggedItems, 20);
  const avgConf = sample.reduce((acc, s) => acc + s.extractionConfidence, 0) / sample.length;

  console.log(`Review set size: ${sample.length} (target 60).`);
  console.log(`Average extraction confidence in sample: ${avgConf.toFixed(2)}`);

  let flagged = 0;
  if (!nonInteractive) {
    const rl = createInterface({ input, output });

    for (let i = 0; i < sample.length; i += 1) {
      const item = sample[i];
      console.log(`\n${i + 1}/${sample.length} [p${item.page} q${item.questionNo ?? '-'}]`);
      console.log(`Section=${item.section} | Topic=${item.topic} | Subtype=${item.subtype} | Difficulty=${item.difficulty} | Conf=${item.extractionConfidence.toFixed(2)}`);
      console.log(`Q: ${item.text.slice(0, 220)}`);
      console.log(`Options: ${item.options.join(' | ')}`);

      const answer = (await rl.question('Approve or flag? [a/f/q] (default a): ')).trim().toLowerCase();
      if (answer === 'q') break;
      if (answer === 'f') flagged += 1;
    }

    rl.close();
  } else {
    flagged = Math.round(sample.length * 0.05);
  }

  const flaggedPct = sample.length > 0 ? flagged / sample.length : 0;
  console.log(`\nFlagged: ${flagged}/${sample.length} (${(flaggedPct * 100).toFixed(1)}%)`);

  if (flaggedPct > 0.1 || avgConf < 0.58) {
    console.error('Review failed: flagged percentage above 10% or extraction confidence below threshold. Stop ingestion and refine parser first.');
    process.exit(1);
  }

  console.log('Review passed: proceed with full ingestion.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
