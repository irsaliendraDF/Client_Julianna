-- =============================================================================
-- Julianna Systems — Org Health Audit (voice recorder tool)
-- Schema setup for Supabase project: ldxcbztlngbasgtcfbjr
-- Run this once, in the Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS guards.
-- =============================================================================

-- 1) ORGANIZATIONS REGISTRY
-- One row per employer Julianna is auditing. Lets her group responses by
-- client and issue a unique employer_code (e.g. "ACME-2026").
create table if not exists public.organizations (
  id            uuid primary key default gen_random_uuid(),
  employer_code text unique not null,
  employer_name text,
  contact_email text,
  active        boolean default true,
  created_at    timestamptz default now()
);

create index if not exists organizations_employer_code_idx
  on public.organizations (lower(employer_code));


-- 2) AUDIT RESPONSES
-- One row per employee submission. id is generated client-side so we can
-- upload audio files to Storage under the same id before the row is inserted.
create table if not exists public.audit_responses (
  id                 uuid primary key,
  employer_code      text,
  uid                text,                  -- whatever the employee typed on the login screen
  age_range          text,
  gender             text,
  department         text,
  tenure             text,
  role_level         text,

  -- 8 satisfaction ratings (1-10)
  rating_policy      int,
  rating_mgr         int,
  rating_exec        int,
  rating_dir         int,
  rating_support     int,
  rating_resources   int,
  rating_culture     int,
  rating_benefits    int,

  -- 6 voice transcripts
  voice_avg_day      text,
  voice_avg_week     text,
  voice_strengths    text,
  voice_weaknesses   text,
  voice_change_one   text,
  voice_keep_one     text,

  report             jsonb,    -- the Claude-generated three-lens report
  audio_paths        jsonb,    -- { vq1: "<uuid>/vq1.webm", ... }
  consent_timestamp  timestamptz,
  user_agent         text,
  created_at         timestamptz default now()
);

create index if not exists audit_responses_created_at_idx
  on public.audit_responses (created_at desc);
create index if not exists audit_responses_employer_code_idx
  on public.audit_responses (lower(employer_code));


-- 3) ROW LEVEL SECURITY
-- anon role: INSERT only on audit_responses. No SELECT/UPDATE/DELETE.
-- organizations is fully locked down for anon (Julianna manages it from the dashboard).
alter table public.audit_responses enable row level security;
alter table public.organizations   enable row level security;

drop policy if exists "anon can insert audit_responses" on public.audit_responses;
create policy "anon can insert audit_responses"
  on public.audit_responses
  for insert
  to anon
  with check (true);

-- (No anon policy on organizations — only the service role + dashboard can read/write.)


-- 4) STORAGE BUCKET FOR AUDIO
-- IMPORTANT: Create the `audit-audio` bucket through the Supabase Dashboard UI
-- (Storage -> New bucket -> name "audit-audio", Public OFF), NOT via SQL.
-- Creating it via `insert into storage.buckets ...` produces a bucket where
-- direct DB inserts as anon work but the Storage server upload API still
-- returns "new row violates row-level security policy". The dashboard sets
-- additional internal scaffolding the server requires. (Verified 2026-05-14.)
--
-- After the bucket is created via the dashboard, the policies below apply
-- correctly and uploads succeed.

-- Note: target `anon, authenticated` explicitly. `to public` *should* mean
-- "all roles" in Postgres RLS, but on this project's storage.objects table the
-- public form was not being honored at runtime (direct INSERTs as the anon
-- role were rejected with "new row violates row-level security policy" even
-- though pg_policies showed roles={public}). Explicit role targeting works.
drop policy if exists "anon can upload audit audio" on storage.objects;
drop policy if exists "audit audio upload"          on storage.objects;
drop policy if exists "audit audio overwrite"       on storage.objects;
drop policy if exists "audit_audio_insert"          on storage.objects;
drop policy if exists "audit_audio_update"          on storage.objects;
drop policy if exists "audit_audio_anon_all"        on storage.objects;

create policy "audit_audio_anon_all"
  on storage.objects
  for all
  to anon, authenticated
  using (bucket_id = 'audit-audio')
  with check (bucket_id = 'audit-audio');


-- =============================================================================
-- Done. To verify:
--   select count(*) from public.audit_responses;
--   select * from storage.buckets where id = 'audit-audio';
-- =============================================================================
