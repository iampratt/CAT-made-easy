import { createHash } from 'node:crypto';
import { generateVerifiedQuestions } from '@/lib/chains/mockChain';
import { difficultyMixFromAccuracy } from '@/lib/personalization';
import { scoreMock } from '@/lib/scoring';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getQuestionsForMock } from '@/lib/supabase/queries';
import type { Difficulty, Question, Section } from '@/types/question';

interface GenerationTask {
  section: Section;
  topic: string;
  difficulty: Difficulty;
  count: number;
}

function computeWeakScore(args: {
  accuracy: number;
  attempts: number;
  avgTimeSeconds: number;
  lastThreeDeclining: boolean;
}) {
  const raw =
    (1 - args.accuracy) * 0.6 +
    (args.avgTimeSeconds > 120 ? 0.2 : 0) +
    (args.attempts < 5 ? 0.3 : 0) +
    (args.lastThreeDeclining ? 0.2 : 0);
  return Math.max(0, Math.min(1, raw));
}

function splitTotal(total: number) {
  const safeTotal = Math.max(3, total);
  const ratios: Array<{ section: Section; weight: number }> = [
    { section: 'varc', weight: 24 / 66 },
    { section: 'dilr', weight: 20 / 66 },
    { section: 'quant', weight: 22 / 66 },
  ];

  const initial = ratios.map((r) => ({
    section: r.section,
    raw: safeTotal * r.weight,
    count: Math.floor(safeTotal * r.weight),
  }));

  let used = initial.reduce((acc, item) => acc + item.count, 0);
  const byRemainder = [...initial].sort((a, b) => (b.raw - b.count) - (a.raw - a.count));

  let idx = 0;
  while (used < safeTotal) {
    byRemainder[idx % byRemainder.length].count += 1;
    used += 1;
    idx += 1;
  }

  return {
    quant: initial.find((i) => i.section === 'quant')?.count ?? 0,
    dilr: initial.find((i) => i.section === 'dilr')?.count ?? 0,
    varc: initial.find((i) => i.section === 'varc')?.count ?? 0,
  };
}

function countByDifficulty(total: number, mix: Record<Difficulty, number>) {
  const easy = Math.round(total * mix.easy);
  const medium = Math.round(total * mix.medium);
  const hard = Math.max(0, total - easy - medium);
  return { easy, medium, hard };
}

async function getExcludeIds(userId: string | null) {
  if (!userId) return [] as string[];
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.from('user_attempts').select('question_id').eq('user_id', userId).limit(5000);
  if (error) throw error;
  return (data ?? []).map((row) => String(row.question_id));
}

async function getSectionAccuracy(userId: string | null, section: Section) {
  if (!userId) return 0.55;
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from('user_topic_performance')
    .select('accuracy')
    .eq('user_id', userId)
    .eq('section', section)
    .limit(100);

  if (error) throw error;
  if (!data || data.length === 0) return 0.55;

  const sum = data.reduce((acc, row) => acc + Number(row.accuracy ?? 0), 0);
  return Math.min(1, Math.max(0, sum / data.length));
}

async function getWeakTopics(userId: string | null, section: Section, limit = 3) {
  const supabase = createAdminSupabase();

  if (userId) {
    const { data, error } = await supabase
      .from('user_topic_performance')
      .select('topic, weak_score')
      .eq('user_id', userId)
      .eq('section', section)
      .order('weak_score', { ascending: false })
      .limit(limit);

    if (error) throw error;
    const topics = (data ?? []).map((row) => String(row.topic)).filter(Boolean);
    if (topics.length > 0) return topics;
  }

  const { data: corpusTopics, error: topicError } = await supabase
    .from('questions')
    .select('topic')
    .eq('section', section)
    .not('topic', 'is', null)
    .limit(40);

  if (topicError) throw topicError;

  const unique = Array.from(new Set((corpusTopics ?? []).map((row) => String(row.topic)).filter(Boolean)));
  if (unique.length > 0) return unique.slice(0, limit);

  return ['mixed'];
}

async function getReferenceQuestions(args: {
  section: Section;
  topic: string;
  difficulty: Difficulty;
  excludeIds: string[];
  count: number;
}) {
  const first = await getQuestionsForMock({
    section: args.section,
    topic: args.topic === 'mixed' ? null : args.topic,
    difficulty: args.difficulty,
    excludeIds: args.excludeIds,
    count: args.count,
  });

  if (first.length >= Math.min(3, args.count)) return first;

  const second = await getQuestionsForMock({
    section: args.section,
    topic: args.topic === 'mixed' ? null : args.topic,
    difficulty: null,
    excludeIds: args.excludeIds,
    count: args.count,
  });

  if (second.length >= Math.min(3, args.count)) return second;

  return getQuestionsForMock({
    section: args.section,
    topic: null,
    difficulty: null,
    excludeIds: args.excludeIds,
    count: args.count,
  });
}

function buildTasks(args: {
  type: 'full' | 'section' | 'topic';
  section?: Section;
  topic?: string;
  count: number;
  topicsBySection: Record<Section, string[]>;
  mixBySection: Record<Section, Record<Difficulty, number>>;
}) {
  const tasks: GenerationTask[] = [];

  const sectionCounts = args.type === 'full'
    ? splitTotal(args.count)
    : {
      quant: args.section === 'quant' ? args.count : 0,
      dilr: args.section === 'dilr' ? args.count : 0,
      varc: args.section === 'varc' ? args.count : 0,
    };

  for (const section of ['quant', 'dilr', 'varc'] as const) {
    const sectionTotal = sectionCounts[section];
    if (sectionTotal <= 0) continue;

    const mix = args.mixBySection[section];
    const perDifficulty = countByDifficulty(sectionTotal, mix);
    const topics = args.topic ? [args.topic] : (args.topicsBySection[section].length > 0 ? args.topicsBySection[section] : ['mixed']);

    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const difficultyCount = perDifficulty[difficulty];
      if (difficultyCount <= 0) continue;

      const base = Math.floor(difficultyCount / topics.length);
      let remainder = difficultyCount % topics.length;

      for (const topic of topics) {
        const count = base + (remainder > 0 ? 1 : 0);
        remainder = Math.max(0, remainder - 1);
        if (count > 0) tasks.push({ section, topic, difficulty, count });
      }
    }
  }

  return tasks;
}

async function persistGeneratedQuestions(questions: Question[]) {
  if (questions.length === 0) return;
  const supabase = createAdminSupabase();

  const rows = questions.map((q) => ({
    id: q.id,
    text: q.text,
    options: q.options,
    correct_answer: q.correctAnswer,
    explanation: q.explanation,
    section: q.section,
    topic: q.topic,
    difficulty: q.difficulty,
    source: q.source ?? 'groq-generated',
    type: 'generated',
    set_id: q.setId ?? null,
    set_text: q.setText ?? null,
    set_image_url: q.setImageUrl ?? null,
    passage_text: q.passageText ?? null,
    text_hash: createHash('md5').update(q.text).digest('hex'),
  }));

  const { error } = await supabase.from('questions').insert(rows);
  if (error) throw error;
}

async function updateUserTopicPerformance(args: {
  userId: string;
  questions: Question[];
  answers: Record<string, string>;
}) {
  const supabase = createAdminSupabase();
  const attempted = args.questions.filter((q) => Boolean(args.answers[q.id]));
  if (attempted.length === 0) return;

  const grouped = new Map<string, { section: Section; topic: string; attempts: number; correct: number }>();
  for (const question of attempted) {
    const key = `${question.section}::${question.topic}`;
    const current = grouped.get(key) ?? {
      section: question.section,
      topic: question.topic,
      attempts: 0,
      correct: 0,
    };
    current.attempts += 1;
    if (args.answers[question.id] === question.correctAnswer) current.correct += 1;
    grouped.set(key, current);
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('user_topic_performance')
    .select('id, section, topic, attempts, correct, avg_time_seconds')
    .eq('user_id', args.userId);
  if (existingError) throw existingError;

  const existingMap = new Map<string, { id: string; attempts: number; correct: number; avg_time_seconds: number | null }>();
  for (const row of existingRows ?? []) {
    existingMap.set(`${row.section}::${row.topic}`, {
      id: String(row.id),
      attempts: Number(row.attempts ?? 0),
      correct: Number(row.correct ?? 0),
      avg_time_seconds: typeof row.avg_time_seconds === 'number' ? row.avg_time_seconds : null,
    });
  }

  const payload = Array.from(grouped.values()).map((row) => {
    const existing = existingMap.get(`${row.section}::${row.topic}`);
    const attempts = (existing?.attempts ?? 0) + row.attempts;
    const correct = (existing?.correct ?? 0) + row.correct;
    const accuracy = attempts > 0 ? correct / attempts : 0;
    const avgTimeSeconds = existing?.avg_time_seconds ?? 0;
    const weakScore = computeWeakScore({
      accuracy,
      attempts,
      avgTimeSeconds,
      lastThreeDeclining: false,
    });

    return {
      user_id: args.userId,
      section: row.section,
      topic: row.topic,
      attempts,
      correct,
      accuracy,
      avg_time_seconds: avgTimeSeconds,
      weak_score: weakScore,
      last_updated: new Date().toISOString(),
    };
  });

  const { error: upsertError } = await supabase
    .from('user_topic_performance')
    .upsert(payload, { onConflict: 'user_id,section,topic' });
  if (upsertError) throw upsertError;
}

export async function createMock(args: {
  userId: string;
  type: 'full' | 'section' | 'topic';
  section?: Section;
  topic?: string;
  count: number;
}) {
  const safeSection = args.section ?? 'quant';
  const safeUserId = args.userId;
  const supabase = createAdminSupabase();
  const { error: userUpsertError } = await supabase
    .from('users')
    .upsert({ id: safeUserId }, { onConflict: 'id', ignoreDuplicates: false });
  if (userUpsertError) throw userUpsertError;

  const excludeIds = await getExcludeIds(safeUserId);
  const topicsBySection: Record<Section, string[]> = {
    quant: await getWeakTopics(safeUserId, 'quant', args.type === 'full' ? 2 : 3),
    dilr: await getWeakTopics(safeUserId, 'dilr', args.type === 'full' ? 2 : 3),
    varc: await getWeakTopics(safeUserId, 'varc', args.type === 'full' ? 2 : 3),
  };

  const mixBySection: Record<Section, Record<Difficulty, number>> = {
    quant: difficultyMixFromAccuracy(await getSectionAccuracy(safeUserId, 'quant')),
    dilr: difficultyMixFromAccuracy(await getSectionAccuracy(safeUserId, 'dilr')),
    varc: difficultyMixFromAccuracy(await getSectionAccuracy(safeUserId, 'varc')),
  };

  const tasks = buildTasks({
    type: args.type,
    section: safeSection,
    topic: args.topic,
    count: args.count,
    topicsBySection,
    mixBySection,
  });

  const questions: Question[] = [];

  for (const task of tasks) {
    const references = await getReferenceQuestions({
      section: task.section,
      topic: task.topic,
      difficulty: task.difficulty,
      excludeIds,
      count: Math.max(10, task.count),
    });
    if (references.length < 3) {
      throw new Error(
        `Insufficient ingested corpus for ${task.section}/${task.topic}/${task.difficulty}. Ingest more PYQ/book PDFs first.`,
      );
    }

    let generated: Question[] = [];
    let retries = 0;
    while (generated.length < task.count && retries < 3) {
      retries += 1;
      const batch = await generateVerifiedQuestions({
        section: task.section,
        topic: task.topic,
        difficulty: task.difficulty,
        count: task.count - generated.length,
        references,
      });
      generated = [...generated, ...batch];
    }

    questions.push(...generated);
  }

  if (questions.length === 0) {
    throw new Error('No questions generated. Verify corpus ingestion and GROQ_API_KEY.');
  }

  await persistGeneratedQuestions(questions);

  const payload = {
    user_id: safeUserId,
    type: args.type,
    config: {
      type: args.type,
      section: args.type === 'full' ? null : safeSection,
      topic: args.topic ?? null,
      count: args.count,
      difficultyMix: args.type === 'full' ? mixBySection : mixBySection[safeSection],
    },
    question_ids: questions.map((q) => q.id),
    question_payload: questions,
  };

  const { data, error } = await supabase.from('mocks').insert(payload).select('id').single();
  if (error || !data) throw error ?? new Error('Unable to create mock');
  return { mockId: data.id };
}

export async function submitMock(args: { userId: string; mockId: string; answers: Record<string, string> }) {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from('mocks')
    .select('question_payload, user_id')
    .eq('id', args.mockId)
    .eq('user_id', args.userId)
    .single();
  if (error || !data?.question_payload) throw error ?? new Error('Mock not found');

  const questions = data.question_payload as Question[];
  const score = scoreMock(questions, args.answers);

  const attempts = questions
    .filter((q) => Boolean(args.answers[q.id]))
    .map((q) => ({
      user_id: data.user_id,
      question_id: q.id,
      mock_id: args.mockId,
      selected_answer: args.answers[q.id],
      is_correct: args.answers[q.id] === q.correctAnswer,
      time_taken_seconds: null,
    }))
    .filter((row) => Boolean(row.user_id));

  if (attempts.length > 0) {
    const { error: attemptsError } = await supabase.from('user_attempts').insert(attempts);
    if (attemptsError) throw attemptsError;
  }

  await updateUserTopicPerformance({
    userId: args.userId,
    questions,
    answers: args.answers,
  });

  const { error: updateError } = await supabase
    .from('mocks')
    .update({ score, completed_at: new Date().toISOString(), percentile: score.percentile })
    .eq('id', args.mockId);

  if (updateError) throw updateError;
  return score;
}

export async function saveMockProgress(args: { userId: string; mockId: string; answers: Record<string, string> }) {
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from('mocks')
    .update({ progress: args.answers })
    .eq('id', args.mockId)
    .eq('user_id', args.userId);
  if (error) throw error;
}
