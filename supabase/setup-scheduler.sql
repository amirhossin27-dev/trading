-- Deliberate provisioning step AFTER migration, secrets, and Edge Function deploy.
-- Do not paste real secrets into source control. Create these two Vault values in
-- the Supabase dashboard first: trading_alert_project_url and
-- trading_alert_scheduler_secret. The latter must match ALERT_SCHEDULER_SECRET.
-- pg_cron and pg_net are installed by the scheduler_extensions migration.

do $$
declare project_url text; scheduler_secret text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'trading_alert_project_url';
  select decrypted_secret into scheduler_secret from vault.decrypted_secrets where name = 'trading_alert_scheduler_secret';
  if project_url is null or project_url !~ '^https://[a-z0-9-]+\.supabase\.co$' then raise exception 'Set trading_alert_project_url in Vault first'; end if;
  if scheduler_secret is null or length(scheduler_secret) < 43 then raise exception 'Set trading_alert_scheduler_secret in Vault first'; end if;
end $$;

select cron.schedule(
  'trading-price-alerts-every-minute',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'trading_alert_project_url') || '/functions/v1/trading-alerts/check',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Scheduler-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'trading_alert_scheduler_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 58000
    );
  $job$
);
