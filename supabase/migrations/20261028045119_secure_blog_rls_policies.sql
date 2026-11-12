-- RECONSTRUCTED SOURCE — not byte-for-byte original SQL.
-- The original file was absent from the supplied ZIP and accessible GitHub tree.
-- Version/name match the migration already recorded as applied in NexProxy production.
-- Policies below were reconstructed from a read-only catalog inspection on 2026-11-09.
-- Do not manually replay against production; verify migration history before any rollout.
-- This file mirrors the observed RLS policies; it does not alter table-level grants.
-- Current production catalog also reports broad anon/authenticated table privileges,
-- including TRUNCATE; RLS does not protect TRUNCATE. Review a separate ACL-hardening
-- migration before treating these grants as least-privilege.

alter table public.blog_posts enable row level security;
alter table public.blog_comments enable row level security;

drop policy if exists blog_posts_read_published on public.blog_posts;
create policy blog_posts_read_published
    on public.blog_posts
    for select
    to anon, authenticated
    using (published or public.is_admin());

drop policy if exists blog_posts_admin_insert on public.blog_posts;
create policy blog_posts_admin_insert
    on public.blog_posts
    for insert
    to authenticated
    with check (public.is_admin());

drop policy if exists blog_posts_admin_update on public.blog_posts;
create policy blog_posts_admin_update
    on public.blog_posts
    for update
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

drop policy if exists blog_posts_admin_delete on public.blog_posts;
create policy blog_posts_admin_delete
    on public.blog_posts
    for delete
    to authenticated
    using (public.is_admin());

drop policy if exists blog_comments_read_approved on public.blog_comments;
create policy blog_comments_read_approved
    on public.blog_comments
    for select
    to anon, authenticated
    using (approved or public.is_admin());

drop policy if exists blog_comments_insert_pending on public.blog_comments;
create policy blog_comments_insert_pending
    on public.blog_comments
    for insert
    to anon, authenticated
    with check (
        approved = false
        and char_length(btrim(name)) >= 2
        and char_length(btrim(content)) >= 3
    );

drop policy if exists blog_comments_admin_update on public.blog_comments;
create policy blog_comments_admin_update
    on public.blog_comments
    for update
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

drop policy if exists blog_comments_admin_delete on public.blog_comments;
create policy blog_comments_admin_delete
    on public.blog_comments
    for delete
    to authenticated
    using (public.is_admin());
