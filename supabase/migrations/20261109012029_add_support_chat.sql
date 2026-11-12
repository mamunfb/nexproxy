-- NexProxy private live support chat. Applied to production as migration 20261109012029.

create table if not exists public.support_chat_visitors (
    id uuid primary key default gen_random_uuid(),
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    display_name text check (display_name is null or char_length(display_name) <= 120),
    email text check (email is null or char_length(email) <= 254),
    anonymous_user_id uuid unique references auth.users(id) on delete set null,
    rate_event_timestamps timestamptz[] not null default '{}'::timestamptz[]
        check (cardinality(rate_event_timestamps) <= 10),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.support_chat_threads (
    id uuid primary key default gen_random_uuid(),
    visitor_id uuid not null references public.support_chat_visitors(id) on delete cascade,
    status text not null default 'open' check (status in ('open', 'resolved')),
    last_message_at timestamptz not null default now(),
    last_sender_role text check (last_sender_role is null or last_sender_role in ('visitor', 'admin')),
    visitor_read_at timestamptz,
    admin_read_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create unique index if not exists support_chat_one_open_thread_per_visitor
    on public.support_chat_threads(visitor_id) where status = 'open';
create index if not exists support_chat_threads_last_message_idx
    on public.support_chat_threads(last_message_at desc);

create table if not exists public.support_chat_messages (
    id uuid primary key default gen_random_uuid(),
    thread_id uuid not null references public.support_chat_threads(id) on delete cascade,
    sender_role text not null check (sender_role in ('visitor', 'admin')),
    body text not null default '' check (char_length(body) <= 4000),
    attachment_count smallint not null default 0 check (attachment_count between 0 and 5),
    status text not null default 'sent' check (status in ('pending', 'sent')),
    created_at timestamptz not null default now(),
    sent_at timestamptz,
    check (char_length(btrim(body)) > 0 or attachment_count > 0)
);
create index if not exists support_chat_messages_thread_created_idx
    on public.support_chat_messages(thread_id, created_at desc);

create table if not exists public.support_chat_attachments (
    id uuid primary key default gen_random_uuid(),
    message_id uuid not null references public.support_chat_messages(id) on delete cascade,
    display_name text check (display_name is null or char_length(display_name) between 1 and 255),
    mime_type text check (mime_type is null or mime_type in (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf', 'text/plain', 'text/csv',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )),
    size_bytes bigint check (size_bytes is null or size_bytes between 1 and 20971520),
    temporary_path text unique check (temporary_path is null or temporary_path like 'pending/%'),
    temporary_last_swept_at timestamptz,
    final_path text unique check (final_path is null or final_path like 'files/%'),
    upload_token_expires_at timestamptz not null,
    expires_at timestamptz,
    status text not null default 'pending' check (status in ('pending', 'ready', 'expired')),
    created_at timestamptz not null default now(),
    uploaded_at timestamptz,
    check (
        (status = 'ready' and final_path is not null and expires_at is not null
            and display_name is not null and mime_type is not null and size_bytes is not null)
        or (status = 'pending' and temporary_path is not null and final_path is null
            and display_name is not null and mime_type is not null and size_bytes is not null)
        or (status = 'expired' and final_path is null
            and display_name is null and mime_type is null and size_bytes is null)
    )
);
create index if not exists support_chat_attachments_expiry_idx
    on public.support_chat_attachments(expires_at, upload_token_expires_at);

alter table public.support_chat_visitors enable row level security;
alter table public.support_chat_threads enable row level security;
alter table public.support_chat_messages enable row level security;
alter table public.support_chat_attachments enable row level security;

revoke all on public.support_chat_visitors, public.support_chat_threads,
    public.support_chat_messages, public.support_chat_attachments from public, anon, authenticated;
grant select, insert, update, delete on public.support_chat_visitors, public.support_chat_threads,
    public.support_chat_messages, public.support_chat_attachments to service_role;
grant select on public.support_chat_threads, public.support_chat_messages to authenticated;

-- Linked chat-only anonymous users can read only their own thread and sent messages.
drop policy if exists support_chat_threads_linked_read on public.support_chat_threads;
create or replace function public.support_chat_is_linked_visitor(p_visitor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
    select exists (
        select 1 from public.support_chat_visitors v
        where v.id = p_visitor_id and v.anonymous_user_id = auth.uid()
    );
$function$;
revoke all on function public.support_chat_is_linked_visitor(uuid) from public, anon;
grant execute on function public.support_chat_is_linked_visitor(uuid) to authenticated;

create policy support_chat_threads_linked_read on public.support_chat_threads
    for select to authenticated
    using (public.support_chat_is_linked_visitor(visitor_id) or public.is_admin() is true);

drop policy if exists support_chat_messages_linked_read on public.support_chat_messages;
create policy support_chat_messages_linked_read on public.support_chat_messages
    for select to authenticated
    using (status = 'sent' and (
        exists (
            select 1 from public.support_chat_threads t
            where t.id = support_chat_messages.thread_id
              and public.support_chat_is_linked_visitor(t.visitor_id)
        ) or public.is_admin() is true
    ));

-- Attachment metadata is never directly readable by browser roles; use the Edge Function.
revoke all on public.support_chat_attachments from anon, authenticated;

-- Keep the chat bucket private and separate from payment proofs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'support-chat', 'support-chat', false, 20971520,
    array[
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf', 'text/plain', 'text/csv',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]::text[]
)
on conflict (id) do update set
    name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- These restrictive bucket-specific policies also neutralize any broad Storage policies.
drop policy if exists support_chat_storage_deny_anon_select on storage.objects;
create policy support_chat_storage_deny_anon_select on storage.objects as restrictive
    for select to anon using (bucket_id <> 'support-chat');
drop policy if exists support_chat_storage_deny_anon_insert on storage.objects;
create policy support_chat_storage_deny_anon_insert on storage.objects as restrictive
    for insert to anon with check (bucket_id <> 'support-chat');
drop policy if exists support_chat_storage_deny_anon_update on storage.objects;
create policy support_chat_storage_deny_anon_update on storage.objects as restrictive
    for update to anon using (bucket_id <> 'support-chat') with check (bucket_id <> 'support-chat');
drop policy if exists support_chat_storage_deny_anon_delete on storage.objects;
create policy support_chat_storage_deny_anon_delete on storage.objects as restrictive
    for delete to anon using (bucket_id <> 'support-chat');
drop policy if exists support_chat_storage_deny_authenticated_select on storage.objects;
create policy support_chat_storage_deny_authenticated_select on storage.objects as restrictive
    for select to authenticated using (bucket_id <> 'support-chat');
drop policy if exists support_chat_storage_deny_authenticated_insert on storage.objects;
create policy support_chat_storage_deny_authenticated_insert on storage.objects as restrictive
    for insert to authenticated with check (bucket_id <> 'support-chat');
drop policy if exists support_chat_storage_deny_authenticated_update on storage.objects;
create policy support_chat_storage_deny_authenticated_update on storage.objects as restrictive
    for update to authenticated using (bucket_id <> 'support-chat') with check (bucket_id <> 'support-chat');
drop policy if exists support_chat_storage_deny_authenticated_delete on storage.objects;
create policy support_chat_storage_deny_authenticated_delete on storage.objects as restrictive
    for delete to authenticated using (bucket_id <> 'support-chat');

-- Realtime should contain only the two explicitly approved chat tables.
do $block$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_chat_threads'
        ) then
            alter publication supabase_realtime add table public.support_chat_threads;
        end if;
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_chat_messages'
        ) then
            alter publication supabase_realtime add table public.support_chat_messages;
        end if;
    end if;
end;
$block$;

-- Atomic per-visitor message allowance; serializes concurrent sends on the visitor row.
create or replace function public.consume_support_chat_rate_limit(p_visitor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    v_recent timestamptz[];
    v_now timestamptz;
begin
    select rate_event_timestamps
      into v_recent
      from public.support_chat_visitors
     where id = p_visitor_id
     for update;
    if not found then return false; end if;
    v_now := clock_timestamp();
    select coalesce(array_agg(event_at order by event_at), '{}'::timestamptz[])
      into v_recent
      from unnest(coalesce(v_recent, '{}'::timestamptz[])) as events(event_at)
     where event_at > v_now - interval '1 minute';
    if cardinality(v_recent) >= 10 then
        update public.support_chat_visitors set rate_event_timestamps = v_recent, updated_at = v_now
         where id = p_visitor_id;
        return false;
    end if;
    v_recent := array_append(v_recent, v_now);
    update public.support_chat_visitors
       set rate_event_timestamps = v_recent, updated_at = v_now
     where id = p_visitor_id;
    return true;
end;
$function$;
revoke all on function public.consume_support_chat_rate_limit(uuid) from public, anon, authenticated;
grant execute on function public.consume_support_chat_rate_limit(uuid) to service_role;

-- Refresh the existing RPC body with one protective claim check; normal authenticated
-- customers retain the original order behavior and payload contract.
create or replace function public.create_customer_order(
    p_order_id text,
    p_plan text,
    p_plan_name text,
    p_plan_price numeric,
    p_regular_price numeric,
    p_savings numeric,
    p_discount_percent numeric,
    p_per_proxy_price numeric,
    p_custom_quantity integer,
    p_country text,
    p_country_code text,
    p_full_name text,
    p_email text,
    p_telegram text,
    p_intended_use text,
    p_requirements text,
    p_terms_consent boolean,
    p_geo_country text,
    p_geo_country_code text,
    p_geo_region text,
    p_geo_city text,
    p_geo_latitude numeric,
    p_geo_longitude numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    v_user_id uuid := auth.uid();
    v_saved_order_id text;
    v_latitude numeric := p_geo_latitude;
    v_longitude numeric := p_geo_longitude;
    v_country_code text;
    v_geo_country_code text;
begin
    if v_user_id is null then
        raise exception using errcode = '28000', message = 'Authentication required.';
    end if;
    if auth.jwt()->>'is_anonymous' = 'true' then
        raise exception using errcode = '42501', message = 'Anonymous chat users cannot create orders.';
    end if;

    if p_order_id is null or p_order_id !~ '^[A-Za-z0-9-]{6,80}$' then
        raise exception using errcode = '22023', message = 'Invalid order ID.';
    end if;
    if nullif(btrim(p_plan), '') is null or nullif(btrim(p_plan_name), '') is null then
        raise exception using errcode = '22023', message = 'A plan is required.';
    end if;
    if p_plan_price is null or p_plan_price < 0 then
        raise exception using errcode = '22023', message = 'Invalid plan price.';
    end if;
    if nullif(btrim(p_country), '') is null
       or nullif(btrim(p_full_name), '') is null
       or nullif(btrim(p_email), '') is null
       or position('@' in p_email) < 2 then
        raise exception using errcode = '22023', message = 'Required customer details are missing.';
    end if;
    if p_terms_consent is not true then
        raise exception using errcode = '22023', message = 'Terms consent is required.';
    end if;

    if v_latitude is not null and (v_latitude < -90 or v_latitude > 90) then v_latitude := null; end if;
    if v_longitude is not null and (v_longitude < -180 or v_longitude > 180) then v_longitude := null; end if;
    if v_latitude is null or v_longitude is null then v_latitude := null; v_longitude := null; end if;

    v_country_code := case
        when upper(btrim(coalesce(p_country_code, ''))) ~ '^[A-Z]{2}$' then upper(btrim(p_country_code))
        else null
    end;
    v_geo_country_code := case
        when upper(btrim(coalesce(p_geo_country_code, ''))) ~ '^[A-Z]{2}$' then upper(btrim(p_geo_country_code))
        else null
    end;

    insert into public.orders (
        order_id, customer_id, plan, plan_name, plan_price,
        regular_price, savings, discount_percent, per_proxy_price,
        custom_quantity, country, country_code, full_name, email,
        telegram, intended_use, requirements, terms_consent,
        order_status, payment_status, payment_method, payment_reference
    ) values (
        p_order_id, v_user_id, left(btrim(p_plan), 80), left(btrim(p_plan_name), 160), p_plan_price,
        p_regular_price, p_savings, p_discount_percent, p_per_proxy_price,
        p_custom_quantity, left(btrim(p_country), 100), v_country_code,
        left(btrim(p_full_name), 160), left(btrim(p_email), 254),
        nullif(left(btrim(coalesce(p_telegram, '')), 120), ''),
        nullif(left(btrim(coalesce(p_intended_use, '')), 500), ''),
        nullif(left(btrim(coalesce(p_requirements, '')), 4000), ''), true,
        'PENDING_PAYMENT', case when p_plan_price = 0 then 'NO_PAYMENT_REQUIRED' else 'UNPAID' end,
        'PENDING', ''
    )
    on conflict (order_id) do nothing
    returning order_id into v_saved_order_id;

    if v_saved_order_id is null then
        select o.order_id into v_saved_order_id
          from public.orders o
         where o.order_id = p_order_id and o.customer_id = v_user_id;
        if v_saved_order_id is null then
            raise exception using errcode = '23505', message = 'Order ID is already in use.';
        end if;
    end if;

    if nullif(btrim(coalesce(p_geo_country, '')), '') is not null
       or v_geo_country_code is not null or v_latitude is not null then
        insert into public.order_ip_locations (
            order_id, customer_id, country, country_code, region, city, latitude, longitude
        ) values (
            v_saved_order_id, v_user_id,
            nullif(left(btrim(coalesce(p_geo_country, '')), 100), ''), v_geo_country_code,
            nullif(left(btrim(coalesce(p_geo_region, '')), 100), ''),
            nullif(left(btrim(coalesce(p_geo_city, '')), 100), ''), v_latitude, v_longitude
        )
        on conflict (order_id) do update set
            country = excluded.country, country_code = excluded.country_code,
            region = excluded.region, city = excluded.city,
            latitude = excluded.latitude, longitude = excluded.longitude
        where public.order_ip_locations.customer_id = v_user_id;
    end if;

    return jsonb_build_object('success', true, 'orderId', v_saved_order_id);
end;
$function$;

revoke all on function public.create_customer_order(
    text, text, text, numeric, numeric, numeric, numeric, numeric, integer,
    text, text, text, text, text, text, text, boolean, text, text, text, text, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.create_customer_order(
    text, text, text, numeric, numeric, numeric, numeric, numeric, integer,
    text, text, text, text, text, text, text, boolean, text, text, text, text, numeric, numeric
) to authenticated;
