// Only these six application settings may cross the Vault RPC boundary.
// Supabase's built-in service credentials always come from the Edge environment.
const keys = [
  'ALERT_VAPID_PUBLIC_KEY', 'ALERT_VAPID_PRIVATE_KEY', 'ALERT_VAPID_SUBJECT',
  'ALERT_SCHEDULER_SECRET', 'ALERT_ALLOWED_ORIGINS', 'YAHOO_API_BASE_URL',
]

export function createSettingsLoader({ env, db, now = () => Date.now() }) {
  const environment = Object.freeze({ ...env })
  const complete = keys.every(key => Object.hasOwn(environment, key))
  let cached
  let expiresAt = 0
  let inFlight
  async function refresh() {
    const resolved = { ...environment }
    try {
      const request = db.rpc('trading_alert_server_settings')
      const result = await (request.abortSignal ? request.abortSignal(AbortSignal.timeout(5000)) : request)
      if (result.error || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new Error('settings_unavailable')
      for (const key of keys) {
        // An explicitly empty/invalid environment override must fail validation;
        // it must never silently reactivate an older Vault value.
        if (!Object.hasOwn(environment, key) && typeof result.data[key] === 'string') resolved[key] = result.data[key]
      }
    } catch {
      // No stale-secret extension and no error/header/secret logging on failure.
      // Incomplete settings are rejected by the handler's normal validation.
    }
    cached = Object.freeze(resolved)
    expiresAt = now() + 30_000
    return cached
  }
  return async function loadSettings() {
    if (complete || !db || !environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) return environment
    if (cached && now() < expiresAt) return cached
    const pending = inFlight ??= refresh()
    try { return await pending } finally { if (inFlight === pending) inFlight = undefined }
  }
}
