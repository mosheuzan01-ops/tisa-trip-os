select k, v from (
 select 'fn:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' k, md5(p.prosrc||p.prosecdef::text||coalesce(array_to_string(p.proconfig,','),'')||p.provolatile::text) v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')
 union all select 'pol:'||tablename||'.'||policyname, md5(coalesce(qual,'')||'|'||coalesce(with_check,'')||'|'||cmd||'|'||array_to_string(roles,',')) from pg_policies where schemaname='public'
 union all select 'grant:'||table_name||':'||grantee||':'||privilege_type, '1' from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')
 union all select 'colgrant:'||table_name||'.'||column_name||':'||grantee, '1' from information_schema.column_privileges where table_schema='public' and grantee in ('anon','authenticated') and privilege_type='UPDATE'
 union all select 'fngrant:'||routine_schema||'.'||routine_name||':'||grantee,'1' from information_schema.routine_privileges where routine_schema in ('public','private') and grantee in ('anon','authenticated','PUBLIC')
 union all select 'idx:'||indexname, md5(indexdef) from pg_indexes where schemaname='public'
 union all select 'con:'||conrelid::regclass::text||'.'||conname, md5(pg_get_constraintdef(oid)) from pg_constraint where connamespace='public'::regnamespace
 union all select 'trg:'||tgrelid::regclass::text||'.'||tgname, md5(pg_get_triggerdef(oid)) from pg_trigger where not tgisinternal and (tgrelid::regclass::text like 'public.%' or tgrelid::regclass::text = 'auth.users')
 union all select 'rls:'||c.relname, c.relrowsecurity::text from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'
) s order by k;
