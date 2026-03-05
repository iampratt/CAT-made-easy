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
- Route protection via Next.js `proxy.ts` for dashboard/mock/practice/PYQ
- Session-aware navbar with login/signup state and logout action
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
- Run contents of `supabase/migrations/0002_allow_book_type.sql` (if DB was already initialized earlier)
- Create a public storage bucket named `dilr-images`

## Scripts

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm review:pdf --file ./books/cat-2022.pdf --pages 30
pnpm ingest:pdf --file ./books/cat-2022.pdf --section auto --source-type past_paper
pnpm ingest:pdf --file ./books/arun-sharma-quant.pdf --section quant --source-type book
pnpm ingest:dir ./books --section auto --source-type past_paper
pnpm ingest:pdf --file ./books/cat-2022.pdf --dry-run --limit-pages 20
```

Notes:
- Use `--section auto` to infer section from filename (`varc`, `dilr/lrdi`, else `quant`).
- Use `--source-type past_paper` for PYQs and `--source-type book` for Arun Sharma or other prep books.
- Use `--dry-run` to test parsing without DB inserts.
- Use reviewer before full ingest; if >10% flagged, fix parsing/tagging first.
- For lowest ingestion cost: keep tagging on (8b), keep embeddings local, and use `--limit-pages` for trial runs before full ingestion.
- Optional ingest flags: `--skip-tagging`, `--skip-embedding`, `--skip-vision` (use only for debugging).

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
- Generation endpoints run retrieval + Groq generation + verifier loop and persist generated questions into `questions`.

## Next Hardening Steps

1. Add real user session binding in API routes so `userId` is inferred from authenticated session.
2. Add integration tests for `/api/generate/*`, `/api/mock/*`, and `/api/search`.
3. Tighten topic taxonomy mapping during ingestion for cleaner weak-area analytics.
4. Add ingestion QA loop (`scripts/reviewer.ts`) with pass/fail gating.
