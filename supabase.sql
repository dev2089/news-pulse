create extension if not exists pgcrypto;

create table if not exists public.articles (
  id text primary key,
  dedupe_key text unique not null,
  title text not null,
  summary text default '',
  body_text text default '',
  source text not null,
  url text not null,
  published_at timestamptz not null,
  cluster_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.clusters (
  id text primary key,
  label text not null,
  article_count integer not null default 0,
  start_time timestamptz not null,
  end_time timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ingestion_jobs (
  id text primary key,
  status text not null check (status in ('running','completed','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  processed_count integer default 0,
  error text
);

create index if not exists idx_articles_cluster_id on public.articles(cluster_id);
create index if not exists idx_articles_published_at on public.articles(published_at desc);
create index if not exists idx_articles_source on public.articles(source);

alter table public.articles enable row level security;
alter table public.clusters enable row level security;
alter table public.ingestion_jobs enable row level security;

drop policy if exists public_read_articles on public.articles;
create policy public_read_articles on public.articles for select to anon, authenticated using (true);
drop policy if exists public_insert_articles on public.articles;
create policy public_insert_articles on public.articles for insert to anon, authenticated with check (true);
drop policy if exists public_update_articles on public.articles;
create policy public_update_articles on public.articles for update to anon, authenticated using (true) with check (true);
drop policy if exists public_delete_articles on public.articles;
create policy public_delete_articles on public.articles for delete to anon, authenticated using (true);

drop policy if exists public_read_clusters on public.clusters;
create policy public_read_clusters on public.clusters for select to anon, authenticated using (true);
drop policy if exists public_insert_clusters on public.clusters;
create policy public_insert_clusters on public.clusters for insert to anon, authenticated with check (true);
drop policy if exists public_update_clusters on public.clusters;
create policy public_update_clusters on public.clusters for update to anon, authenticated using (true) with check (true);
drop policy if exists public_delete_clusters on public.clusters;
create policy public_delete_clusters on public.clusters for delete to anon, authenticated using (true);

drop policy if exists public_read_jobs on public.ingestion_jobs;
create policy public_read_jobs on public.ingestion_jobs for select to anon, authenticated using (true);
drop policy if exists public_insert_jobs on public.ingestion_jobs;
create policy public_insert_jobs on public.ingestion_jobs for insert to anon, authenticated with check (true);
drop policy if exists public_update_jobs on public.ingestion_jobs;
create policy public_update_jobs on public.ingestion_jobs for update to anon, authenticated using (true) with check (true);
drop policy if exists public_delete_jobs on public.ingestion_jobs;
create policy public_delete_jobs on public.ingestion_jobs for delete to anon, authenticated using (true);

grant select, insert, update, delete on public.articles, public.clusters, public.ingestion_jobs to anon, authenticated;
