-- LATISA stage 14: permission check (RLS) with sample users only.
--
-- How to run in the real project (owner, after 0001 is applied): Supabase dashboard > SQL Editor > paste > Run.
-- The whole check is ONE block. At the end it ALWAYS raises an error whose text is the result, for example:
--     ERROR:  RLS CHECK RESULT: 41 PASS, 0 FAIL
-- Raising the error undoes everything the check created (users, trips, records), so nothing is left behind.
-- "FAIL" lines name the checks that failed. Any other error means the check could not run: send it as is.
-- Locally the same file runs through scripts/qa/stage14-rls-local.cjs (plain PostgreSQL + supabase/tests/local-auth-stub.sql).
-- Sample addresses use the reserved .invalid domain; no real person or data.
do $check$
declare
  a constant uuid := '0000a000-0000-4000-8000-00000000000a';  -- owner of the trip
  b constant uuid := '0000b000-0000-4000-8000-00000000000b';  -- another approved user
  p constant uuid := '0000c000-0000-4000-8000-00000000000c';  -- pending
  x constant uuid := '0000d000-0000-4000-8000-00000000000d';  -- approved, later blocked
  m constant uuid := '0000e000-0000-4000-8000-00000000000e';  -- admin
  t constant text := 'rlscheck-trip-0001';
  n bigint; s text; ok boolean; j jsonb;
  passes int := 0; fails text[] := '{}';
begin
  -- ---------- setup, as the database owner ----------
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'rls-a@example.invalid', '{"display_name":"Sample A","phone":"000"}'),
    (b, 'rls-b@example.invalid', '{}'), (p, 'rls-p@example.invalid', '{}'),
    (x, 'rls-x@example.invalid', '{}'), (m, 'rls-m@example.invalid', '{}');
  select count(*) into n from public.profiles where id in (a, b, p, x, m) and status = 'pending' and role = 'user';
  if n = 5 then passes := passes + 1; else fails := array_append(fails, 'C01 new users start pending, role user'::text); end if;
  select display_name into s from public.profiles where id = a;
  if s = 'Sample A' then passes := passes + 1; else fails := array_append(fails, 'C02 sign-up name copied to profile'::text); end if;
  update public.profiles set status = 'approved' where id in (a, b, x, m);
  update public.profiles set role = 'admin' where id = m;   -- the manual, owner-only way to make an admin

  -- ---------- pending user p ----------
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.profiles;
  if n = 1 then passes := passes + 1; else fails := array_append(fails, 'P01 pending sees only own profile'::text); end if;
  select count(*) into n from public.my_profile() where status = 'pending';
  if n = 1 then passes := passes + 1; else fails := array_append(fails, 'P02 pending reads own status'::text); end if;
  begin perform public.create_trip('rlscheck-p', 'P', 'TH', null, null); fails := array_append(fails, 'P03 pending cannot create a trip'::text);
  exception when others then passes := passes + 1; end;
  begin update public.profiles set status = 'approved' where id = p; fails := array_append(fails, 'P04 pending cannot approve itself'::text);
  exception when others then passes := passes + 1; end;
  begin update public.profiles set role = 'admin' where id = p; fails := array_append(fails, 'P05 pending cannot make itself admin'::text);
  exception when others then passes := passes + 1; end;
  begin perform * from public.push_records(jsonb_build_array(jsonb_build_object('trip_id', 'rlscheck-p', 'scope', 'shared', 'kind', 'stop', 'rec_id', '1', 'data', '{}', 'edited_at', now())));
    fails := array_append(fails, 'P06 pending cannot push records'::text);
  exception when others then passes := passes + 1; end;
  execute 'reset role';

  -- ---------- owner a creates a trip and pushes shared + personal records ----------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';
  s := public.create_trip(t, 'Sample trip', 'TH', '2026-12-20', '2027-01-20');
  if s = 'created' then passes := passes + 1; else fails := array_append(fails, 'A01 owner creates trip'::text); end if;
  s := public.create_trip(t, 'Sample trip', 'TH', '2026-12-20', '2027-01-20');
  if s = 'exists' then passes := passes + 1; else fails := array_append(fails, 'A02 creating the same trip again is idempotent'::text); end if;
  perform * from public.push_records(jsonb_build_array(
    jsonb_build_object('trip_id', t, 'scope', 'shared', 'kind', 'stop', 'rec_id', 's1', 'data', '{"name":"Sample stop"}', 'edited_at', '2026-11-23T10:00:00Z'),
    jsonb_build_object('trip_id', t, 'scope', a::text, 'kind', 'budget', 'rec_id', 'budget', 'data', '{"totalMinor":100}', 'edited_at', '2026-11-23T10:00:00Z')));
  perform * from public.push_records(jsonb_build_array(
    jsonb_build_object('trip_id', t, 'scope', 'shared', 'kind', 'stop', 'rec_id', 's1', 'data', '{"name":"Sample stop"}', 'edited_at', '2026-11-23T10:00:00Z')));
  select count(*) into n from public.pull_records(t, null);
  if n = 2 then passes := passes + 1; else fails := array_append(fails, 'A03 owner reads own 2 records, no duplicate after re-push'::text); end if;
  s := public.share_trip(t, 'rls-p@example.invalid');
  if s = 'not_found' then passes := passes + 1; else fails := array_append(fails, 'A04 sharing with a pending user is refused'::text); end if;
  s := public.share_trip(t, 'nobody@example.invalid');
  if s = 'not_found' then passes := passes + 1; else fails := array_append(fails, 'A05 unknown email gives the same answer'::text); end if;
  execute 'reset role';

  -- ---------- b, approved but not a member: sees and changes nothing ----------
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.trips;
  if n = 0 then passes := passes + 1; else fails := array_append(fails, 'B01 stranger sees no trips (direct table read)'::text); end if;
  select count(*) into n from public.trip_records;
  if n = 0 then passes := passes + 1; else fails := array_append(fails, 'B02 stranger sees no records (direct table read)'::text); end if;
  select count(*) into n from public.pull_records(t, null);
  if n = 0 then passes := passes + 1; else fails := array_append(fails, 'B03 stranger pulls nothing'::text); end if;
  select count(*) into n from public.my_trips();
  if n = 0 then passes := passes + 1; else fails := array_append(fails, 'B04 stranger lists no trips'::text); end if;
  begin perform * from public.push_records(jsonb_build_array(jsonb_build_object('trip_id', t, 'scope', 'shared', 'kind', 'stop', 'rec_id', 'evil', 'data', '{}', 'edited_at', now())));
    fails := array_append(fails, 'B05 stranger cannot write into the trip'::text);
  exception when others then passes := passes + 1; end;
  ok := public.update_trip(t, 'Hacked', 'TH', '2000-01-01', '2000-01-02');
  if ok is not true then passes := passes + 1; else fails := array_append(fails, 'B06 stranger cannot change the trip'::text); end if;
  begin perform public.share_trip(t, 'rls-b@example.invalid'); fails := array_append(fails, 'B07 stranger cannot share the trip to itself'::text);
  exception when others then passes := passes + 1; end;
  s := public.create_trip(t, 'Mine now', 'TH', null, null);
  if s = 'taken' then passes := passes + 1; else fails := array_append(fails, 'B08 stranger cannot take over the trip id'::text); end if;
  begin insert into public.trips (id, owner_id, name) values ('rlscheck-forged', a, 'forged'); fails := array_append(fails, 'B09 cannot create a trip in someone else''s name'::text);
  exception when others then passes := passes + 1; end;
  begin select count(*) into n from public.trip_people(t);
    if n = 0 then passes := passes + 1; else fails := array_append(fails, 'B10 stranger cannot list the trip members'::text); end if;
  exception when others then passes := passes + 1; end;
  begin delete from public.trip_records; fails := array_append(fails, 'B11 nobody deletes records directly'::text);
  exception when others then passes := passes + 1; end;
  execute 'reset role';

  -- ---------- share with b ----------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';
  s := public.share_trip(t, 'RLS-B@example.invalid ');
  if s = 'ok' then passes := passes + 1; else fails := array_append(fails, 'S01 owner shares with an approved user'::text); end if;
  s := public.share_trip(t, 'rls-x@example.invalid');
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.my_trips() where id = t and my_role = 'member';
  if n = 1 then passes := passes + 1; else fails := array_append(fails, 'S02 member sees the shared trip'::text); end if;
  select count(*) into n from public.pull_records(t, null);
  if n = 1 then passes := passes + 1; else fails := array_append(fails, 'S03 member gets the shared record only, not the owner''s budget'::text); end if;
  select count(*) into n from public.trip_records where scope <> 'shared';
  if n = 0 then passes := passes + 1; else fails := array_append(fails, 'S04 member cannot read personal records of others (direct read)'::text); end if;
  select bool_and(accepted) into ok from public.push_records(jsonb_build_array(
    jsonb_build_object('trip_id', t, 'scope', 'shared', 'kind', 'place', 'rec_id', 'p1', 'data', '{"name":"Sample place"}', 'edited_at', '2026-11-23T11:00:00Z'),
    jsonb_build_object('trip_id', t, 'scope', b::text, 'kind', 'budget', 'rec_id', 'budget', 'data', '{"totalMinor":5}', 'edited_at', '2026-11-23T11:00:00Z')));
  if ok then passes := passes + 1; else fails := array_append(fails, 'S05 member writes shared records and own personal records'::text); end if;
  begin perform * from public.push_records(jsonb_build_array(jsonb_build_object('trip_id', t, 'scope', a::text, 'kind', 'budget', 'rec_id', 'budget', 'data', '{"totalMinor":0}', 'edited_at', '2030-01-01T00:00:00Z')));
    fails := array_append(fails, 'S06 member cannot write the owner''s personal records'::text);
  exception when others then passes := passes + 1; end;
  ok := public.update_trip(t, 'Sample trip', 'TH', '2000-01-01', '2000-01-02');
  if ok is not true then passes := passes + 1; else fails := array_append(fails, 'S07 member cannot change the trip dates'::text); end if;
  begin update public.trips set start_date = '2000-01-01' where id = t;
    get diagnostics n = row_count;
    if n = 0 then passes := passes + 1; else fails := array_append(fails, 'S08 member cannot change dates by direct update'::text); end if;
  exception when others then passes := passes + 1; end;
  select bool_and(accepted) into ok from public.push_records(jsonb_build_array(
    jsonb_build_object('trip_id', t, 'scope', 'shared', 'kind', 'stop', 'rec_id', 's1', 'data', '{"name":"older edit"}', 'edited_at', '2026-11-23T09:00:00Z')));
  if ok is false then passes := passes + 1; else fails := array_append(fails, 'S09 an older edit does not overwrite a newer one'::text); end if;
  select count(*) into n from public.trip_people(t) where email is not null;
  if n = 1 then passes := passes + 1; else fails := array_append(fails, 'S10 member sees names, not the other members'' emails'::text); end if;
  begin perform public.unshare_trip(t, a); fails := array_append(fails, 'S11 member cannot remove the owner'::text);
  exception when others then passes := passes + 1; end;
  execute 'reset role';
  select start_date::text into s from public.trips where id = t;
  if s = '2026-12-20' then passes := passes + 1; else fails := array_append(fails, 'S12 trip dates unchanged after member attempts'::text); end if;

  -- ---------- admin m ----------
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  begin perform * from public.admin_list_users(); fails := array_append(fails, 'M01 a regular user cannot list users'::text);
  exception when others then passes := passes + 1; end;
  begin perform public.admin_set_status(p, 'approved'); fails := array_append(fails, 'M02 a regular user cannot approve'::text);
  exception when others then passes := passes + 1; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', m::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.admin_list_users() where id in (a, b, p, x, m);
  if n = 5 then passes := passes + 1; else fails := array_append(fails, 'M03 admin lists users'::text); end if;
  select count(*) into n from public.admin_list_trips() where id = t;
  if n = 1 then passes := passes + 1; else fails := array_append(fails, 'M04 admin lists trips'::text); end if;
  select count(*) into n from public.trip_records where trip_id = t;
  if n = 4 then passes := passes + 1; else fails := array_append(fails, 'M05 admin reads all records of the trip'::text); end if;
  perform public.admin_set_status(x, 'blocked');
  begin perform public.admin_set_status(m, 'blocked'); fails := array_append(fails, 'M06 admin cannot block itself'::text);
  exception when others then passes := passes + 1; end;
  begin update public.profiles set role = 'admin' where id = b; fails := array_append(fails, 'M07 no role change from the app, even for an admin'::text);
  exception when others then passes := passes + 1; end;
  execute 'reset role';

  -- ---------- blocked x (was a member) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', x::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.trips;
  if n = 0 then passes := passes + 1; else fails := array_append(fails, 'X01 blocked member loses the trip at once'::text); end if;
  select count(*) into n from public.pull_records(t, null);
  if n = 0 then passes := passes + 1; else fails := array_append(fails, 'X02 blocked member pulls nothing'::text); end if;
  begin perform * from public.push_records(jsonb_build_array(jsonb_build_object('trip_id', t, 'scope', 'shared', 'kind', 'stop', 'rec_id', 'x', 'data', '{}', 'edited_at', now())));
    fails := array_append(fails, 'X03 blocked member cannot write'::text);
  exception when others then passes := passes + 1; end;
  execute 'reset role';

  -- ---------- removing a member, leaving, settings ----------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';
  perform public.unshare_trip(t, b);
  ok := public.save_settings('{"language":"he"}', '2026-11-23T10:00:00Z');
  if ok then passes := passes + 1; else fails := array_append(fails, 'U01 user saves own settings'::text); end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.my_trips();
  if n = 0 then passes := passes + 1; else fails := array_append(fails, 'U02 removed member no longer sees the trip'::text); end if;
  select count(*) into n from public.user_settings;
  if n = 0 then passes := passes + 1; else fails := array_append(fails, 'U03 settings of others are not visible'::text); end if;
  execute 'reset role';

  -- ---------- anon (no sign-in) ----------
  if not has_table_privilege('anon', 'public.trip_records', 'select') and not has_table_privilege('anon', 'public.profiles', 'select')
     and not has_table_privilege('anon', 'public.trips', 'select') then passes := passes + 1;
  else fails := array_append(fails, 'N01 anon has no table access'::text); end if;
  if not has_function_privilege('anon', 'public.push_records(jsonb)', 'execute')
     and not has_function_privilege('anon', 'public.admin_list_users()', 'execute') then passes := passes + 1;
  else fails := array_append(fails, 'N02 anon cannot call the functions'::text); end if;
  if not has_table_privilege('authenticated', 'public.trip_records', 'delete') then passes := passes + 1;
  else fails := array_append(fails, 'N03 no delete privilege on records'::text); end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'role', 'update')
     and not has_column_privilege('authenticated', 'public.profiles', 'status', 'update') then passes := passes + 1;
  else fails := array_append(fails, 'N04 role and status cannot be updated by API users'::text); end if;

  raise exception 'RLS CHECK RESULT: % PASS, % FAIL%', passes, coalesce(array_length(fails, 1), 0),
    case when array_length(fails, 1) > 0 then E'\nFAIL: ' || array_to_string(fails, E'\nFAIL: ') else '' end;
end
$check$;
