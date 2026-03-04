create extension if not exists vector;

create table if not exists questions (
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
  set_id uuid,
  set_text text,
  set_image_url text,
  set_image_type text,
  passage_text text,
  embedding vector(768),
  text_hash text,
  text_search tsvector generated always as (
    to_tsvector('english', coalesce(text, '') || ' ' || coalesce(topic, '') || ' ' || coalesce(source, ''))
  ) stored,
  created_at timestamp default now()
);

create index if not exists questions_text_search_idx on questions using gin(text_search);
create index if not exists questions_meta_idx on questions(section, topic, difficulty, type);
create index if not exists questions_embedding_idx on questions using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table if not exists users (
  id uuid primary key references auth.users,
  name text,
  target_percentile int default 90,
  created_at timestamp default now()
);

create table if not exists mocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  type text check (type in ('full', 'section', 'topic')),
  config jsonb,
  question_ids jsonb,
  question_payload jsonb,
  progress jsonb,
  score jsonb,
  percentile float,
  completed_at timestamp,
  created_at timestamp default now()
);

create table if not exists user_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  question_id uuid references questions(id),
  mock_id uuid references mocks(id),
  selected_answer text,
  is_correct boolean,
  time_taken_seconds int,
  attempted_at timestamp default now()
);

create table if not exists user_topic_performance (
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

create table if not exists ingestion_checkpoints (
  id uuid primary key default gen_random_uuid(),
  file_name text not null unique,
  last_processed_page int default 0,
  total_pages int,
  questions_ingested int default 0,
  status text check (status in ('running', 'completed', 'failed')),
  started_at timestamp default now(),
  updated_at timestamp default now()
);

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
    and (exclude_ids is null or id != all(exclude_ids))
  order by random()
  limit match_count;
$$;

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
    and (exclude_ids is null or id != all(exclude_ids))
  order by embedding <=> query_embedding
  limit match_count;
$$;

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

alter table users enable row level security;
alter table mocks enable row level security;
alter table user_attempts enable row level security;
alter table user_topic_performance enable row level security;

create policy if not exists users_select_own on users
  for select using (auth.uid() = id);
create policy if not exists users_update_own on users
  for update using (auth.uid() = id);
create policy if not exists users_insert_own on users
  for insert with check (auth.uid() = id);

create policy if not exists mocks_select_own on mocks
  for select using (auth.uid() = user_id);
create policy if not exists mocks_write_own on mocks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists attempts_select_own on user_attempts
  for select using (auth.uid() = user_id);
create policy if not exists attempts_write_own on user_attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists perf_select_own on user_topic_performance
  for select using (auth.uid() = user_id);
create policy if not exists perf_write_own on user_topic_performance
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
