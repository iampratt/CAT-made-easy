import { createHash } from 'node:crypto';
import { generateVerifiedQuestions } from '@/lib/chains/mockChain';
import { difficultyMixFromAccuracy, weakScore } from '@/lib/personalization';
import { scoreMock } from '@/lib/scoring';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getQuestionsForMock } from '@/lib/supabase/queries';
import type { AllocationTask, MockBlueprint } from '@/types/mock';
import type { Difficulty, Question, Section } from '@/types/question';

type MockType = 'full' | 'section' | 'topic';

interface GenerationTask {
  section: Section;
  topic: string;
  subtype: string;
  difficulty: Difficulty;
  count: number;
}

interface TargetProfile {
  topic: string;
  subtype: string;
  weakScore: number;
}

interface CorpusQuestionRow {
  id: string;
  text: string;
  options: string[] | null;
  correct_answer: string | null;
  explanation: string | null;
  topic: string | null;
  subtype?: string | null;
  difficulty: Difficulty | null;
  source: string | null;
  type: 'past_paper' | 'book' | 'generated';
  set_id: string | null;
  set_text: string | null;
  set_image_url: string | null;
  passage_text: string | null;
  group_id?: string | null;
  question_no?: number | null;
  answer_confidence?: number | null;
  extraction_confidence?: number | null;
  is_verified?: boolean | null;
  source_page?: number | null;
  origin?: 'corpus' | 'generated' | null;
}

interface QuestionEvent {
  questionId: string;
  eventType: 'view' | 'answer' | 'mark' | 'unmark' | 'navigate';
  timeSpentSeconds?: number;
  payload?: Record<string, unknown>;
  timestamp?: string;
}

const FULL_BLUEPRINT: MockBlueprint = {
  id: 'cat_latest_full',
  label: 'CAT Latest Full Mock',
  type: 'full',
  totalQuestions: 66,
  durationSeconds: 120 * 60,
  sections: [
    { section: 'varc', count: 24 },
    { section: 'dilr', count: 20, enforceSets: true },
    { section: 'quant', count: 22 },
  ],
};

const SECTION_DURATION_SECONDS = 40 * 60;

function normalizeAnswer(raw: string | null | undefined) {
  if (!raw) return 'A';
  const clean = raw.trim().toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(clean)) return clean;
  const first = clean.charAt(0);
  return ['A', 'B', 'C', 'D'].includes(first) ? first : 'A';
}

function normalizedTextHash(value: string) {
  return createHash('md5').update(value.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
}

function mapRowToQuestion(row: CorpusQuestionRow, section: Section): Question {
  const options = Array.isArray(row.options)
    ? row.options.map((option, idx) => {
      const label = String.fromCharCode(65 + idx);
      const trimmed = String(option ?? '').trim();
      return /^[A-D][\).:]/i.test(trimmed) ? trimmed : `${label}) ${trimmed}`;
    }).slice(0, 4)
    : ['A) Option A', 'B) Option B', 'C) Option C', 'D) Option D'];

  while (options.length < 4) {
    const label = String.fromCharCode(65 + options.length);
    options.push(`${label}) Option ${label}`);
  }

  return {
    id: row.id,
    text: row.text,
    options,
    correctAnswer: normalizeAnswer(row.correct_answer),
    explanation: row.explanation ?? 'No explanation available.',
    section,
    topic: row.topic ?? 'unclassified',
    subtype: row.subtype ?? 'generic',
    difficulty: row.difficulty ?? 'medium',
    source: row.source ?? 'corpus',
    type: row.type,
    origin: row.origin ?? 'corpus',
    questionNo: row.question_no ?? null,
    setId: row.set_id ?? null,
    setText: row.set_text ?? null,
    setImageUrl: row.set_image_url ?? null,
    passageText: row.passage_text ?? null,
    groupId: row.group_id ?? null,
    answerConfidence: row.answer_confidence ?? null,
    extractionConfidence: row.extraction_confidence ?? null,
    isVerified: row.is_verified ?? undefined,
    sourcePage: row.source_page ?? null,
    provenance: {
      sourcePage: row.source_page ?? null,
      stage: 'deterministic',
    },
  };
}

function getBlueprint(args: { type: MockType; section?: Section; count: number }): MockBlueprint {
  if (args.type === 'full') {
    return FULL_BLUEPRINT;
  }

  const section = args.section ?? 'quant';
  const total = Math.max(4, args.count);
  return {
    id: `${args.type}_${section}`,
    label: args.type === 'topic' ? 'Topic Practice' : 'Sectional Mock',
    type: args.type,
    sections: [{ section, count: total, enforceSets: section === 'dilr' }],
    totalQuestions: total,
    durationSeconds: SECTION_DURATION_SECONDS,
  };
}

function countByDifficulty(total: number, mix: Record<Difficulty, number>) {
  const easy = Math.round(total * mix.easy);
  const medium = Math.round(total * mix.medium);
  const hard = Math.max(0, total - easy - medium);
  return { easy, medium, hard };
}

function allocateByWeight(total: number, targets: TargetProfile[]) {
  if (targets.length === 0) return [] as Array<{ target: TargetProfile; count: number }>;

  const safeTargets = targets.map((target) => ({
    target,
    weight: Math.max(0.1, target.weakScore),
  }));

  const weightSum = safeTargets.reduce((acc, item) => acc + item.weight, 0);
  const withBase = safeTargets.map((item) => ({
    ...item,
    raw: (item.weight / weightSum) * total,
    count: Math.floor((item.weight / weightSum) * total),
  }));

  let used = withBase.reduce((acc, item) => acc + item.count, 0);
  const byRemainder = [...withBase].sort((a, b) => (b.raw - b.count) - (a.raw - a.count));
  let idx = 0;

  while (used < total) {
    byRemainder[idx % byRemainder.length].count += 1;
    used += 1;
    idx += 1;
  }

  return withBase
    .map((item) => ({ target: item.target, count: item.count }))
    .filter((item) => item.count > 0);
}

async function getExcludeIds(userId: string) {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from('user_attempts')
    .select('question_id')
    .eq('user_id', userId)
    .order('attempted_at', { ascending: false })
    .limit(7000);

  if (error) throw error;
  return (data ?? []).map((row) => String(row.question_id));
}

async function getMockCount(userId: string) {
  const supabase = createAdminSupabase();
  const { count, error } = await supabase
    .from('mocks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .not('completed_at', 'is', null);

  if (error) throw error;
  return Number(count ?? 0);
}

async function getSectionAccuracy(userId: string, section: Section) {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from('user_topic_performance')
    .select('accuracy')
    .eq('user_id', userId)
    .eq('section', section)
    .limit(200);

  if (error) throw error;
  if (!data || data.length === 0) return 0.55;

  const sum = data.reduce((acc, row) => acc + Number(row.accuracy ?? 0), 0);
  return Math.max(0, Math.min(1, sum / data.length));
}

async function getWeakTargets(userId: string, section: Section, limit = 4): Promise<TargetProfile[]> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from('user_topic_performance')
    .select('topic, subtype, weak_score')
    .eq('user_id', userId)
    .eq('section', section)
    .order('weak_score', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const fromProfile = (data ?? [])
    .map((row) => ({
      topic: String(row.topic ?? '').trim(),
      subtype: String(row.subtype ?? 'generic').trim() || 'generic',
      weakScore: Number(row.weak_score ?? 0.5),
    }))
    .filter((row) => row.topic.length > 0);

  if (fromProfile.length > 0) return fromProfile;

  const { data: corpusRows, error: corpusError } = await supabase
    .from('questions')
    .select('topic, subtype')
    .eq('section', section)
    .limit(100);

  if (corpusError) throw corpusError;

  const unique = new Map<string, TargetProfile>();
  for (const row of corpusRows ?? []) {
    const topic = String(row.topic ?? '').trim();
    if (!topic) continue;
    const subtype = String(row.subtype ?? 'generic').trim() || 'generic';
    const key = `${topic}::${subtype}`;
    if (!unique.has(key)) {
      unique.set(key, { topic, subtype, weakScore: 0.5 });
    }
  }

  const values = Array.from(unique.values());
  if (values.length > 0) return values.slice(0, limit);

  return [{ topic: 'mixed', subtype: 'generic', weakScore: 0.5 }];
}

function buildTasks(args: {
  type: MockType;
  section?: Section;
  topic?: string;
  count: number;
  blueprint: MockBlueprint;
  targetsBySection: Record<Section, TargetProfile[]>;
  mixBySection: Record<Section, Record<Difficulty, number>>;
}): GenerationTask[] {
  const tasks: GenerationTask[] = [];

  for (const sectionConfig of args.blueprint.sections) {
    const section = sectionConfig.section;
    const sectionTotal = sectionConfig.count;
    if (sectionTotal <= 0) continue;

    const mix = args.mixBySection[section];
    const perDifficulty = countByDifficulty(sectionTotal, mix);

    const baseTargets = args.topic
      ? [{ topic: args.topic, subtype: 'generic', weakScore: 1 }]
      : args.targetsBySection[section].length > 0
        ? args.targetsBySection[section]
        : [{ topic: 'mixed', subtype: 'generic', weakScore: 1 }];

    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const difficultyCount = perDifficulty[difficulty];
      if (difficultyCount <= 0) continue;

      const allocations = allocateByWeight(difficultyCount, baseTargets);
      for (const allocation of allocations) {
        tasks.push({
          section,
          topic: allocation.target.topic,
          subtype: allocation.target.subtype,
          difficulty,
          count: allocation.count,
        });
      }
    }
  }

  return tasks;
}

async function fetchCorpusQuestions(args: {
  section: Section;
  topic: string;
  subtype: string;
  difficulty: Difficulty;
  excludeIds: string[];
  count: number;
}) {
  const collected = new Map<string, CorpusQuestionRow>();

  const attempts: Array<{ topic: string | null; subtype: string | null; difficulty: Difficulty | null; requireVerified: boolean }> = [
    { topic: args.topic === 'mixed' ? null : args.topic, subtype: args.subtype === 'generic' ? null : args.subtype, difficulty: args.difficulty, requireVerified: true },
    { topic: args.topic === 'mixed' ? null : args.topic, subtype: null, difficulty: args.difficulty, requireVerified: true },
    { topic: args.topic === 'mixed' ? null : args.topic, subtype: args.subtype === 'generic' ? null : args.subtype, difficulty: null, requireVerified: true },
    { topic: args.topic === 'mixed' ? null : args.topic, subtype: null, difficulty: null, requireVerified: true },
    { topic: null, subtype: null, difficulty: args.difficulty, requireVerified: true },
    { topic: null, subtype: null, difficulty: null, requireVerified: false },
  ];

  for (const attempt of attempts) {
    if (collected.size >= args.count) break;

    const rows = await getQuestionsForMock({
      section: args.section,
      topic: attempt.topic,
      subtype: attempt.subtype,
      difficulty: attempt.difficulty,
      excludeIds: args.excludeIds,
      count: Math.max(args.count * 2, 25),
      requireVerified: attempt.requireVerified,
      minAnswerConfidence: 0.85,
      minExtractionConfidence: 0.6,
    }) as CorpusQuestionRow[];

    for (const row of rows) {
      if (collected.has(row.id)) continue;
      collected.set(row.id, row);
      if (collected.size >= args.count) break;
    }
  }

  return Array.from(collected.values()).slice(0, args.count);
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
    subtype: q.subtype ?? 'generic',
    difficulty: q.difficulty,
    source: q.source ?? 'groq-generated',
    type: 'generated',
    origin: 'generated',
    set_id: q.setId ?? null,
    set_text: q.setText ?? null,
    set_image_url: q.setImageUrl ?? null,
    passage_text: q.passageText ?? null,
    group_id: q.groupId ?? null,
    question_no: q.questionNo ?? null,
    answer_confidence: q.answerConfidence ?? 0.92,
    extraction_confidence: q.extractionConfidence ?? 1,
    is_verified: q.isVerified ?? true,
    source_page: q.sourcePage ?? null,
    source_bbox_json: q.provenance ? { ...q.provenance, generation_validation: q.generationValidation ?? null } : null,
    text_hash: createHash('md5').update(q.text).digest('hex'),
  }));

  const { error } = await supabase.from('questions').insert(rows);
  if (error) throw error;
}

async function persistQuestionEvents(args: { userId: string; mockId: string; events?: QuestionEvent[] }) {
  if (!args.events || args.events.length === 0) return;

  const supabase = createAdminSupabase();
  const rows = args.events.map((event) => ({
    user_id: args.userId,
    mock_id: args.mockId,
    question_id: event.questionId,
    event_type: event.eventType,
    time_spent_seconds: event.timeSpentSeconds ?? null,
    payload: event.payload ?? null,
    created_at: event.timestamp ?? new Date().toISOString(),
  }));

  const { error } = await supabase.from('user_question_events').insert(rows);
  if (error) throw error;
}

function computeDuplicateRisk(text: string, existingHashes: Set<string>) {
  const hash = normalizedTextHash(text);
  return existingHashes.has(hash) ? 1 : 0;
}

async function generateFallback(args: {
  task: GenerationTask;
  count: number;
  references: CorpusQuestionRow[];
  existingHashes: Set<string>;
}) {
  if (args.count <= 0) return [] as Question[];

  const generated = await generateVerifiedQuestions({
    section: args.task.section,
    topic: args.task.topic,
    subtype: args.task.subtype,
    difficulty: args.task.difficulty,
    count: args.count,
    references: args.references,
  });

  const accepted: Question[] = [];
  for (const item of generated) {
    const duplicateRisk = computeDuplicateRisk(item.text, args.existingHashes);
    if (duplicateRisk >= 1) continue;

    const hash = normalizedTextHash(item.text);
    args.existingHashes.add(hash);

    accepted.push({
      ...item,
      origin: 'generated',
      subtype: item.subtype ?? args.task.subtype,
      answerConfidence: 0.92,
      extractionConfidence: 1,
      isVerified: true,
      generationValidation: {
        schemaValid: item.options.length === 4,
        verifiedByModel: true,
        duplicateRisk,
      },
      provenance: {
        stage: 'generated',
      },
    });
  }

  return accepted;
}

async function updateUserTopicPerformance(args: {
  userId: string;
  questions: Question[];
  answers: Record<string, string>;
  questionTimings?: Record<string, number>;
}) {
  const supabase = createAdminSupabase();
  const attempted = args.questions.filter((q) => Boolean(args.answers[q.id]));
  if (attempted.length === 0) return;

  const grouped = new Map<string, {
    section: Section;
    topic: string;
    subtype: string;
    attempts: number;
    correct: number;
    timeSum: number;
  }>();

  for (const question of attempted) {
    const key = `${question.section}::${question.topic}::${question.subtype ?? 'generic'}`;
    const current = grouped.get(key) ?? {
      section: question.section,
      topic: question.topic,
      subtype: question.subtype ?? 'generic',
      attempts: 0,
      correct: 0,
      timeSum: 0,
    };

    current.attempts += 1;
    if (args.answers[question.id] === question.correctAnswer) current.correct += 1;
    current.timeSum += Number(args.questionTimings?.[question.id] ?? 0);
    grouped.set(key, current);
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('user_topic_performance')
    .select('section, topic, subtype, attempts, correct, avg_time_seconds, last_attempted_at')
    .eq('user_id', args.userId);

  if (existingError) throw existingError;

  const existingMap = new Map<string, {
    attempts: number;
    correct: number;
    avg_time_seconds: number;
    last_attempted_at: string | null;
  }>();

  for (const row of existingRows ?? []) {
    existingMap.set(`${row.section}::${row.topic}::${row.subtype ?? 'generic'}`, {
      attempts: Number(row.attempts ?? 0),
      correct: Number(row.correct ?? 0),
      avg_time_seconds: Number(row.avg_time_seconds ?? 0),
      last_attempted_at: row.last_attempted_at ? String(row.last_attempted_at) : null,
    });
  }

  const nowIso = new Date().toISOString();
  const payload = Array.from(grouped.values()).map((row) => {
    const key = `${row.section}::${row.topic}::${row.subtype}`;
    const existing = existingMap.get(key);

    const attempts = (existing?.attempts ?? 0) + row.attempts;
    const correct = (existing?.correct ?? 0) + row.correct;
    const accuracy = attempts > 0 ? correct / attempts : 0;

    const previousAvg = existing?.avg_time_seconds ?? 0;
    const currentAvg = row.attempts > 0 ? row.timeSum / row.attempts : 0;
    const avgTimeSeconds = existing
      ? ((previousAvg * existing.attempts) + row.timeSum) / Math.max(1, attempts)
      : currentAvg;

    const lastAttemptDate = existing?.last_attempted_at ? new Date(existing.last_attempted_at) : null;
    const daysSinceLastAttempt = lastAttemptDate
      ? Math.max(0, (Date.now() - lastAttemptDate.getTime()) / (1000 * 60 * 60 * 24))
      : undefined;

    return {
      user_id: args.userId,
      section: row.section,
      topic: row.topic,
      subtype: row.subtype,
      attempts,
      correct,
      accuracy,
      avg_time_seconds: avgTimeSeconds,
      weak_score: weakScore({
        accuracy,
        attempts,
        avgTimeSeconds,
        lastThreeDeclining: false,
        daysSinceLastAttempt,
      }),
      last_attempted_at: nowIso,
      last_updated: nowIso,
    };
  });

  const { error: upsertError } = await supabase
    .from('user_topic_performance')
    .upsert(payload, { onConflict: 'user_id,section,topic,subtype' });

  if (upsertError) throw upsertError;
}

export async function createMock(args: {
  userId: string;
  type: MockType;
  section?: Section;
  topic?: string;
  count: number;
  blueprintId?: string;
  strictRealFirst?: boolean;
  allowGeneratedFill?: boolean;
}) {
  const safeSection = args.section ?? 'quant';
  const safeUserId = args.userId;
  const allowGeneratedFill = args.allowGeneratedFill ?? true;

  const supabase = createAdminSupabase();
  const { error: userUpsertError } = await supabase
    .from('users')
    .upsert({ id: safeUserId }, { onConflict: 'id', ignoreDuplicates: false });
  if (userUpsertError) throw userUpsertError;

  const completedMocks = await getMockCount(safeUserId);
  const hasHistory = completedMocks > 0;

  const blueprint = getBlueprint({
    type: args.type,
    section: args.type === 'full' ? undefined : safeSection,
    count: args.type === 'full' ? FULL_BLUEPRINT.totalQuestions : args.count,
  });

  const excludeIds = await getExcludeIds(safeUserId);
  const sectionTargets = {
    quant: await getWeakTargets(safeUserId, 'quant', args.type === 'full' ? 4 : 5),
    dilr: await getWeakTargets(safeUserId, 'dilr', args.type === 'full' ? 4 : 5),
    varc: await getWeakTargets(safeUserId, 'varc', args.type === 'full' ? 4 : 5),
  };

  const mixBySection: Record<Section, Record<Difficulty, number>> = {
    quant: difficultyMixFromAccuracy(await getSectionAccuracy(safeUserId, 'quant'), hasHistory),
    dilr: difficultyMixFromAccuracy(await getSectionAccuracy(safeUserId, 'dilr'), hasHistory),
    varc: difficultyMixFromAccuracy(await getSectionAccuracy(safeUserId, 'varc'), hasHistory),
  };

  if (args.type !== 'full') {
    blueprint.sections = blueprint.sections.filter((entry) => entry.section === safeSection);
    blueprint.totalQuestions = blueprint.sections.reduce((acc, entry) => acc + entry.count, 0);
  }

  const tasks = buildTasks({
    type: args.type,
    section: safeSection,
    topic: args.topic,
    count: args.count,
    blueprint,
    targetsBySection: sectionTargets,
    mixBySection,
  });

  const questions: Question[] = [];
  const existingTextHashes = new Set<string>();
  let generatedFillCount = 0;

  for (const task of tasks) {
    const corpusRows = await fetchCorpusQuestions({
      section: task.section,
      topic: task.topic,
      subtype: task.subtype,
      difficulty: task.difficulty,
      excludeIds,
      count: task.count,
    });

    const corpusQuestions = corpusRows.map((row) => mapRowToQuestion(row, task.section));
    for (const question of corpusQuestions) {
      const hash = normalizedTextHash(question.text);
      if (existingTextHashes.has(hash)) continue;
      existingTextHashes.add(hash);
      questions.push(question);
      excludeIds.push(question.id);
      if (questions.length >= blueprint.totalQuestions) break;
    }

    const missing = task.count - corpusQuestions.length;
    if (missing > 0) {
      if (!allowGeneratedFill) {
        throw new Error(`Corpus shortfall for ${task.section}/${task.topic}/${task.subtype}/${task.difficulty}.`);
      }

      const references = corpusRows.length > 0
        ? corpusRows.slice(0, Math.max(3, Math.min(12, corpusRows.length)))
        : await fetchCorpusQuestions({
          section: task.section,
          topic: 'mixed',
          subtype: 'generic',
          difficulty: task.difficulty,
          excludeIds,
          count: 12,
        });

      const generated = await generateFallback({
        task,
        count: missing,
        references,
        existingHashes: existingTextHashes,
      });

      generatedFillCount += generated.length;
      questions.push(...generated);
    }
  }

  const sectionOrder: Record<Section, number> = { varc: 0, dilr: 1, quant: 2 };
  const ordered = questions
    .slice(0, blueprint.totalQuestions)
    .sort((a, b) => sectionOrder[a.section] - sectionOrder[b.section]);

  if (ordered.length === 0) {
    throw new Error('No questions available to create mock. Ingest corpus or enable generation fallback.');
  }

  const generatedOnly = ordered.filter((question) => question.origin === 'generated');
  await persistGeneratedQuestions(generatedOnly);

  const payload = {
    user_id: safeUserId,
    type: args.type,
    config: {
      type: args.type,
      section: args.type === 'full' ? null : safeSection,
      topic: args.topic ?? null,
      count: blueprint.totalQuestions,
      blueprintId: args.blueprintId ?? blueprint.id,
      difficultyMix: args.type === 'full' ? mixBySection : mixBySection[safeSection],
      blueprint,
      allocationPlan: tasks as AllocationTask[],
      generatedFillCount,
      durationSeconds: blueprint.durationSeconds,
      strictRealFirst: args.strictRealFirst ?? true,
      allowGeneratedFill,
    },
    question_ids: ordered.map((q) => q.id),
    question_payload: ordered,
    progress: {
      answers: {},
      questionTimings: {},
    },
  };

  const { data, error } = await supabase.from('mocks').insert(payload).select('id').single();
  if (error || !data) throw error ?? new Error('Unable to create mock');
  return { mockId: data.id };
}

export async function submitMock(args: {
  userId: string;
  mockId: string;
  answers: Record<string, string>;
  questionTimings?: Record<string, number>;
  events?: QuestionEvent[];
}) {
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
      time_taken_seconds: Number(args.questionTimings?.[q.id] ?? 0) || null,
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
    questionTimings: args.questionTimings,
  });

  await persistQuestionEvents({
    userId: args.userId,
    mockId: args.mockId,
    events: args.events,
  });

  const { error: updateError } = await supabase
    .from('mocks')
    .update({
      score,
      progress: { answers: args.answers, questionTimings: args.questionTimings ?? {} },
      completed_at: new Date().toISOString(),
      percentile: score.percentile,
    })
    .eq('id', args.mockId);

  if (updateError) throw updateError;
  return score;
}

export async function saveMockProgress(args: {
  userId: string;
  mockId: string;
  answers: Record<string, string>;
  questionTimings?: Record<string, number>;
  events?: QuestionEvent[];
}) {
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from('mocks')
    .update({
      progress: {
        answers: args.answers,
        questionTimings: args.questionTimings ?? {},
      },
    })
    .eq('id', args.mockId)
    .eq('user_id', args.userId);

  if (error) throw error;

  await persistQuestionEvents({
    userId: args.userId,
    mockId: args.mockId,
    events: args.events,
  });
}
