# CAT Mock Generator (Next.js 16)

Deploy-ready CAT preparation platform with personalized mock generation, PYQ full-text search, Supabase-backed persistence, and local ingestion scripts.

## Stack

- Next.js 16 (App Router)
- TypeScript + ESLint
- Supabase (Auth, Postgres, pgvector, Storage)
- Groq (generation + verification model hooks)
- LangChain.js
- Recharts, react-markdown, remark-gfm

## Features Implemented

- Auth pages for email/password login and signup
- Dashboard with score cards and trend chart
- Mock config flow (`full`, `section`, `topic`)
- Live exam UI with timer, question navigation, mark-for-review, progress save, submit
- Results page
- PYQ search UI + API route
- Supabase SQL migration with:
  - core tables
  - vector + FTS indexes
  - SQL functions (`get_questions_for_mock`, `match_questions_semantic`, `search_pyq`)
  - starter RLS policies
- Ingestion script scaffolds (`reviewer`, `ingest`, parser/splitter/embedder/upload/checkpoint modules)

## Project Structure

- `app/` routes, pages, API handlers
- `components/` exam and dashboard UI
- `lib/` env, Supabase clients, chains, personalization, scoring
- `scripts/` local ingestion pipeline scripts (run via `pnpm`)
- `supabase/migrations/0001_init.sql` database schema + functions
- `types/` domain types

## Local Setup

1. Install deps:

```bash
pnpm install --store-dir /Users/pratt/Library/pnpm/store/v10
```

2. Create env file:

```bash
cp .env.example .env.local
```

3. Fill all required variables in `.env.local`.

4. Start dev server:

```bash
pnpm dev
```

5. Apply SQL migration in Supabase SQL editor:

- Run contents of `supabase/migrations/0001_init.sql`
- Create a public storage bucket named `dilr-images`

## Scripts

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm review:pdf --file ./books/cat-2022.pdf
pnpm ingest:pdf --file ./books/cat-2022.pdf --section quant
```

## Deployment (Vercel)

1. Push this repo to GitHub.
2. Import project in Vercel.
3. Set all environment variables from `.env.example`.
4. Deploy.

Recommended build command:

```bash
pnpm build
```

## Important Notes

- Ingestion is designed to run locally, not on Vercel.
- Live query embedding is intentionally avoided in runtime APIs; retrieval is metadata + full-text based.
- Current generation endpoints create DB-backed mock payloads and are ready for replacing placeholders with production chain outputs.

## Next Hardening Steps

1. Replace placeholder question generation in `lib/mockRepo.ts` with full retrieval + Groq generation + verification chain.
2. Add real user session binding in API routes (instead of fallback user ID).
3. Add integration tests for `/api/generate/*`, `/api/mock/*`, and `/api/search`.
4. Add ingestion QA loop (`scripts/reviewer.ts`) with pass/fail gating.
