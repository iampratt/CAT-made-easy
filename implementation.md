# CAT Mock Paper Generator — Implementation Guide

## Project Overview

A personalized CAT mock test platform powered by RAG (LangChain.js), Supabase pgvector, and Groq. The system ingests CAT preparation books and past year papers, generates fresh unseen questions per user, and continuously personalizes difficulty and topic distribution based on each user's performance history. The entire stack is free to run with zero compromise on quality.

---

## Tech Stack

| Layer | Technology | Cost |
|---|---|---|
| Frontend + API | Next.js 14 (App Router) | Free (Vercel) |
| RAG Framework | LangChain.js | Free |
| Vector DB + Database | Supabase (pgvector + full-text search) | Free tier |
| File Storage | Supabase Storage | Free tier (1GB) |
| LLM — Generation | Groq (llama-3.3-70b-versatile) | Free tier |
| LLM — Tagging + Explanation | Groq (llama-3.1-8b-instruct) | Free tier |
| LLM — Verification | Groq (gemma2-9b-it) | Free tier |
| LLM — Vision (DILR images) | Groq (llama-4-scout-17b-16e-instruct) | Free tier |
| Corpus Embeddings (ingestion only) | @huggingface/transformers — runs locally | Free, no API key |
| Live Query Embeddings | Not needed — see embedding strategy | Free |
| PDF Parsing | pdf-parse + pdfjs-dist | Free (npm) |
| Auth | Supabase Auth | Free tier |
| Deployment | Vercel | Free tier |

**Total infrastructure cost: $0**

---

## Embedding Strategy — No Live Embedding on Vercel

This is the most important architectural decision in the project. Understanding it prevents a lot of wasted effort.

### Where embedding actually happens

Embedding converts text to vectors. In this app there are two contexts where you might need embeddings:

**Context 1 — Ingestion (one-time, runs locally):** Every question in your corpus needs to be embedded and stored in Supabase pgvector. This runs on your machine once when you add books. `@huggingface/transformers` downloads `nomic-embed-text-v1.5` locally and runs it in Node.js. No API key, no rate limits, no cost, perfect quality.

**Context 2 — Live queries on Vercel (every user action):** This is the problem. `@huggingface/transformers` downloads a ~274MB model — Vercel serverless functions have a 250MB limit so deployment fails. Calling a remote embedding API adds a dependency, rate limits, and potential cost.

### The insight — live embedding is only needed for PYQ search

Mock generation does NOT need live query embedding. You already know the topic, section, and difficulty from the UI. You filter by metadata directly in SQL — no semantic search needed.

PYQ search is the only feature where a user types a free-text query. And for CAT specifically, users search for things like "time and work", "blood relations", "reading comprehension inference" — specific topic names where **Postgres full-text search is as accurate as vector search**, arguably more so because these are exact domain terms not vague natural language.

### Result

No live embedding on Vercel at all. Zero dependencies on any embedding API. No rate limits. Full quality on mock generation. PYQ search works excellently with full-text search for CAT's specific query patterns.

| Task | Method | Embedding needed? |
|---|---|---|
| Corpus ingestion | @huggingface/transformers locally | Yes — one-time, local |
| Mock generation retrieval | SQL metadata filter (section + topic + difficulty) | No |
| PYQ search | Postgres full-text search | No |

---

## System Architecture

```
PDFs (Books + Past Papers)
         ↓
  Ingestion Pipeline (one-time, runs locally on your machine)
         ↓
  ┌──────────────────────────────────────────────────────┐
  │  PDF Page Classifier (pdfjs-dist)                    │
  │    ↓ text pages           ↓ image pages              │
  │  pdf-parse            Image Extractor                │
  │    ↓                  (pdfjs-dist)                   │
  │    ↓                      ↓                          │
  │    ↓               Groq Vision Model                 │
  │    ↓               (llama-4-scout)                   │
  │    ↓               Text Description +                │
  │    ↓               Upload to Supabase Storage        │
  │    └───────────────────┘                             │
  │               ↓                                      │
  │   Question / DILR Set / Passage Splitter             │
  │               ↓                                      │
  │   Manual Review Sample (50–60 questions)             │
  │               ↓ (after approval)                     │
  │   Batch LLM Tagger — Groq 8b                        │
  │   10 questions per call                              │
  │   CAT-calibrated difficulty prompt                   │
  │               ↓                                      │
  │   @huggingface/transformers (nomic-embed-text-v1.5)  │
  │   Runs locally — batch 32 per call                   │
  │               ↓                                      │
  │   Supabase Upsert + Checkpoint                       │
  └──────────────────────────────────────────────────────┘
         ↓
  Supabase pgvector + full-text search index
  Supabase Storage (DILR set images)
         ↓
  Next.js API Routes
         ↓
  ┌─────────────────────────────────────────────────────┐
  │  Mock generation → SQL metadata filter              │
  │  (section + topic + difficulty + exclude_ids)       │
  │  → Groq 70b generation → gemma2 verification        │
  │                                                     │
  │  PYQ search → Postgres full-text search             │
  │  (no embedding, no external API)                    │
  └─────────────────────────────────────────────────────┘
         ↓
  Personalization Engine
  (user_attempts + user_topic_performance)
         ↓
  Exam UI (Next.js)
  Image DILR  → <img src={supabase_storage_url}>
  Generated DILR → react-markdown (markdown table)
  VARC → passage left + question right
```

---

## Phase 1: Database Design

### Enable Extensions

```sql
create extension if not exists vector;
```

### Core Tables

**questions** — the entire embedded corpus

```sql
create table questions (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  options jsonb,
  correct_answer text,
  explanation text,
  section text check (section in ('quant', 'dilr', 'varc')),
  topic text,
  difficulty text check (difficulty in ('easy', 'medium', 'hard')),
  source text,
  type text check (type in ('past_paper', 'generated')),

  -- DILR specific
  set_id uuid,           -- all questions in a set share this
  set_text text,         -- structured text description of the data setup
  set_image_url text,    -- Supabase Storage URL if image-based, null otherwise
  set_image_type text,   -- 'table' | 'bar_chart' | 'line_chart' | 'pie_chart' | 'venn' | 'network'

  -- VARC specific
  passage_text text,     -- full RC passage attached to this question

  -- Vector and deduplication
  embedding vector(768), -- nomic-embed-text-v1.5 dimensions
  text_hash text,        -- md5 of question text for deduplication

  -- Full-text search index (for PYQ search)
  text_search tsvector generated always as (
    to_tsvector('english', coalesce(text, '') || ' ' || coalesce(topic, '') || ' ' || coalesce(source, ''))
  ) stored,

  created_at timestamp default now()
);

-- Index for full-text search
create index on questions using gin(text_search);

-- Index for metadata filtering (mock generation)
create index on questions(section, topic, difficulty, type);
```

**users**

```sql
create table users (
  id uuid primary key references auth.users,
  name text,
  target_percentile int default 90,
  created_at timestamp default now()
);
```

**mocks**

```sql
create table mocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  type text check (type in ('full', 'section', 'topic')),
  config jsonb,
  question_ids jsonb,
  score jsonb,
  percentile float,
  completed_at timestamp,
  created_at timestamp default now()
);
```

**user_attempts** — every question attempt ever made

```sql
create table user_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  question_id uuid references questions(id),
  mock_id uuid references mocks(id),
  selected_answer text,
  is_correct boolean,
  time_taken_seconds int,
  attempted_at timestamp default now()
);
```

**user_topic_performance** — aggregated weak area tracking, updated after every mock

```sql
create table user_topic_performance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  section text,
  topic text,
  attempts int default 0,
  correct int default 0,
  accuracy float default 0,
  avg_time_seconds float,
  weak_score float default 1.0,
  last_updated timestamp default now(),
  unique(user_id, section, topic)
);
```

**ingestion_checkpoints** — resume support for long ingestion runs

```sql
create table ingestion_checkpoints (
  id uuid primary key default gen_random_uuid(),
  file_name text not null unique,
  last_processed_page int default 0,
  total_pages int,
  questions_ingested int default 0,
  status text check (status in ('running', 'completed', 'failed')),
  started_at timestamp default now(),
  updated_at timestamp default now()
);
```

### Mock Generation SQL Function

This is the core retrieval function for mock generation. Filters by metadata — no embedding needed at query time:

```sql
create or replace function get_questions_for_mock(
  match_section text,
  match_topic text,
  match_difficulty text,
  exclude_ids uuid[],
  match_count int
)
returns table (
  id uuid,
  text text,
  options jsonb,
  correct_answer text,
  explanation text,
  topic text,
  difficulty text,
  source text,
  type text,
  set_id uuid,
  set_text text,
  set_image_url text,
  passage_text text
)
language sql stable
as $$
  select
    id, text, options, correct_answer, explanation,
    topic, difficulty, source, type, set_id, set_text,
    set_image_url, passage_text
  from questions
  where
    section = match_section
    and (match_topic is null or topic = match_topic)
    and (match_difficulty is null or difficulty = match_difficulty)
    and id != all(exclude_ids)
  order by random()    -- randomize so references are varied each generation
  limit match_count;
$$;
```

### Vector Search SQL Function

Still needed for any future semantic search features. Keep it available:

```sql
create or replace function match_questions_semantic(
  query_embedding vector(768),
  match_section text,
  match_topic text,
  exclude_ids uuid[],
  match_count int
)
returns table (
  id uuid,
  text text,
  options jsonb,
  correct_answer text,
  explanation text,
  topic text,
  difficulty text,
  source text,
  similarity float
)
language sql stable
as $$
  select
    id, text, options, correct_answer, explanation,
    topic, difficulty, source,
    1 - (embedding <=> query_embedding) as similarity
  from questions
  where
    section = match_section
    and (match_topic is null or topic = match_topic)
    and id != all(exclude_ids)
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

### PYQ Full-Text Search SQL Function

```sql
create or replace function search_pyq(
  search_query text,
  filter_section text,
  match_count int default 10
)
returns table (
  id uuid,
  text text,
  options jsonb,
  correct_answer text,
  explanation text,
  topic text,
  difficulty text,
  source text,
  set_text text,
  set_image_url text,
  passage_text text,
  rank float
)
language sql stable
as $$
  select
    id, text, options, correct_answer, explanation,
    topic, difficulty, source, set_text, set_image_url, passage_text,
    ts_rank(text_search, plainto_tsquery('english', search_query)) as rank
  from questions
  where
    type = 'past_paper'
    and (filter_section is null or section = filter_section)
    and text_search @@ plainto_tsquery('english', search_query)
  order by rank desc
  limit match_count;
$$;
```

### Vector Index

```sql
create index on questions
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);
```

### Supabase Storage

Create a public bucket called `dilr-images` in Supabase Storage dashboard. Free tier gives 1GB — at ~100KB per image that is ~10,000 DILR set images for free.

---

## Phase 2: Ingestion Pipeline

Runs once locally on your machine when you add books or papers. With batching optimizations, expect 2–4 hours for 300–500MB (~10,000 questions). Start before sleeping.

### Step 1 — PDF Page Classification

Use `pdfjs-dist` to get each page's operator list and classify before parsing:

```
For each page in PDF:
  Get operator list from pdfjs-dist
  If paintImageXObject operator found → image page
  If only text operators → text page
  Route accordingly
```

### Step 2 — Text Page Parsing

Use `pdf-parse` for text-heavy pages. Most popular PDF text extraction library on npm — huge community, easy to debug. Extract raw text per page and pass to question boundary detection.

### Step 3 — Image Page Handling (Three-Tier Strategy)

**Tier 1 — Text-based sets:** Standard text extraction. Highest confidence. Ingest fully.

**Tier 2 — Image-based simple sets (tables, bar charts, line charts, pie charts):**
- Extract image using `pdfjs-dist`
- Send to Groq vision model (`llama-4-scout-17b-16e-instruct`)
- Get structured text description
- Upload original image to Supabase Storage — store public URL as `set_image_url`
- Store text description as `set_text` for LLM context and embedding
- Ingest with medium-high confidence

**Tier 3 — Image-based complex sets (network diagrams, route maps, complex Venn):**
- Attempt vision model conversion
- If response contains "UNCLEAR" more than twice → flag for manual review, skip ingestion
- A wrong DILR context is worse than a missing one

### Groq Vision Prompt for DILR Images

```
You are processing a CAT exam DILR image (Data Interpretation and Logical Reasoning).
Convert this image to a complete structured text description preserving ALL data values exactly.

Rules:
- Never approximate — use exact numbers from the image
- Tables → reproduce as a markdown table with all rows and columns
- Bar/line charts → list every data point as "Label: value"
- Pie charts → list every segment as "Segment: X%"
- Venn diagrams → list all regions and their values explicitly
- Network/route diagrams → list all nodes and connections with values
- If any value is unclear or unreadable, write UNCLEAR for that value only

Return ONLY the structured data. No commentary.
```

If response contains more than 2 instances of "UNCLEAR" → Tier 3, skip ingestion.

### Step 4 — Question Boundary Detection

**For Quant:** Detect numbered stems (`Q.1`, `Q1.`, `1.`) followed by four option lines starting with `(A) (B) (C) (D)` or `A. B. C. D.` Each complete stem + 4 options = one question chunk.

**For DILR sets — critical:** Never split a set. Detect the data setup block (table/chart/paragraph before numbered questions begin). Assign a `set_id` (new UUID). Store data block as `set_text`. All questions that follow until the next set begins share that `set_id` and `set_text`. Each question still gets its own row in the DB.

**For VARC RC passages:** Detect the passage block (multi-paragraph text before numbered questions). Store full passage as `passage_text` on each question belonging to it. Never separate passage from its questions.

For ambiguous boundaries, use a single Groq 8b call to confirm — keep this rare, tune regex first.

### Step 5 — Manual Review Before Full Ingestion

Always sample and review before full ingestion. This catches systematic tagging problems before they affect thousands of questions.

The `reviewer.ts` script:
- Samples 20 random questions per section (60 total)
- Prints question text + assigned topic + assigned difficulty side by side in the terminal
- Accepts approve/flag input per question interactively
- Reports flagged percentage — halts if above 10%
- Requires explicit approval before full ingestion proceeds

Common issues to catch: quant questions tagged as VARC, difficulty consistently off by one level, DILR questions missing set context, wrong topic assignment.

### Step 6 — Batch LLM Tagging (10 questions per call)

Send 10 questions per Groq 8b API call. Reduces total calls from ~10,000 to ~1,000. Tagging quality is not affected — batch classification is as accurate as single-question calls.

Add 2-second delay between calls to stay within 30 RPM free limit.

Tags to extract per question:
- `section`: quant / dilr / varc
- `topic`: specific topic (e.g. "time and work", "blood relations", "reading comprehension — inference")
- `difficulty`: easy / medium / hard — **must use CAT-calibrated prompt below**
- `type`: past_paper or book
- `correct_answer`: extract from source if present
- `explanation`: extract from source or generate briefly

**CAT-specific difficulty calibration — include in every tagging prompt:**

```
CAT DIFFICULTY CALIBRATION — use this as your reference standard:

EASY: A student at 90th percentile solves this under 60 seconds with no rough work.
      Direct formula application or single-step logic.
      Examples: simple percentage, reading a value directly from a table.

MEDIUM: A student at 95th percentile solves this in 60–120 seconds with rough work.
        Requires 2–3 step reasoning or moderate calculation.
        Examples: time-speed-distance with a condition, 2-set Venn diagram.

HARD: Even 99th percentile students take 2–3 minutes or may choose to skip.
      Multi-step reasoning, complex calculation, or non-obvious insight required.
      Examples: nested set theory, DILR with 4+ simultaneous constraints.

Tag the following 10 questions. Return a JSON array of exactly 10 tag objects.
```

### Step 7 — Local Embedding with @huggingface/transformers

Install: `npm i @huggingface/transformers`

Use `nomic-ai/nomic-embed-text-v1.5` — 768 dimensions. The model downloads to your machine on first run (~274MB). After first download it runs fully offline.

Batch 32 questions per embedding call for efficiency. No delays needed — running locally, no rate limits.

```ts
import { pipeline } from '@huggingface/transformers'

const embedder = await pipeline('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5')

// Batch embed 32 questions at a time
async function embedBatch(texts: string[]) {
  const output = await embedder(texts, { pooling: 'mean', normalize: true })
  return output.tolist() // returns array of 768-dim vectors
}
```

**Important:** `nomic-embed-text-v1.5` requires a task prefix in the text. Use:
- `"search_document: {question_text}"` when embedding corpus questions during ingestion
- `"search_query: {user_query}"` if you ever embed a query in future

This is specific to the nomic model — omitting the prefix degrades embedding quality.

### Step 8 — Deduplication and Upsert

Compute `md5(question_text)` as `text_hash` before every insert. Check if hash exists in DB — skip if it does. This prevents duplicates when re-running ingestion on overlapping books.

For image-based DILR: upload image to Supabase Storage first, get public URL, include as `set_image_url` in upsert.

### Step 9 — Checkpoint and Resume

After every 100 successful inserts, update `ingestion_checkpoints` with current page number and question count. On restart, read checkpoint and skip already-processed pages. On completion, set status to `completed`.

Essential — a 3-hour job that crashes at hour 2 should resume from hour 2, not restart.

### Ingestion Script Location

```
scripts/
  ingest.ts              -- orchestrator with checkpoint logic
  pdfParser.ts           -- pdf-parse + pdfjs-dist, page classification
  imageExtractor.ts      -- pdfjs-dist image extraction per page
  questionSplitter.ts    -- boundary detection (quant + varc)
  dilrSplitter.ts        -- DILR set detection and grouping (most critical)
  visionTagger.ts        -- Groq vision model for image-based DILR
  tagger.ts              -- batch LLM tagging via Groq 8b (10 per call)
  reviewer.ts            -- manual review sampling (run before full ingest)
  embedder.ts            -- local @huggingface/transformers (32 per batch)
  uploader.ts            -- Supabase Storage image upload
  checkpointer.ts        -- checkpoint read/write
```

Run order:
```bash
npx tsx scripts/reviewer.ts --file ./books/cat-2022.pdf   # review first
npx tsx scripts/ingest.ts --file ./books/cat-2022.pdf     # then full ingest
```

---

## Phase 3: RAG + Generation Chains

### Groq Model Assignment

| Task | Model | Daily Limit | Notes |
|---|---|---|---|
| Question generation | llama-3.3-70b-versatile | 1,000 RPD | Protect this quota — generation only |
| Ingestion tagging | llama-3.1-8b-instruct | 14,400 RPD | Batch 10 per call |
| Verification | gemma2-9b-it | 14,400 RPD | Saves 70b quota |
| Explanation generation | llama-3.1-8b-instruct | 14,400 RPD | Simple task |
| Vision (DILR images) | llama-4-scout-17b-16e-instruct | Free | Ingestion only |
| PYQ search | No LLM | — | Postgres full-text search |

At 3–5 generation calls per mock, 70b supports ~200–333 mock generations per day. Add a quota guard: if 70b RPD is near exhausted, fall back to 8b with a UI notice.

### Generation Chain — Five Steps

**Step 1 — Exclusion list:** Fetch all `question_id` values from `user_attempts` for this user. Pass as `exclude_ids` to the SQL function.

**Step 2 — Weak topic weights:** Query `user_topic_performance` sorted by `weak_score` descending. Allocate more question slots to weaker topics proportionally.

**Step 3 — Difficulty distribution:** Based on accuracy across last 3 mocks, determine easy/medium/hard split (see personalization section).

**Step 4 — Retrieve reference questions:** Call `get_questions_for_mock` SQL function per topic. Retrieve 10–15 questions as style and difficulty anchors for the LLM. These are never shown to users — internal context only. The `order by random()` in the SQL ensures different references each time, keeping generated questions varied.

**Step 5 — Generate and verify:** Generate with 70b, verify with gemma2, return structured JSON.

### Generation Prompt

```
You are generating CAT exam questions at the standard of the actual CAT exam.

Here are {count} real CAT {section} questions on {topic} at {difficulty}
difficulty for style reference only:
{retrieved_questions}

Generate {count} NEW, ORIGINAL questions on {topic} at {difficulty} difficulty.

Rules:
- Do NOT copy or paraphrase the reference questions above
- Match difficulty calibration exactly to the reference examples
- Quant: every answer must be arithmetically verifiable — check your own math
- DILR: generate a complete data setup first as a markdown table, then 4–5
  questions based solely on that data. All answers must be derivable from
  the table with no outside knowledge needed
- VARC: generate a 200–250 word passage first, then 4 inference or application
  questions answerable only from the passage

Return ONLY valid JSON:
{
  "questions": [
    {
      "text": "...",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct_answer": "A",
      "explanation": "Step by step solution...",
      "topic": "...",
      "difficulty": "...",
      "set_text": "..."    // DILR only: the markdown table data setup
    }
  ]
}
```

### Verification Step

After generation, call `gemma2-9b-it` (14,400 RPD — use freely):

```
Verify this CAT exam question:
Question: {question}
Stated answer: {correct_answer}
Explanation: {explanation}

Check:
1. Is the explanation logically correct?
2. Does following the explanation actually reach the stated answer?
3. For Quant: is the arithmetic correct?

Return JSON: { "valid": true/false, "issue": "description if invalid" }
```

If `valid: false` → regenerate once. If fails again → skip that slot. Never serve a wrong answer key. Cap retries at 2 to protect quota.

---

## Phase 4: Personalization Engine

### Weak Score Formula

Run after every mock submission. Update `user_topic_performance` per topic:

```
weak_score = (1 - accuracy) * 0.6
           + (avg_time_seconds > 120 ? 0.2 : 0)     -- slow on topic
           + (attempts < 5 ? 0.3 : 0)               -- rarely practiced
           + (last_3_accuracy_declining ? 0.2 : 0)   -- getting worse
```

Higher weak score = more questions from this topic in next mock. Cap at 1.0.

### Difficulty Progression

| Recent Accuracy (last 3 mocks) | Easy | Medium | Hard |
|---|---|---|---|
| Below 40% | 50% | 40% | 10% |
| 40–60% | 30% | 50% | 20% |
| 60–75% | 20% | 50% | 30% |
| Above 75% | 10% | 40% | 50% |

First mock (no history): default to 30% easy, 50% medium, 20% hard.

### Full Mock Topic Allocation

CAT mock structure: 66 questions total.
- Quant: 22 questions — distribute across topics by weak score
- DILR: 20 questions — 5 complete sets × 4 questions — never generate partial sets
- VARC: 24 questions — 3 RC passages × 4 questions + 12 VA questions

### Scoring Logic

CAT scoring:
- MCQ correct: +3, wrong: -1, unattempted: 0
- TITA correct: +3, wrong: 0, unattempted: 0

Estimate percentile from a static historical CAT score distribution lookup table stored in the codebase.

---

## Phase 5: Next.js Project Structure

```
cat-mock-generator/
├── app/
│   ├── page.tsx                          -- Landing page
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── dashboard/page.tsx                -- Performance dashboard
│   ├── mock/
│   │   ├── page.tsx                      -- Mock config screen
│   │   ├── [mockId]/page.tsx             -- Live exam UI
│   │   └── [mockId]/results/page.tsx     -- Score + analysis
│   ├── practice/
│   │   ├── section/page.tsx
│   │   └── topic/page.tsx
│   └── pyq/page.tsx                      -- PYQ full-text search
│
├── api/
│   ├── generate/
│   │   ├── mock/route.ts
│   │   ├── section/route.ts
│   │   └── topic/route.ts
│   ├── mock/
│   │   ├── submit/route.ts
│   │   ├── progress/route.ts             -- Mid-exam auto-save
│   │   └── [mockId]/route.ts
│   ├── search/route.ts                   -- PYQ full-text search
│   └── ingest/route.ts                   -- Admin only
│
├── lib/
│   ├── llm.ts                            -- Groq model instances
│   ├── vectorstore.ts                    -- Supabase pgvector connection
│   ├── personalization.ts
│   ├── scoring.ts
│   ├── chains/
│   │   ├── mockChain.ts
│   │   ├── sectionChain.ts
│   │   ├── topicChain.ts
│   │   └── pyqChain.ts                  -- Full-text search, no LLM
│   └── supabase/
│       ├── client.ts
│       ├── server.ts
│       └── queries.ts
│
├── components/
│   ├── ExamUI.tsx
│   ├── QuestionCard.tsx
│   ├── DilrPanel.tsx                     -- Image or markdown table
│   ├── VarcPanel.tsx                     -- Passage display
│   ├── OptionButton.tsx
│   ├── Timer.tsx
│   ├── QuestionGrid.tsx
│   ├── ScoreCard.tsx
│   ├── PerformanceChart.tsx
│   └── PYQSearch.tsx
│
├── scripts/
│   ├── ingest.ts
│   ├── pdfParser.ts
│   ├── imageExtractor.ts
│   ├── questionSplitter.ts
│   ├── dilrSplitter.ts
│   ├── visionTagger.ts
│   ├── tagger.ts
│   ├── reviewer.ts
│   ├── embedder.ts                       -- @huggingface/transformers local
│   ├── uploader.ts
│   └── checkpointer.ts
│
└── types/
    ├── question.ts
    ├── mock.ts
    └── user.ts
```

---

## Phase 6: DILR Display in Exam UI

The data setup must always be visible while answering DILR questions.

### DilrPanel Component Logic

```
Fetch DILR question from DB
        ↓
Does set_image_url exist?
  YES (past paper, image-based):
      Left panel → <img src={set_image_url} alt="DILR data setup" />
  NO (generated or text-based past paper):
      Left panel → <ReactMarkdown remarkPlugins={[remarkGfm]}>{set_text}</ReactMarkdown>
        ↓
Right panel (always):
  Question text
  4 MCQ options (OptionButton components)
  Mark for review toggle
  Q1/Q2/Q3/Q4 navigation within the set
```

### Layout

Desktop: split panel — left 55% (data), right 45% (question). Both panels independently scrollable.

Mobile (< 768px): stacked layout. Data setup on top with a collapsible Show/Hide Data toggle. Essential — many CAT aspirants study on phones.

### Generated DILR Rendering

Generated sets use markdown tables rendered via `react-markdown` + `remark-gfm`. Apply Tailwind styling: clean borders, alternating row colors, bold headers. Looks professional — users cannot distinguish from a formatted PDF table.

---

## Phase 7: VARC Display in Exam UI

Same split-panel approach as DILR — no images, simpler.

Left panel: full RC passage as formatted scrollable text. Right panel: question and options. For VA questions with no passage: full-width layout, no split.

---

## Phase 8: Core Exam UI Features

### Timer

CAT timing: 40 minutes per section (sectional), 120 minutes total (full mock). Client-side `useRef` + `setInterval`. Auto-submit on expiry. Timer turns red at 5 minutes remaining. Save progress to Supabase every 60 seconds.

### Question Navigation Grid

Numbered grid matching real CAT interface. Color coding:
- White: unattempted
- Green: attempted
- Orange: marked for review
- Orange with green dot: attempted and marked for review
- Red: unattempted and marked for review

Section tabs (Quant / DILR / VARC) above grid for full mocks. Non-linear navigation — users jump to any question freely.

### Auto-Save on Navigation

Every time a user moves to a different question, save their current answer to Supabase immediately via `/api/mock/progress`. Never rely solely on the end-of-exam submit. A crash mid-exam should lose at most one answer.

---

## Phase 9: Performance Dashboard

Built with `recharts` (most popular React charting library, free, well documented).

Show users:
- Score and percentile per completed mock (summary cards)
- Accuracy trend line chart across last 10 mocks, one line per section
- Weak areas heatmap: topics on Y axis, accuracy on color (red = weak, green = strong)
- Average time per question by section (highlights speed problems)
- Improvement delta: first mock accuracy vs latest
- Top 3 weakest topics with "Practice Now" CTA launching topic-wise practice

---

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Groq — all LLM tasks (free tier)
GROQ_API_KEY=

# Admin protection for ingest API route
ADMIN_INGEST_SECRET=
```

No HuggingFace API key needed — `@huggingface/transformers` runs the model locally.
No OpenAI key. No LlamaParse key. No paid services.

---

## Key Technical Decisions and Rationale

**Why no live embedding on Vercel:** `@huggingface/transformers` downloads a ~274MB model — Vercel serverless functions have a 250MB size limit. Rather than adding a paid or rate-limited embedding API, the architecture eliminates the need for live query embedding entirely. Mock generation uses metadata SQL filters. PYQ search uses Postgres full-text search.

**Why full-text search is not a quality compromise for PYQ:** CAT users search for specific domain terms — "time and work", "blood relations", "para jumbles". These are exact keyword matches, not vague natural language. Postgres `tsvector` + `plainto_tsquery` handles these with high precision. Semantic search would add marginal benefit for this specific query pattern.

**Why @huggingface/transformers for ingestion:** Runs the model entirely locally. No API key, no rate limits, no cost, no network dependency after the first download. Perfect for a one-time batch job running on your machine overnight.

**Why nomic-embed-text-v1.5 specifically:** Best quality open-source embedding model at 768 dimensions. Requires task prefixes (`search_document:` for corpus, `search_query:` for queries) which must be used correctly or quality degrades.

**Why question-level chunking:** Each question is its own vector. Token-level chunking splits questions mid-sentence — retrieval becomes meaningless for this use case.

**Why pgvector over Pinecone:** The anti-repetition filter (`id != all(exclude_ids)`) combined with metadata filtering in one SQL query is impossible in Pinecone. Supabase makes this trivial and keeps everything in one database.

**Why dual storage for image DILR (image URL + text description):** Users need to see the original chart/table image. The LLM needs structured text to generate questions from it. Neither alone is sufficient.

**Why three-tier DILR handling:** Blindly ingesting complex diagrams the vision model cannot parse leads to questions with wrong data context — worse than missing questions. The three-tier approach protects corpus quality.

**Why manual review sampling:** Systematic tagging errors affect thousands of questions silently. 10 minutes reviewing 60 samples catches these before they scale to the full corpus.

**Why checkpoint/resume:** Ingestion takes 2–4 hours. A crash at hour 3 should resume, not restart from the beginning.

**Why batch tagging (10 per call) and batch embedding (32 per call):** Batch tagging reduces Groq calls from ~10,000 to ~1,000 with no quality impact. Batch embedding reduces local embedding calls proportionally with zero quality impact — it is the same mathematical operation.

**Why Groq over OpenRouter free tier:** OpenRouter free models cap at 50 requests per day. Groq free tier gives 14,400 RPD on smaller models and 1,000 RPD on 70b. The difference between a prototype and a usable product.

**Why pdf-parse + pdfjs-dist over LlamaParse:** Both are massively popular open-source npm packages. Any bug you hit has already been solved by the community. LlamaParse is paid, niche, and hard to debug independently.
