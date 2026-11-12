-- RECONSTRUCTED SOURCE — not byte-for-byte original SQL.
-- The original file was absent from the supplied ZIP and accessible GitHub tree.
-- Version/name match the migration already recorded as applied in NexProxy production.
-- Function definition and ACL were reconstructed from read-only catalog inspection on 2026-11-09.
-- Do not manually replay against production; verify migration history before any rollout.

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $function$
    select lower(coalesce(auth.jwt() ->> 'email', '')) = lower('mamunfb13@gmail.com');
$function$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;
