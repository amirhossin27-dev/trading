-- Run with psql -v ON_ERROR_STOP=1 after the migration, on a disposable database.
begin;
set local role service_role;
do $$
declare
  device uuid := '11111111-1111-4111-8111-111111111111';
  other_device uuid := '22222222-2222-4222-8222-222222222222';
  alarm_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  owner_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  other_owner uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  event_id uuid; second_id uuid; result jsonb; ack_time timestamptz; row_count integer;
  asset jsonb := '{"id":"btc","source":"binance","pair":"BTCUSDT","coingecko":"bitcoin","symbol":"BTC","name":"Bitcoin","group":"crypto"}';
begin
  if has_table_privilege('anon','public.trading_alert_events','SELECT') or has_table_privilege('authenticated','public.trading_alert_devices','SELECT') then raise exception 'public table privileges'; end if;
  if has_function_privilege('anon','public.trading_alert_ack(uuid,uuid)','EXECUTE') then raise exception 'public RPC privileges'; end if;
  if not has_table_privilege('service_role','public.trading_alert_events','SELECT,INSERT,UPDATE,DELETE') then raise exception 'missing service role grant'; end if;
  if exists(select 1 from pg_class where relname like 'trading_alert_%' and relkind = 'r' and not relrowsecurity) then raise exception 'RLS disabled'; end if;
  insert into public.trading_alert_devices(id, token_hash) values(device,repeat('a',64)),(other_device,repeat('b',64));
  result := public.trading_alert_create(device,alarm_id,asset,'above',100,'USD');
  result := public.trading_alert_create(device,alarm_id,asset,'above',100,'USD');
  if (select count(*) from public.trading_alert_alarms where id = alarm_id) <> 1 then raise exception 'create not idempotent'; end if;
  begin
    perform public.trading_alert_create(other_device,alarm_id,asset,'above',100,'USD');
    raise exception 'cross-device create permitted';
  exception when sqlstate 'P0001' then if sqlerrm <> 'id_conflict' then raise; end if; end;
  if not public.trading_alert_acquire(owner_id) then raise exception 'initial lease failed'; end if;
  if public.trading_alert_acquire(other_owner) then raise exception 'concurrent worker permitted'; end if;
  if public.trading_alert_observe(owner_id,alarm_id,1,999,'USD',now()-interval '1 hour',300) is not null then raise exception 'stale fired'; end if;
  if public.trading_alert_observe(owner_id,alarm_id,1,999,'EUR',now(),300) is not null then raise exception 'wrong currency fired'; end if;
  if public.trading_alert_observe(owner_id,alarm_id,1,999,null,now(),300) is not null then raise exception 'missing currency fired'; end if;
  if public.trading_alert_observe(owner_id,alarm_id,1,999,'USD',now(),null) is not null then raise exception 'missing freshness limit fired'; end if;
  if public.trading_alert_observe(owner_id,alarm_id,1,99,'USD',now(),300) is not null then raise exception 'below target fired'; end if;
  event_id := public.trading_alert_observe(owner_id,alarm_id,1,105,'USD',now(),300);
  if event_id is null then raise exception 'jump over target did not fire'; end if;
  if public.trading_alert_observe(owner_id,alarm_id,1,106,'USD',now(),300) is not null then raise exception 'duplicate trigger'; end if;
  if (select count(*) from public.trading_alert_events where id = event_id) <> 1 then raise exception 'event not durable'; end if;
  begin
    perform public.trading_alert_delete(device,alarm_id);
    raise exception 'unacknowledged delete permitted';
  exception when sqlstate 'P0001' then if sqlerrm <> 'ack_required' then raise; end if; end;
  select count(*) into row_count from public.trading_alert_claim_deliveries(owner_id,40);
  if row_count <> 1 then raise exception 'pending event not claimed'; end if;
  if not public.trading_alert_delivery_result(owner_id,event_id,503) then raise exception 'retry result lost'; end if;
  if (select delivery_status from public.trading_alert_events where id=event_id) <> 'pending' then raise exception 'failed push lost'; end if;
  select count(*) into row_count from public.trading_alert_claim_deliveries(owner_id,40);
  if row_count <> 0 then raise exception 'retry backoff absent'; end if;
  update public.trading_alert_events set next_attempt_at = now() where id=event_id;
  perform public.trading_alert_claim_deliveries(owner_id,40);
  perform public.trading_alert_delivery_result(owner_id,event_id,201);
  if (select delivery_status from public.trading_alert_events where id=event_id) <> 'sent' then raise exception 'success not persisted'; end if;
  begin
    perform public.trading_alert_ack(other_device,event_id);
    raise exception 'cross-device ack permitted';
  exception when sqlstate 'P0001' then if sqlerrm <> 'not_found' then raise; end if; end;
  result := public.trading_alert_ack(device,event_id);
  ack_time := (result->>'acknowledged_at')::timestamptz;
  result := public.trading_alert_ack(device,event_id);
  if (result->>'acknowledged_at')::timestamptz <> ack_time then raise exception 'ack not idempotent'; end if;
  result := public.trading_alert_rearm(device,alarm_id);
  if result->>'status' <> 'active' or (result->>'generation')::integer <> 2 then raise exception 'rearm failed'; end if;
  second_id := public.trading_alert_observe(owner_id,alarm_id,2,100,'USD',now(),300);
  if second_id is null or second_id=event_id then raise exception 'equality/rearmed event failed'; end if;
  perform public.trading_alert_ack(device,event_id);
  if (select status from public.trading_alert_alarms where id=alarm_id) <> 'triggered' then raise exception 'old ack changed new event'; end if;
  perform public.trading_alert_ack(device,second_id);
  perform public.trading_alert_delete(device,alarm_id);
  if (select count(*) from public.trading_alert_events where id in(event_id,second_id)) <> 2 then raise exception 'snapshot deleted'; end if;
  if not public.trading_alert_rate_limit('test',2,60) or not public.trading_alert_rate_limit('test',2,60) or public.trading_alert_rate_limit('test',2,60) then raise exception 'rate limit failed'; end if;
  for i in 1..100 loop
    perform public.trading_alert_create(device,gen_random_uuid(),asset,'below',1,'USD');
  end loop;
  begin
    perform public.trading_alert_create(device,gen_random_uuid(),asset,'above',100,'USD');
    raise exception '101st alarm allowed';
  exception when sqlstate 'P0001' then if sqlerrm <> 'alarm_limit' then raise; end if; end;
  perform public.trading_alert_finish(owner_id,true);
  if (select last_success_at from public.trading_alert_worker where singleton) is null then raise exception 'heartbeat not durable'; end if;
end $$;
rollback;
