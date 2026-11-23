-- LOCAL TESTS ONLY. Never run this in a Supabase project: Supabase already has these roles, schema and function.
-- A minimal stand-in for Supabase's auth schema and API roles, so the migration and rls_check.sql can run on a plain
-- local PostgreSQL (scripts/qa/stage14-rls-local.cjs). auth.uid() reads the request claims the same way Supabase does.
-- What this does NOT reproduce: PostgREST, GoTrue, JWT signatures, the real auth.users table. A pass here is not
-- proof that a real project is secure; the owner runs rls_check.sql in the real project for that.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase gives the API roles default privileges on new tables in public; the migration must revoke what it does
-- not want. Reproduce that here, so a forgotten revoke fails the local test too.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
