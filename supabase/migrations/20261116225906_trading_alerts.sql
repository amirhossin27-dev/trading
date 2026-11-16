-- All application access goes through an Edge Function with a device capability.
-- No anonymous/authenticated table grants or RLS policies are created.
create table public.trading_alert_devices (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create table public.trading_alert_subscriptions (
  device_id uuid primary key references public.trading_alert_devices(id) on delete cascade,
  subscription jsonb not null,
  endpoint_hash text not null unique,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create table public.trading_alert_alarms (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.trading_alert_devices(id) on delete cascade,
  asset jsonb not null check (jsonb_typeof(asset) = 'object'),
  direction text not null check (direction in ('above', 'below')),
  target numeric not null check (target > 0 and target <= 1e15 and target <> 'NaN'::numeric),
  currency text not null check (currency ~ '^[A-Za-z]{3,8}$'),
  status text not null default 'active' check (status in ('active', 'triggered', 'acked')),
  generation integer not null default 1 check (generation > 0),
  created_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_observed_at timestamptz,
  last_price numeric,
  last_error text
);
create index trading_alert_alarms_device on public.trading_alert_alarms(device_id);
create index trading_alert_alarms_active on public.trading_alert_alarms(last_checked_at nulls first) where status = 'active';
create table public.trading_alert_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.trading_alert_devices(id) on delete cascade,
  -- Keep the snapshot even if the user deletes an acknowledged alarm later.
  alarm_id uuid not null,
  generation integer not null,
  asset jsonb not null,
  target numeric not null,
  currency text not null,
  observed_price numeric not null,
  observed_at timestamptz not null,
  triggered_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sent', 'expired', 'acknowledged')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  delivery_locked_until timestamptz,
  delivery_lock uuid,
  last_delivery_status integer,
  unique (alarm_id, generation)
);
create index trading_alert_events_device on public.trading_alert_events(device_id, triggered_at desc);
create index trading_alert_events_pending on public.trading_alert_events(next_attempt_at) where delivery_status = 'pending' and acknowledged_at is null;
create table public.trading_alert_rate_buckets (
  key text not null,
  bucket bigint not null,
  hits integer not null,
  expires_at timestamptz not null,
  primary key (key, bucket)
);
create table public.trading_alert_worker (
  singleton boolean primary key default true check (singleton),
  lease_owner uuid,
  lease_until timestamptz,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text
);
insert into public.trading_alert_worker(singleton) values(true);

alter table public.trading_alert_devices enable row level security;
alter table public.trading_alert_subscriptions enable row level security;
alter table public.trading_alert_alarms enable row level security;
alter table public.trading_alert_events enable row level security;
alter table public.trading_alert_rate_buckets enable row level security;
alter table public.trading_alert_worker enable row level security;
revoke all on public.trading_alert_devices, public.trading_alert_subscriptions, public.trading_alert_alarms, public.trading_alert_events, public.trading_alert_rate_buckets, public.trading_alert_worker from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on public.trading_alert_devices, public.trading_alert_subscriptions, public.trading_alert_alarms, public.trading_alert_events, public.trading_alert_rate_buckets, public.trading_alert_worker to service_role;

create function public.trading_alert_rate_limit(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare accepted integer;
begin
  if p_limit < 1 or p_seconds < 1 or length(p_key) > 160 then return false; end if;
  insert into public.trading_alert_rate_buckets(key, bucket, hits, expires_at)
  values(p_key, floor(extract(epoch from now()) / p_seconds)::bigint, 1, now() + make_interval(secs => p_seconds * 2))
  on conflict (key, bucket) do update set hits = trading_alert_rate_buckets.hits + 1
  where trading_alert_rate_buckets.hits < p_limit returning hits into accepted;
  return accepted is not null;
end $$;

create function public.trading_alert_create(p_device_id uuid, p_id uuid, p_asset jsonb, p_direction text, p_target numeric, p_currency text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result public.trading_alert_alarms;
begin
  perform 1 from public.trading_alert_devices where id = p_device_id for update;
  if not found then raise exception 'unknown_device' using errcode = 'P0001'; end if;
  select * into result from public.trading_alert_alarms where id = p_id;
  if found then
    if result.device_id <> p_device_id or result.asset <> p_asset or result.direction <> p_direction or result.target <> p_target or result.currency <> p_currency then
      raise exception 'id_conflict' using errcode = 'P0001';
    end if;
    return to_jsonb(result);
  end if;
  if (select count(*) from public.trading_alert_alarms where device_id = p_device_id) >= 100 then raise exception 'alarm_limit' using errcode = 'P0001'; end if;
  insert into public.trading_alert_alarms(id, device_id, asset, direction, target, currency)
  values(p_id, p_device_id, p_asset, p_direction, p_target, p_currency) returning * into result;
  return to_jsonb(result);
end $$;

create function public.trading_alert_ack(p_device_id uuid, p_event_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result public.trading_alert_events;
begin
  -- Lock the alarm first, the same order as worker observation/rearm.
  perform 1 from public.trading_alert_alarms where device_id = p_device_id and id = (
    select alarm_id from public.trading_alert_events where id = p_event_id and device_id = p_device_id
  ) for update;
  update public.trading_alert_events set acknowledged_at = coalesce(acknowledged_at, now()),
    delivery_status = 'acknowledged', delivery_locked_until = null, delivery_lock = null
  where id = p_event_id and device_id = p_device_id returning * into result;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  update public.trading_alert_alarms set status = 'acked'
  where id = result.alarm_id and device_id = p_device_id and generation = result.generation and status = 'triggered';
  return to_jsonb(result);
end $$;

create function public.trading_alert_rearm(p_device_id uuid, p_alarm_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result public.trading_alert_alarms;
begin
  select * into result from public.trading_alert_alarms where id = p_alarm_id and device_id = p_device_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if result.status <> 'acked' then raise exception 'ack_required' using errcode = 'P0001'; end if;
  update public.trading_alert_alarms set status = 'active', generation = generation + 1,
    last_price = null, last_observed_at = null, last_checked_at = null, last_error = null
  where id = p_alarm_id returning * into result;
  return to_jsonb(result);
end $$;

create function public.trading_alert_delete(p_device_id uuid, p_alarm_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_status text;
begin
  select status into current_status from public.trading_alert_alarms where id = p_alarm_id and device_id = p_device_id for update;
  if not found then return false; end if;
  if current_status = 'triggered' then raise exception 'ack_required' using errcode = 'P0001'; end if;
  delete from public.trading_alert_alarms where id = p_alarm_id and device_id = p_device_id;
  return true;
end $$;

create function public.trading_alert_acquire(p_owner uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.trading_alert_worker set lease_owner = p_owner, lease_until = now() + interval '55 seconds', last_run_at = now()
  where singleton and (lease_until is null or lease_until < now());
  return found;
end $$;

create function public.trading_alert_finish(p_owner uuid, p_success boolean, p_error text default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare did_finish boolean;
begin
  update public.trading_alert_worker set lease_until = null, lease_owner = null,
    last_success_at = case when p_success then now() else last_success_at end,
    last_error = case when p_success then null else left(p_error, 80) end
  where singleton and lease_owner = p_owner and lease_until > now();
  did_finish := found;
  delete from public.trading_alert_rate_buckets where expires_at < now();
  -- Acknowledged history is bounded; unacknowledged events are never aged out.
  delete from public.trading_alert_events where acknowledged_at < now() - interval '90 days';
  return did_finish;
end $$;

create function public.trading_alert_observe(p_owner uuid, p_alarm_id uuid, p_generation integer, p_price numeric, p_currency text, p_observed_at timestamptz, p_max_age_seconds integer)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare alarm public.trading_alert_alarms; event_id uuid; crossed boolean;
begin
  perform 1 from public.trading_alert_worker where singleton and lease_owner = p_owner and lease_until > now() for share;
  if not found then raise exception 'worker_lease_expired' using errcode = 'P0001'; end if;
  select * into alarm from public.trading_alert_alarms where id = p_alarm_id for update;
  if not found or alarm.status <> 'active' or alarm.generation <> p_generation then return null; end if;
  if p_price is null or p_price <= 0 or p_price > 1e15 or p_price = 'NaN'::numeric or p_currency is null or p_currency <> alarm.currency
    or p_observed_at is null or p_max_age_seconds is null or p_max_age_seconds not between 1 and 1200
    or p_observed_at < now() - make_interval(secs => p_max_age_seconds) or p_observed_at > now() + interval '30 seconds'
    or (alarm.last_observed_at is not null and p_observed_at < alarm.last_observed_at) then return null; end if;
  crossed := (alarm.direction = 'above' and p_price >= alarm.target and (alarm.last_price is null or alarm.last_price < alarm.target))
    or (alarm.direction = 'below' and p_price <= alarm.target and (alarm.last_price is null or alarm.last_price > alarm.target));
  update public.trading_alert_alarms set last_price = p_price, last_checked_at = now(), last_observed_at = p_observed_at, last_error = null,
    status = case when crossed then 'triggered' else 'active' end where id = alarm.id;
  if crossed then
    insert into public.trading_alert_events(device_id, alarm_id, generation, asset, target, currency, observed_price, observed_at)
    values(alarm.device_id, alarm.id, alarm.generation, alarm.asset, alarm.target, alarm.currency, p_price, p_observed_at)
    on conflict (alarm_id, generation) do nothing returning id into event_id;
  end if;
  return event_id;
end $$;

create function public.trading_alert_claim_deliveries(p_owner uuid, p_limit integer default 40)
returns setof public.trading_alert_events language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.trading_alert_worker where singleton and lease_owner = p_owner and lease_until > now() for share;
  if not found then raise exception 'worker_lease_expired' using errcode = 'P0001'; end if;
  return query update public.trading_alert_events e set delivery_lock = p_owner, delivery_locked_until = now() + interval '50 seconds', attempts = attempts + 1
  where e.id in (select id from public.trading_alert_events where delivery_status = 'pending' and acknowledged_at is null
    and next_attempt_at <= now() and (delivery_locked_until is null or delivery_locked_until < now())
    order by next_attempt_at limit least(greatest(p_limit, 1), 100) for update skip locked) returning e.*;
end $$;

create function public.trading_alert_delivery_result(p_owner uuid, p_event_id uuid, p_status integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.trading_alert_events set delivery_status = case when p_status between 200 and 299 then 'sent' else 'pending' end,
    next_attempt_at = now() + make_interval(secs => least(3600, (30 * power(2, least(attempts, 7)))::integer)),
    last_delivery_status = p_status, delivery_locked_until = null, delivery_lock = null
  where id = p_event_id and delivery_lock = p_owner and acknowledged_at is null and delivery_status = 'pending';
  return found;
end $$;

-- PostgreSQL grants EXECUTE to PUBLIC by default; revoke each exact signature.
revoke all on function public.trading_alert_rate_limit(text,integer,integer), public.trading_alert_create(uuid,uuid,jsonb,text,numeric,text), public.trading_alert_ack(uuid,uuid), public.trading_alert_rearm(uuid,uuid), public.trading_alert_delete(uuid,uuid), public.trading_alert_acquire(uuid), public.trading_alert_finish(uuid,boolean,text), public.trading_alert_observe(uuid,uuid,integer,numeric,text,timestamptz,integer), public.trading_alert_claim_deliveries(uuid,integer), public.trading_alert_delivery_result(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.trading_alert_rate_limit(text,integer,integer), public.trading_alert_create(uuid,uuid,jsonb,text,numeric,text), public.trading_alert_ack(uuid,uuid), public.trading_alert_rearm(uuid,uuid), public.trading_alert_delete(uuid,uuid), public.trading_alert_acquire(uuid), public.trading_alert_finish(uuid,boolean,text), public.trading_alert_observe(uuid,uuid,integer,numeric,text,timestamptz,integer), public.trading_alert_claim_deliveries(uuid,integer), public.trading_alert_delivery_result(uuid,uuid,integer) to service_role;

