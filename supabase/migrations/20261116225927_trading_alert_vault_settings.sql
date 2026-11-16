-- A narrowly scoped definer is needed to read fixed Vault values WITHOUT
-- granting service_role SELECT on every decrypted secret. User-data RPCs in
-- the preceding migration remain SECURITY INVOKER.
create function public.trading_alert_server_settings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text := coalesce(nullif(pg_catalog.current_setting('role', true), 'none'), session_user::text);
  result jsonb;
begin
  -- PostgREST sets the actual request role using SET LOCAL ROLE. current_user
  -- would instead be the definer here and must not be used as this guard.
  if caller_role not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'server_settings_forbidden' using errcode = '42501';
  end if;
  select coalesce(pg_catalog.jsonb_object_agg(spec.env_name, secret.decrypted_secret), '{}'::jsonb)
  into result
  from (values
    ('ALERT_VAPID_PUBLIC_KEY', 'trading_alert_vapid_public_key'),
    ('ALERT_VAPID_PRIVATE_KEY', 'trading_alert_vapid_private_key'),
    ('ALERT_VAPID_SUBJECT', 'trading_alert_vapid_subject'),
    ('ALERT_SCHEDULER_SECRET', 'trading_alert_scheduler_secret'),
    ('ALERT_ALLOWED_ORIGINS', 'trading_alert_allowed_origins'),
    ('YAHOO_API_BASE_URL', 'trading_alert_yahoo_api_base_url')
  ) as spec(env_name, vault_name)
  join vault.decrypted_secrets as secret on secret.name = spec.vault_name;
  return result;
end
$$;

revoke all on function public.trading_alert_server_settings() from public, anon, authenticated;
grant execute on function public.trading_alert_server_settings() to service_role;
