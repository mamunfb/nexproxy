-- Idempotency ledger for server-generated order/payment email notifications.
-- It stores event metadata only; recipient addresses and email bodies are not retained.
create table if not exists public.transactional_email_events (
    id uuid primary key default gen_random_uuid(),
    event_key text not null unique,
    order_id text not null references public.orders(order_id) on delete cascade,
    event_type text not null check (event_type in (
        'order_received',
        'payment_submitted',
        'payment_verified',
        'proxy_assigned'
    )),
    status text not null default 'PENDING' check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED')),
    attempts smallint not null default 0 check (attempts between 0 and 5),
    error_code text,
    provider_message_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    sent_at timestamptz
);

create index if not exists transactional_email_events_order_created_idx
    on public.transactional_email_events (order_id, created_at desc);

alter table public.transactional_email_events enable row level security;
revoke all on table public.transactional_email_events from public, anon, authenticated;
grant select, insert, update on table public.transactional_email_events to service_role;
