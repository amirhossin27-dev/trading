-- Disposable database only. The transaction creates dummy Vault values and
-- rolls them back. Run after both alarm migrations with ON_ERROR_STOP=1.
begin;
do $$
declare result jsonb;
begin
  if has_function_privilege('anon', 'public.trading_alert_server_settings()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.trading_alert_server_settings()', 'EXECUTE') then
    raise exception 'Vault settings reader publicly executable';
  end if;
  if not has_function_privilege('service_role', 'public.trading_alert_server_settings()', 'EXECUTE') then raise exception 'service role grant missing'; end if;
  if has_table_privilege('service_role', 'vault.decrypted_secrets', 'SELECT') then raise exception 'test expects no broad Vault SELECT grant'; end if;
  perform vault.create_secret('public-key-fixture', 'trading_alert_vapid_public_key');
  perform vault.create_secret('private-key-fixture', 'trading_alert_vapid_private_key');
  perform vault.create_secret('mailto:admin@example.com', 'trading_alert_vapid_subject');
  perform vault.create_secret('scheduler-fixture', 'trading_alert_scheduler_secret');
  perform vault.create_secret('https://trading.example.com', 'trading_alert_allowed_origins');
  perform vault.create_secret('https://api.example.com', 'trading_alert_yahoo_api_base_url');
  perform vault.create_secret('must-not-be-returned', 'unrelated_secret_fixture');
  perform vault.create_secret('cron-url-must-not-be-returned', 'trading_alert_project_url');
  result := public.trading_alert_server_settings();
  if result->>'ALERT_VAPID_PRIVATE_KEY' <> 'private-key-fixture' then raise exception 'admin lookup failed'; end if;
end $$;

set local role service_role;
do $$
declare result jsonb;
begin
  result := public.trading_alert_server_settings();
  if result <> '{"ALERT_VAPID_PUBLIC_KEY":"public-key-fixture","ALERT_VAPID_PRIVATE_KEY":"private-key-fixture","ALERT_VAPID_SUBJECT":"mailto:admin@example.com","ALERT_SCHEDULER_SECRET":"scheduler-fixture","ALERT_ALLOWED_ORIGINS":"https://trading.example.com","YAHOO_API_BASE_URL":"https://api.example.com"}'::jsonb then
    raise exception 'Vault reader did not return exactly the six fixed settings';
  end if;
  begin
    perform 1 from vault.decrypted_secrets;
    raise exception 'service role received broad Vault access';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Defense in depth: even if somebody accidentally grants EXECUTE later, the
-- explicit caller-role guard must continue to reject browser database roles.
grant usage on schema public to anon, authenticated;
grant execute on function public.trading_alert_server_settings() to anon, authenticated;
set local role anon;
do $$
begin
  begin
    perform public.trading_alert_server_settings();
    raise exception 'anon bypassed caller-role guard';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
do $$
begin
  begin
    perform public.trading_alert_server_settings();
    raise exception 'authenticated bypassed caller-role guard';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
