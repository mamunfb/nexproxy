-- Persist customer orders through a narrow authenticated RPC.
-- Keep IP-derived location data separate and readable only by admins.

create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    order_id text not null unique check (char_length(order_id) between 6 and 80),
    customer_id uuid not null references auth.users(id) on delete cascade,
    plan text not null,
    plan_name text not null,
    plan_price numeric(12, 2) not null check (plan_price >= 0),
    regular_price numeric(12, 2),
    savings numeric(12, 2),
    discount_percent numeric(6, 2),
    per_proxy_price numeric(12, 2),
    custom_quantity integer check (custom_quantity is null or custom_quantity between 1 and 100),
    country text not null,
    country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
    full_name text not null,
    email text not null,
    telegram text,
    intended_use text,
    requirements text,
    terms_consent boolean not null check (terms_consent),
    order_status text not null default 'PENDING_PAYMENT',
    payment_status text not null default 'UNPAID',
    payment_method text not null default 'PENDING',
    payment_reference text not null default '',
    payment_submitted_at timestamptz,
    payment_verified_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists orders_created_at_desc_idx
    on public.orders (created_at desc);
create index if not exists orders_customer_id_idx
    on public.orders (customer_id);

create table if not exists public.order_ip_locations (
    order_id text primary key references public.orders(order_id) on delete cascade,
    customer_id uuid not null references auth.users(id) on delete cascade,
    country text,
    country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
    region text,
    city text,
    latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
    longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
    created_at timestamptz not null default now()
);

alter table public.orders enable row level security;
alter table public.order_ip_locations enable row level security;

revoke all on table public.orders from anon, authenticated;
revoke all on table public.order_ip_locations from anon, authenticated;
grant select on table public.orders to authenticated;
grant select on table public.order_ip_locations to authenticated;

drop policy if exists orders_admin_read on public.orders;
create policy orders_admin_read
    on public.orders
    for select
    to authenticated
    using (public.is_admin() is true);

drop policy if exists order_ip_locations_admin_read on public.order_ip_locations;
create policy order_ip_locations_admin_read
    on public.order_ip_locations
    for select
    to authenticated
    using (public.is_admin() is true);

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

    if v_latitude is not null and (v_latitude < -90 or v_latitude > 90) then
        v_latitude := null;
    end if;
    if v_longitude is not null and (v_longitude < -180 or v_longitude > 180) then
        v_longitude := null;
    end if;
    if v_latitude is null or v_longitude is null then
        v_latitude := null;
        v_longitude := null;
    end if;

    v_country_code := case
        when upper(btrim(coalesce(p_country_code, ''))) ~ '^[A-Z]{2}$'
            then upper(btrim(p_country_code))
        else null
    end;
    v_geo_country_code := case
        when upper(btrim(coalesce(p_geo_country_code, ''))) ~ '^[A-Z]{2}$'
            then upper(btrim(p_geo_country_code))
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
        'PENDING_PAYMENT',
        case when p_plan_price = 0 then 'NO_PAYMENT_REQUIRED' else 'UNPAID' end,
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
       or v_geo_country_code is not null
       or v_latitude is not null then
        insert into public.order_ip_locations (
            order_id, customer_id, country, country_code, region, city, latitude, longitude
        ) values (
            v_saved_order_id, v_user_id,
            nullif(left(btrim(coalesce(p_geo_country, '')), 100), ''),
            v_geo_country_code,
            nullif(left(btrim(coalesce(p_geo_region, '')), 100), ''),
            nullif(left(btrim(coalesce(p_geo_city, '')), 100), ''),
            v_latitude, v_longitude
        )
        on conflict (order_id) do update set
            country = excluded.country,
            country_code = excluded.country_code,
            region = excluded.region,
            city = excluded.city,
            latitude = excluded.latitude,
            longitude = excluded.longitude
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
