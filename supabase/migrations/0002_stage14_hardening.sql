-- LATISA (TRIPILOT) stage 14, migration 0002: hardening after the Supabase advisors on the real project (2026-11-23).
-- Run once, after 0001. It changes no data and no behaviour of the app; tests: supabase/tests/rls_check.sql (N05-N07).
-- 1. The four policy helpers move out of the API schema (public) into "private", which the API does not expose:
--    signed-in users could call them over /rest/v1/rpc/ (harmless answers about themselves, but no reason to).
--    The policies and the functions that use them are switched to private.*, then the public copies are dropped.
-- 2. admin_list_users / admin_list_trips run with the caller's rights (SECURITY INVOKER): RLS already lets an approved
--    admin read profiles, trips and members, and they still check is_admin() first.
--    What stays SECURITY DEFINER, on purpose and with its own checks: share_trip, unshare_trip, leave_trip,
--    trip_people, admin_set_status (each needs to read or change a row the caller's RLS does not reach).
-- 3. Indexes for three foreign keys (advisor: unindexed foreign keys).

begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.status = 'approved');
$$;
create function private.is_approved() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved');
$$;
create function private.is_trip_member(t text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trip_members m where m.trip_id = t and m.user_id = auth.uid());
$$;
create function private.is_trip_owner(t text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trips x where x.id = t and x.owner_id = auth.uid());
$$;
revoke all on function private.is_admin(), private.is_approved(), private.is_trip_member(text), private.is_trip_owner(text) from public, anon;
grant execute on function private.is_admin(), private.is_approved(), private.is_trip_member(text), private.is_trip_owner(text) to authenticated;

-- ---------- policies: same rules, helpers from private ----------
alter policy profiles_select on public.profiles
  using (id = (select auth.uid()) or (select private.is_admin()));
alter policy trips_select on public.trips
  using ((select private.is_admin())
     or ((select private.is_approved()) and (owner_id = (select auth.uid()) or private.is_trip_member(id))));
alter policy trips_insert on public.trips
  with check ((select private.is_approved()) and owner_id = (select auth.uid()));
alter policy trips_update on public.trips
  using ((select private.is_approved()) and owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
alter policy members_select on public.trip_members
  using ((select private.is_admin()) or ((select private.is_approved()) and private.is_trip_member(trip_id)));
alter policy records_select on public.trip_records
  using ((select private.is_admin())
     or ((select private.is_approved()) and private.is_trip_member(trip_id)
         and (scope = 'shared' or scope = (select auth.uid())::text)));
alter policy records_insert on public.trip_records
  with check ((select private.is_approved()) and private.is_trip_member(trip_id)
         and (scope = 'shared' or scope = (select auth.uid())::text));
alter policy records_update on public.trip_records
  using ((select private.is_approved()) and private.is_trip_member(trip_id)
         and (scope = 'shared' or scope = (select auth.uid())::text))
  with check ((select private.is_approved()) and private.is_trip_member(trip_id)
         and (scope = 'shared' or scope = (select auth.uid())::text));
alter policy settings_all on public.user_settings
  using ((select private.is_approved()) and user_id = (select auth.uid()))
  with check ((select private.is_approved()) and user_id = (select auth.uid()));

-- ---------- functions that used the helpers: same behaviour, helpers from private ----------
create or replace function public.create_trip(t text, p_name text, p_cc text, p_start date, p_end date) returns text
language plpgsql security invoker set search_path = '' as $$
declare n int;
begin
  if not private.is_approved() then raise exception 'not_allowed'; end if;
  insert into public.trips (id, owner_id, name, country_code, start_date, end_date)
  values (t, auth.uid(), left(coalesce(p_name, ''), 80), left(coalesce(p_cc, ''), 8), p_start, p_end)
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  if n = 1 then return 'created'; end if;
  if private.is_trip_owner(t) then return 'exists'; end if;
  return 'taken';
end $$;

create or replace function public.share_trip(t text, friend_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare friend uuid;
begin
  if not private.is_approved() or not private.is_trip_owner(t) then raise exception 'not_allowed'; end if;
  select p.id into friend from public.profiles p where p.email = lower(btrim(friend_email)) and p.status = 'approved';
  if friend is null then return 'not_found'; end if;
  insert into public.trip_members (trip_id, user_id, role, added_by) values (t, friend, 'member', auth.uid()) on conflict do nothing;
  return 'ok';
end $$;

create or replace function public.unshare_trip(t text, friend uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_admin() or (private.is_approved() and private.is_trip_owner(t))) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.trip_members m where m.trip_id = t and m.user_id = friend and m.role = 'member') then
    raise exception 'not_a_member';
  end if;
  delete from public.trip_members where trip_id = t and user_id = friend and role = 'member';
end $$;

create or replace function public.trip_people(t text) returns table (user_id uuid, display_name text, email text, role text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.display_name,
         case when private.is_admin() or private.is_trip_owner(t) or m.user_id = auth.uid() then p.email else null end,
         m.role
  from public.trip_members m join public.profiles p on p.id = m.user_id
  where m.trip_id = t and (private.is_admin() or (private.is_approved() and private.is_trip_member(t)))
  order by m.added_at;
$$;

create or replace function public.admin_list_users() returns table (id uuid, email text, display_name text, phone text, role text, status text, created_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not_allowed'; end if;
  return query select p.id, p.email, p.display_name, p.phone, p.role, p.status, p.created_at from public.profiles p order by p.created_at;
end $$;

create or replace function public.admin_list_trips() returns table (id text, name text, owner_email text, start_date date, end_date date, members jsonb)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not_allowed'; end if;
  return query
    select x.id, x.name, o.email, x.start_date, x.end_date,
           coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', p.email, 'role', m.role) order by m.added_at)
                     from public.trip_members m join public.profiles p on p.id = m.user_id where m.trip_id = x.id), '[]'::jsonb)
    from public.trips x join public.profiles o on o.id = x.owner_id
    order by x.created_at;
end $$;

create or replace function public.admin_set_status(target uuid, new_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not_allowed'; end if;
  if target = auth.uid() then raise exception 'not_self'; end if;
  if new_status not in ('pending', 'approved', 'blocked') then raise exception 'bad_status'; end if;
  update public.profiles set status = new_status where id = target and role = 'user';
end $$;

-- ---------- the public copies of the helpers go (nothing uses them any more; the drop fails if something did) ----------
drop function public.is_admin();
drop function public.is_approved();
drop function public.is_trip_member(text);
drop function public.is_trip_owner(text);

-- ---------- indexes for foreign keys ----------
create index if not exists trips_owner_idx on public.trips (owner_id);
create index if not exists trip_members_added_by_idx on public.trip_members (added_by);
create index if not exists trip_records_updated_by_idx on public.trip_records (updated_by);

commit;
