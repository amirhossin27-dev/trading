-- Infrastructure only. The job is deliberately scheduled after protected Vault values and the function exist.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
