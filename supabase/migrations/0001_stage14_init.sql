-- LATISA (TRIPILOT) stage 14, migration 0001: accounts, trips, sharing, sync.
-- The owner runs this ONCE in the Supabase dashboard > SQL Editor (Free plan). No secret key is needed or used.
-- Security rests on RLS only: every table has RLS on, anon gets nothing, pending and blocked users get nothing
-- except their own profile row (so the app can say "waiting for approval"). The app calls only the functions below.
-- Ids of trips and records are TEXT: the app makes them with crypto.randomUUID, but older phones may hold fallback
-- ids that are not UUIDs (src/js/core/ids.js). User ids are auth.users UUIDs.
-- Tests: supabase/tests/rls_check.sql (owner, in the real project) and scripts/qa/stage14-rls-local.cjs (local).

begin;

-- =====================================================================================================
-- Tables
-- =====================================================================================================

-- One row per auth user, created by a trigger. role and status change only by hand (owner) or admin_set_status.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null default '' check (char_length(display_name) <= 30),
  phone        text check (phone is null or char_length(phone) <= 20),          -- optional, never used to sign in
  role         text not null default 'user'    check (role in ('user', 'admin')),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The cloud copy of a trip's header. Name, country and dates are shared, and only the owner changes them.
create table public.trips (
  id           text primary key check (char_length(id) between 1 and 64),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  name         text not null default '' check (char_length(name) <= 80),
  country_code text not null default '' check (char_length(country_code) <= 8),
  start_date   date,
  end_date     date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (start_date is null or end_date is null or end_date >= start_date)
);

-- Who sees which trip. Rows are added and removed only through share_trip / unshare_trip / leave_trip.
create table public.trip_members (
  trip_id  text not null references public.trips (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  role     text not null default 'member' check (role in ('owner', 'member')),
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index trip_members_user_idx on public.trip_members (user_id);

-- Trip content, one row per record (a stop, a place, an expense, the budget ...).
-- scope = 'shared' (every member) or the owner's user id as text (personal: that user only).
-- Records are never deleted by the app: deleted = true is a tombstone, so a failed sync can never erase data.
-- edited_at = when the user made the change (device clock), for last-write-wins. server_at = pull cursor.
create table public.trip_records (
  trip_id    text not null references public.trips (id) on delete cascade,
  scope      text not null check (scope = 'shared' or scope ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  kind       text not null check (kind ~ '^[a-z][a-z0-9:-]{0,39}$'),
  rec_id     text not null check (char_length(rec_id) between 1 and 64),
  data       jsonb not null default '{}'::jsonb,
  deleted    boolean not null default false,
  edited_at  timestamptz not null,
  server_at  timestamptz not null default clock_timestamp(),
  updated_by uuid references public.profiles (id) on delete set null,
  primary key (trip_id, scope, kind, rec_id),
  check (pg_column_size(data) <= 65536)
);
create index trip_records_pull_idx on public.trip_records (trip_id, server_at);

-- Settings that follow the account (language, assistant limit). Theme and backup date stay on each device.
create table public.user_settings (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  data      jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 8192),
  edited_at timestamptz not null default now(),
  server_at timestamptz not null default clock_timestamp()
);

-- =====================================================================================================
-- Helpers (SECURITY DEFINER so policies can read profiles/members without recursion; search_path pinned)
-- =====================================================================================================
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.status = 'approved');
$$;
create function public.is_approved() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved');
$$;
create function public.is_trip_member(t text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trip_members m where m.trip_id = t and m.user_id = auth.uid());
$$;
create function public.is_trip_owner(t text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trips x where x.id = t and x.owner_id = auth.uid());
$$;

-- =====================================================================================================
-- Triggers
-- =====================================================================================================
-- A new user always starts 'pending' with role 'user'. The sign-up form may pass a name and phone (optional).
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name, phone)
  values (new.id, lower(coalesce(new.email, '')),
          left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 30),
          nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), 20), ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger trips_touch    before update on public.trips    for each row execute function public.touch_updated_at();

create function public.stamp_record() returns trigger language plpgsql set search_path = '' as $$
begin new.server_at := clock_timestamp(); new.updated_by := auth.uid(); return new; end $$;
create trigger trip_records_stamp before insert or update on public.trip_records for each row execute function public.stamp_record();

create function public.stamp_settings() returns trigger language plpgsql set search_path = '' as $$
begin new.server_at := clock_timestamp(); return new; end $$;
create trigger user_settings_stamp before insert or update on public.user_settings for each row execute function public.stamp_settings();

create function public.add_owner_member() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.trip_members (trip_id, user_id, role, added_by) values (new.id, new.owner_id, 'owner', new.owner_id);
  return new;
end $$;
create trigger trips_owner_member after insert on public.trips for each row execute function public.add_owner_member();

-- =====================================================================================================
-- Functions the app calls. SECURITY INVOKER unless noted, so every row still passes the RLS policies below.
-- =====================================================================================================
create function public.my_profile() returns table (id uuid, email text, display_name text, phone text, role text, status text)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.email, p.display_name, p.phone, p.role, p.status from public.profiles p where p.id = auth.uid();
$$;

create function public.update_my_profile(p_name text, p_phone text) returns void
language sql security invoker set search_path = '' as $$
  update public.profiles set display_name = left(btrim(coalesce(p_name, '')), 30), phone = nullif(left(btrim(coalesce(p_phone, '')), 20), '')
  where id = auth.uid();
$$;

create function public.my_trips() returns table (id text, owner_id uuid, name text, country_code text, start_date date, end_date date, updated_at timestamptz, my_role text)
language sql stable security invoker set search_path = '' as $$
  select x.id, x.owner_id, x.name, x.country_code, x.start_date, x.end_date, x.updated_at, m.role
  from public.trips x join public.trip_members m on m.trip_id = x.id and m.user_id = auth.uid()
  order by x.created_at;
$$;

-- 'created', 'exists' (already mine: a repeated upload is harmless) or 'taken' (someone else's id).
create function public.create_trip(t text, p_name text, p_cc text, p_start date, p_end date) returns text
language plpgsql security invoker set search_path = '' as $$
declare n int;
begin
  if not public.is_approved() then raise exception 'not_allowed'; end if;
  insert into public.trips (id, owner_id, name, country_code, start_date, end_date)
  values (t, auth.uid(), left(coalesce(p_name, ''), 80), left(coalesce(p_cc, ''), 8), p_start, p_end)
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  if n = 1 then return 'created'; end if;
  if public.is_trip_owner(t) then return 'exists'; end if;
  return 'taken';
end $$;

-- Only the owner: the policy hides the row from everyone else, so they get false.
create function public.update_trip(t text, p_name text, p_cc text, p_start date, p_end date) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  update public.trips set name = left(coalesce(p_name, ''), 80), country_code = left(coalesce(p_cc, ''), 8), start_date = p_start, end_date = p_end
  where id = t and owner_id = auth.uid();
  return found;
end $$;

create function public.pull_records(t text, since timestamptz)
returns table (trip_id text, scope text, kind text, rec_id text, data jsonb, deleted boolean, edited_at timestamptz, server_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select r.trip_id, r.scope, r.kind, r.rec_id, r.data, r.deleted, r.edited_at, r.server_at
  from public.trip_records r
  where r.trip_id = t and r.server_at > coalesce(since, '-infinity'::timestamptz)
  order by r.server_at, r.kind, r.rec_id
  limit 1000;
$$;

-- Last write wins: a row is written only when its edited_at is not older than the stored one. Each answer row says
-- whether that row was stored; the app keeps a losing copy on the phone and shows a notice.
create function public.push_records(rows jsonb) returns table (trip_id text, scope text, kind text, rec_id text, accepted boolean)
language plpgsql security invoker set search_path = '' as $$
declare r jsonb; n int;
begin
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 500 then raise exception 'bad_batch'; end if;
  for r in select * from jsonb_array_elements(rows) loop
    insert into public.trip_records as x (trip_id, scope, kind, rec_id, data, deleted, edited_at)
    values (r->>'trip_id', r->>'scope', r->>'kind', r->>'rec_id', coalesce(r->'data', '{}'::jsonb),
            coalesce((r->>'deleted')::boolean, false), (r->>'edited_at')::timestamptz)
    on conflict on constraint trip_records_pkey do update
      set data = excluded.data, deleted = excluded.deleted, edited_at = excluded.edited_at
      where x.edited_at <= excluded.edited_at;
    get diagnostics n = row_count;
    trip_id := r->>'trip_id'; scope := r->>'scope'; kind := r->>'kind'; rec_id := r->>'rec_id'; accepted := n > 0;
    return next;
  end loop;
end $$;

create function public.get_settings() returns table (data jsonb, edited_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select s.data, s.edited_at from public.user_settings s where s.user_id = auth.uid();
$$;

create function public.save_settings(p_data jsonb, p_edited timestamptz) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.user_settings as s (user_id, data, edited_at) values (auth.uid(), coalesce(p_data, '{}'::jsonb), p_edited)
  on conflict (user_id) do update set data = excluded.data, edited_at = excluded.edited_at where s.edited_at <= excluded.edited_at;
  return found;
end $$;

-- Sharing by email (SECURITY DEFINER: it must find the friend's profile). Only the approved owner, only with an
-- approved user; the answer never tells whether an email exists, is pending or is blocked.
create function public.share_trip(t text, friend_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare friend uuid;
begin
  if not public.is_approved() or not public.is_trip_owner(t) then raise exception 'not_allowed'; end if;
  select p.id into friend from public.profiles p where p.email = lower(btrim(friend_email)) and p.status = 'approved';
  if friend is null then return 'not_found'; end if;
  insert into public.trip_members (trip_id, user_id, role, added_by) values (t, friend, 'member', auth.uid()) on conflict do nothing;
  return 'ok';
end $$;

create function public.unshare_trip(t text, friend uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_admin() or (public.is_approved() and public.is_trip_owner(t))) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.trip_members m where m.trip_id = t and m.user_id = friend and m.role = 'member') then
    raise exception 'not_a_member';
  end if;
  delete from public.trip_members where trip_id = t and user_id = friend and role = 'member';
end $$;

create function public.leave_trip(t text) returns void
language sql security definer set search_path = '' as $$
  delete from public.trip_members where trip_id = t and user_id = auth.uid() and role = 'member';
$$;

-- Members of a trip. Everyone on the trip sees names; only the owner, the admin and the person themself see emails.
create function public.trip_people(t text) returns table (user_id uuid, display_name text, email text, role text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.display_name,
         case when public.is_admin() or public.is_trip_owner(t) or m.user_id = auth.uid() then p.email else null end,
         m.role
  from public.trip_members m join public.profiles p on p.id = m.user_id
  where m.trip_id = t and (public.is_admin() or (public.is_approved() and public.is_trip_member(t)))
  order by m.added_at;
$$;

-- Admin only (SECURITY DEFINER with an explicit check). The app loads its admin screen only for an admin.
create function public.admin_list_users() returns table (id uuid, email text, display_name text, phone text, role text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  return query select p.id, p.email, p.display_name, p.phone, p.role, p.status, p.created_at from public.profiles p order by p.created_at;
end $$;

create function public.admin_list_trips() returns table (id text, name text, owner_email text, start_date date, end_date date, members jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  return query
    select x.id, x.name, o.email, x.start_date, x.end_date,
           coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', p.email, 'role', m.role) order by m.added_at)
                     from public.trip_members m join public.profiles p on p.id = m.user_id where m.trip_id = x.id), '[]'::jsonb)
    from public.trips x join public.profiles o on o.id = x.owner_id
    order by x.created_at;
end $$;

-- Approve / block / back to pending. Never the admin's own row, never an admin, and never the role.
create function public.admin_set_status(target uuid, new_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  if target = auth.uid() then raise exception 'not_self'; end if;
  if new_status not in ('pending', 'approved', 'blocked') then raise exception 'bad_status'; end if;
  update public.profiles set status = new_status where id = target and role = 'user';
end $$;

-- ==== SECURITY (RLS, privileges, policies) ===========================================================
alter table public.profiles      enable row level security;
alter table public.trips         enable row level security;
alter table public.trip_members  enable row level security;
alter table public.trip_records  enable row level security;
alter table public.user_settings enable row level security;

revoke all on public.profiles, public.trips, public.trip_members, public.trip_records, public.user_settings from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, phone) on public.profiles to authenticated;          -- never role / status / email
grant select, insert, update (name, country_code, start_date, end_date) on public.trips to authenticated;
grant select on public.trip_members to authenticated;
grant select, insert, update on public.trip_records to authenticated;           -- no delete: tombstones only
grant select, insert, update on public.user_settings to authenticated;

-- profiles: own row (even while pending); the admin reads all.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- trips: approved members read; an approved user creates trips they own; only the owner changes them.
-- (owner_id = me is needed too: INSERT ... ON CONFLICT checks the new row against this policy before the
-- trigger adds the owner as a member.)
create policy trips_select on public.trips for select to authenticated
  using ((select public.is_admin())
     or ((select public.is_approved()) and (owner_id = (select auth.uid()) or public.is_trip_member(id))));
create policy trips_insert on public.trips for insert to authenticated
  with check ((select public.is_approved()) and owner_id = (select auth.uid()));
create policy trips_update on public.trips for update to authenticated
  using ((select public.is_approved()) and owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- trip_members: approved members see who is on their trip; changes only through the functions above.
create policy members_select on public.trip_members for select to authenticated
  using ((select public.is_admin()) or ((select public.is_approved()) and public.is_trip_member(trip_id)));

-- trip_records: approved members read and write shared records and their own personal ones; the admin reads all.
create policy records_select on public.trip_records for select to authenticated
  using ((select public.is_admin())
     or ((select public.is_approved()) and public.is_trip_member(trip_id)
         and (scope = 'shared' or scope = (select auth.uid())::text)));
create policy records_insert on public.trip_records for insert to authenticated
  with check ((select public.is_approved()) and public.is_trip_member(trip_id)
         and (scope = 'shared' or scope = (select auth.uid())::text));
create policy records_update on public.trip_records for update to authenticated
  using ((select public.is_approved()) and public.is_trip_member(trip_id)
         and (scope = 'shared' or scope = (select auth.uid())::text))
  with check ((select public.is_approved()) and public.is_trip_member(trip_id)
         and (scope = 'shared' or scope = (select auth.uid())::text));

-- user_settings: own row only, approved users.
create policy settings_all on public.user_settings for all to authenticated
  using ((select public.is_approved()) and user_id = (select auth.uid()))
  with check ((select public.is_approved()) and user_id = (select auth.uid()));

-- Functions: nobody without a sign-in; signed-in users only these.
revoke all on function
  public.is_admin(), public.is_approved(), public.is_trip_member(text), public.is_trip_owner(text),
  public.handle_new_user(), public.touch_updated_at(), public.stamp_record(), public.stamp_settings(), public.add_owner_member(),
  public.my_profile(), public.update_my_profile(text, text), public.my_trips(), public.create_trip(text, text, text, date, date),
  public.update_trip(text, text, text, date, date), public.pull_records(text, timestamptz), public.push_records(jsonb),
  public.get_settings(), public.save_settings(jsonb, timestamptz), public.share_trip(text, text), public.unshare_trip(text, uuid),
  public.leave_trip(text), public.trip_people(text), public.admin_list_users(), public.admin_list_trips(),
  public.admin_set_status(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.is_admin(), public.is_approved(), public.is_trip_member(text), public.is_trip_owner(text),
  public.my_profile(), public.update_my_profile(text, text), public.my_trips(), public.create_trip(text, text, text, date, date),
  public.update_trip(text, text, text, date, date), public.pull_records(text, timestamptz), public.push_records(jsonb),
  public.get_settings(), public.save_settings(jsonb, timestamptz), public.share_trip(text, text), public.unshare_trip(text, uuid),
  public.leave_trip(text), public.trip_people(text), public.admin_list_users(), public.admin_list_trips(),
  public.admin_set_status(uuid, text)
to authenticated;

commit;

-- After you sign up in the app with YOUR email, run this ONE line by hand (it is the only way to make an admin;
-- never commit your email to Git):
--   update public.profiles set role = 'admin', status = 'approved' where email = lower('YOUR-EMAIL-HERE');
