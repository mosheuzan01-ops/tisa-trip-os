-- LATISA 1.1.2, migration 0003: deleting a trip from the account. Run once, after 0002.
-- It adds one function and changes no data. Tests: supabase/tests/rls_check.sql (D01-D10, N07).
-- Who may delete: only the trip's owner, and only while approved. A member, the admin, a pending or blocked user get
-- 'not_allowed'. API users still have no DELETE privilege on any table: this function is the only way.
-- What goes: the trip row; its records (shared and personal) and its members go with it (ON DELETE CASCADE in 0001).
-- Nothing else: other trips, profiles and settings are not touched.
-- What stays: every phone keeps its own copy. The app unlinks it ("on this device only"); the server never reaches
-- a phone's storage.
-- Answers: 'deleted', or 'missing' when there is no such trip (already deleted: a retry after a lost answer is safe).
-- SECURITY DEFINER because the caller has no DELETE privilege; it checks the owner itself, like share_trip.

begin;

create or replace function public.delete_trip(t text) returns text
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.is_approved() then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.trips x where x.id = t) then return 'missing'; end if;
  if not exists (select 1 from public.trips x where x.id = t and x.owner_id = auth.uid()) then raise exception 'not_allowed'; end if;
  delete from public.trips where id = t and owner_id = auth.uid();
  get diagnostics n = row_count;
  return case when n = 1 then 'deleted' else 'missing' end;
end $$;

revoke all on function public.delete_trip(text) from public, anon, authenticated;
grant execute on function public.delete_trip(text) to authenticated;

commit;
