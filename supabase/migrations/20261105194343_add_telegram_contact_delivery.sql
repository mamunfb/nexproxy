-- Telegram contact verification and delivery. Activation is off until the bot is configured.

create table if not exists public.customer_contact_settings (
    id smallint primary key default 1 check (id = 1),
    telegram_required boolean not null default false,
    updated_at timestamptz not null default now()
);
insert into public.customer_contact_settings (id, telegram_required)
values (1, false)
on conflict (id) do nothing;

create table if not exists public.customer_contact_methods (
    customer_id uuid primary key references auth.users(id) on delete cascade,
    telegram_chat_id bigint unique,
    telegram_username text,
    telegram_verified_at timestamptz,
    whatsapp_phone text,
    whatsapp_verified_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (telegram_username is null or char_length(telegram_username) <= 32),
    check (whatsapp_phone is null or char_length(whatsapp_phone) <= 20)
);

create table if not exists public.telegram_link_tokens (
    token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
    customer_id uuid not null references auth.users(id) on delete cascade,
    expires_at timestamptz not null,
    used_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists telegram_link_tokens_customer_idx
    on public.telegram_link_tokens (customer_id, created_at desc);

create table if not exists public.telegram_delivery_events (
    id uuid primary key default gen_random_uuid(),
    event_key text not null unique,
    order_id text not null references public.orders(order_id) on delete cascade,
    assignment_id uuid not null references public.proxy_assignments(id) on delete cascade,
    status text not null default 'PENDING' check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED')),
    attempts smallint not null default 0 check (attempts between 0 and 3),
    error_code text,
    provider_message_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    sent_at timestamptz
);
create index if not exists telegram_delivery_events_order_created_idx
    on public.telegram_delivery_events (order_id, created_at desc);

alter table public.customer_contact_settings enable row level security;
alter table public.customer_contact_methods enable row level security;
alter table public.telegram_link_tokens enable row level security;
alter table public.telegram_delivery_events enable row level security;
revoke all on public.customer_contact_settings, public.customer_contact_methods,
    public.telegram_link_tokens, public.telegram_delivery_events from public, anon, authenticated;
grant select, insert, update, delete on public.customer_contact_settings,
    public.customer_contact_methods, public.telegram_link_tokens,
    public.telegram_delivery_events to service_role;

create or replace function public.complete_telegram_link(
    p_token_hash text,
    p_chat_id bigint,
    p_username text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    v_customer_id uuid;
    v_updated integer;
begin
    if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
       or p_chat_id is null or p_chat_id <= 0 then
        raise exception using errcode = '22023', message = 'Invalid Telegram link.';
    end if;

    update public.telegram_link_tokens
       set used_at = now()
     where token_hash = p_token_hash
       and used_at is null
       and expires_at > now()
    returning customer_id into v_customer_id;

    if v_customer_id is null then
        raise exception using errcode = 'P0001', message = 'Telegram link expired or already used.';
    end if;

    insert into public.customer_contact_methods (
        customer_id, telegram_chat_id, telegram_username, telegram_verified_at, updated_at
    ) values (
        v_customer_id, p_chat_id,
        nullif(left(regexp_replace(coalesce(p_username, ''), '^@', ''), 32), ''),
        now(), now()
    )
    on conflict (customer_id) do update set
        telegram_chat_id = excluded.telegram_chat_id,
        telegram_username = excluded.telegram_username,
        telegram_verified_at = now(),
        updated_at = now()
    where public.customer_contact_methods.telegram_chat_id is null
       or public.customer_contact_methods.telegram_chat_id = excluded.telegram_chat_id;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception using errcode = '23505', message = 'Telegram account is linked to another NexProxy account.';
    end if;

    return jsonb_build_object('success', true);
end;
$function$;
revoke all on function public.complete_telegram_link(text, bigint, text) from public, anon, authenticated;
grant execute on function public.complete_telegram_link(text, bigint, text) to service_role;

create or replace function public.enforce_telegram_contact_before_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    v_required boolean := false;
begin
    select telegram_required into v_required
      from public.customer_contact_settings
     where id = 1;

    if v_required is true
       and not exists (
           select 1
             from public.customer_contact_methods c
            where c.customer_id = new.customer_id
              and c.telegram_chat_id is not null
              and c.telegram_verified_at is not null
       )
       and not exists (
           select 1
             from public.orders o
            where o.order_id = new.order_id
              and o.customer_id = new.customer_id
       ) then
        raise exception using
            errcode = 'P0001',
            message = 'Telegram contact verification required before order confirmation.';
    end if;
    return new;
end;
$function$;

drop trigger if exists orders_require_telegram_contact on public.orders;
create trigger orders_require_telegram_contact
before insert on public.orders
for each row execute function public.enforce_telegram_contact_before_order();
