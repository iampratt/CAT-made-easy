create table if not exists ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_file text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'failed', 'gated', 'approved', 'published')),
  total_pages int default 0,
  pages_processed int default 0,
  questions_extracted int default 0,
  questions_published int default 0,
  quality_summary jsonb,
  started_at timestamp default now(),
  completed_at timestamp,
  approved_at timestamp,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

create table if not exists ingestion_issues (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references ingestion_runs(id) on delete cascade,
  file_name text not null,
  page_no int,
  severity text not null check (severity in ('warning', 'error')),
  code text not null,
  detail text not null,
  meta jsonb,
  created_at timestamp default now()
);

create table if not exists question_groups (
  id uuid primary key default gen_random_uuid(),
  section text check (section in ('quant', 'dilr', 'varc')),
  group_type text not null check (group_type in ('dilr_set', 'rc_passage', 'none')),
  title text,
  group_text text,
  source_page int,
  ingestion_run_id uuid references ingestion_runs(id) on delete set null,
  created_at timestamp default now()
);

alter table questions add column if not exists exam_year int;
alter table questions add column if not exists slot int;
alter table questions add column if not exists question_no int;
alter table questions add column if not exists subtype text default 'generic';
alter table questions add column if not exists answer_confidence float default 0;
alter table questions add column if not exists extraction_confidence float default 0;
alter table questions add column if not exists is_verified boolean default false;
alter table questions add column if not exists source_page int;
alter table questions add column if not exists source_bbox_json jsonb;
alter table questions add column if not exists ingestion_run_id uuid references ingestion_runs(id) on delete set null;
alter table questions add column if not exists group_id uuid references question_groups(id) on delete set null;
alter table questions add column if not exists origin text default 'corpus';

alter table questions drop constraint if exists questions_origin_check;
alter table questions add constraint questions_origin_check check (origin in ('corpus', 'generated'));

update questions
set answer_confidence = coalesce(answer_confidence, 0.9),
    extraction_confidence = coalesce(extraction_confidence, 0.9),
    is_verified = coalesce(is_verified, true),
    origin = coalesce(origin, case when type = 'generated' then 'generated' else 'corpus' end);

create index if not exists questions_quality_idx on questions(is_verified, answer_confidence, extraction_confidence);
create index if not exists questions_allocation_idx on questions(section, topic, subtype, difficulty, is_verified);
create index if not exists questions_origin_idx on questions(origin);
create index if not exists questions_ingestion_run_idx on questions(ingestion_run_id);

alter table user_topic_performance add column if not exists subtype text default 'generic';
alter table user_topic_performance add column if not exists last_attempted_at timestamp;

alter table user_topic_performance drop constraint if exists user_topic_performance_user_id_section_topic_key;
alter table user_topic_performance
  add constraint user_topic_performance_user_id_section_topic_subtype_key unique (user_id, section, topic, subtype);

create table if not exists user_question_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  mock_id uuid references mocks(id),
  question_id uuid references questions(id),
  event_type text not null check (event_type in ('view', 'answer', 'mark', 'unmark', 'navigate')),
  time_spent_seconds int,
  payload jsonb,
  created_at timestamp default now()
);

create index if not exists user_question_events_user_mock_idx on user_question_events(user_id, mock_id);

alter table user_question_events enable row level security;

drop policy if exists events_select_own on user_question_events;
create policy events_select_own on user_question_events
  for select using (auth.uid() = user_id);

drop policy if exists events_write_own on user_question_events;
create policy events_write_own on user_question_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function get_questions_for_mock_v2(
  match_section text,
  match_topic text,
  match_subtype text,
  match_difficulty text,
  exclude_ids uuid[],
  require_verified boolean,
  min_answer_confidence float,
  min_extraction_confidence float,
  match_count int
)
returns table (
  id uuid,
  text text,
  options jsonb,
  correct_answer text,
  explanation text,
  topic text,
  subtype text,
  difficulty text,
  source text,
  type text,
  set_id uuid,
  set_text text,
  set_image_url text,
  passage_text text,
  group_id uuid,
  question_no int,
  answer_confidence float,
  extraction_confidence float,
  is_verified boolean,
  source_page int,
  origin text
)
language sql stable
as $$
  select
    q.id,
    q.text,
    q.options,
    q.correct_answer,
    q.explanation,
    q.topic,
    q.subtype,
    q.difficulty,
    q.source,
    q.type,
    q.set_id,
    q.set_text,
    q.set_image_url,
    q.passage_text,
    q.group_id,
    q.question_no,
    q.answer_confidence,
    q.extraction_confidence,
    q.is_verified,
    q.source_page,
    q.origin
  from questions q
  where
    q.section = match_section
    and (match_topic is null or q.topic = match_topic)
    and (match_subtype is null or q.subtype = match_subtype)
    and (match_difficulty is null or q.difficulty = match_difficulty)
    and (exclude_ids is null or q.id != all(exclude_ids))
    and (require_verified is false or q.is_verified = true)
    and (min_answer_confidence is null or coalesce(q.answer_confidence, 0) >= min_answer_confidence)
    and (min_extraction_confidence is null or coalesce(q.extraction_confidence, 0) >= min_extraction_confidence)
  order by random()
  limit match_count;
$$;
