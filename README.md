# CAT Mock Generator (Next.js 16)

CAT prep platform with a corpus-first mock engine, adaptive weak-area weighting, and a gated PDF ingestion pipeline.

## Core Capabilities

- Strict CAT-style full mock blueprint: `66` questions (`VARC 24`, `DILR 20`, `QA 22`)
- Hybrid generation strategy:
  - Uses verified corpus questions first
  - Fills only shortfall slots with generated questions
- Adaptive allocation by `section + topic + subtype + difficulty`
- Ingestion reliability pipeline:
  - deterministic extraction
  - page confidence scoring
  - optional external parser fallback (LlamaParse)
  - strict quality gate before publish
- Rich provenance on each question (`origin`, confidence, source page, ingestion run)
- Exam runtime captures per-question timing and interaction events

## Stack

- Next.js 16 (App Router)
- TypeScript + ESLint
- Supabase (Auth, Postgres, pgvector, Storage)
- Groq (tagging, solving, generation/verification)
- LangChain.js

## Migrations

Run all migrations in order:

- [0001_init.sql](/Users/pratt/Documents/Projects/CAT2/supabase/migrations/0001_init.sql)
- [0002_allow_book_type.sql](/Users/pratt/Documents/Projects/CAT2/supabase/migrations/0002_allow_book_type.sql)
- [0003_adaptive_rebuild.sql](/Users/pratt/Documents/Projects/CAT2/supabase/migrations/0003_adaptive_rebuild.sql)

## Environment

Copy [`.env.example`](/Users/pratt/Documents/Projects/CAT2/.env.example) to `.env.local` and fill values.

Key variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GROQ_API_KEY`
- `ADMIN_INGEST_SECRET`
- Optional external parse fallback:
  - `LLAMA_CLOUD_API_KEY`
  - `LLAMA_PARSE_MODE=fast|premium`

## Local Commands

```bash
pnpm dev
pnpm typecheck
pnpm lint

# Review + ingest
pnpm review:pdf --file "./books/CAT 2021-Slot-1- With Answer.pdf"
pnpm ingest:pdf --file "./books/CAT 2021-Slot-1- With Answer.pdf" --section auto --source-type past_paper --strict-gate
pnpm ingest:dir ./books --section auto --source-type past_paper --strict-gate

# Validation scripts
pnpm test:answer-parser
pnpm check:golden-ingest
```

## New Admin Ingestion APIs

All require `x-admin-secret: <ADMIN_INGEST_SECRET>`.

- `POST /api/ingest/run` -> create ingestion run
- `GET /api/ingest/run/:id` -> run quality summary + issues
- `POST /api/ingest/run/:id/approve` -> mark run as published if no blocking issues

## Mock Generation APIs

`POST /api/generate/mock` now accepts:

- `blueprintId` (optional)
- `strictRealFirst` (default `true`)
- `allowGeneratedFill` (default `true`)

Config persisted in `mocks.config` includes:

- `blueprint`
- `allocationPlan`
- `generatedFillCount`
- `durationSeconds`

## Notes

- Ingestion scripts are intended for local execution.
- Runtime search uses full-text and metadata retrieval; embeddings remain optional support data.
- Questions with low answer/extraction confidence are marked unverified and excluded from strict corpus selection.
