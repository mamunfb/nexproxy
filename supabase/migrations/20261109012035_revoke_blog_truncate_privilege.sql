-- Production blog ACL hardening applied as migration 20261109012035.
-- Read-only catalog inspection found TRUNCATE granted directly to anon and
-- authenticated on these tables. RLS policies do not protect TRUNCATE.
-- Keep existing SELECT/INSERT/UPDATE/DELETE grants unchanged; blog access remains
-- constrained by the existing row-level security policies.

revoke truncate on table public.blog_posts, public.blog_comments
    from anon, authenticated;
