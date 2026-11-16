import { InputError, UUID, base64urlBytes, validateDeviceCredentials, validateAlarmInput, validateSubscription, alarmDto, eventDto, notificationPayload } from './domain.mjs'
import { loadObservations, parallelLimit } from './market.mjs'
import { createSettingsLoader } from './server-settings.mjs'
import { createECDH, timingSafeEqual } from 'node:crypto'

const noCache = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', Vary: 'Origin' }
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const sha256 = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('')

function settings(env) {
  try {
    const origins = (env.ALERT_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (!origins.length || origins.some(s => new URL(s).origin !== s)) return null
    const base = new URL(env.YAHOO_API_BASE_URL)
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) return null
    const publicKey = base64urlBytes(env.ALERT_VAPID_PUBLIC_KEY, 65)
    const privateKey = base64urlBytes(env.ALERT_VAPID_PRIVATE_KEY, 32)
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(privateKey)
    if (!timingSafeEqual(ecdh.getPublicKey(), publicKey)) return null
    if (!env.ALERT_VAPID_SUBJECT?.match(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/) || !env.ALERT_SCHEDULER_SECRET || env.ALERT_SCHEDULER_SECRET.length < 43 || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null
    return { origins, yahooBaseUrl: base.href.replace(/\/$/, ''), vapid: { subject: env.ALERT_VAPID_SUBJECT, publicKey: env.ALERT_VAPID_PUBLIC_KEY, privateKey: env.ALERT_VAPID_PRIVATE_KEY } }
  } catch { return null }
}

async function jsonBody(req) {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new InputError('Send application/json.')
  if (Number(req.headers.get('content-length')) > 16_384) throw new InputError('Request body too large.', 'invalid_input', 413)
  const reader = req.body?.getReader()
  let size = 0
  const parts = []
  if (reader) while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.length
    if (size > 16_384) { await reader.cancel(); throw new InputError('Request body too large.', 'invalid_input', 413) }
    parts.push(chunk.value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  try {
    const result = JSON.parse(new TextDecoder().decode(bytes))
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error()
    return result
  } catch { throw new InputError('Invalid JSON object.') }
}

function unwrap(result) {
  if (!result.error) return result.data
  const codes = { not_found: [404, 'Item not found.'], ack_required: [409, 'Acknowledge the triggered event first.'], id_conflict: [409, 'This id already belongs to another alarm.'], alarm_limit: [429, 'A device can save at most 100 alarms.'] }
  const known = codes[result.error.message]
  if (known) throw new InputError(known[1], result.error.message, known[0])
  throw new Error('database_unavailable')
}

export function createHandler(options) {
  const loadSettings = createSettingsLoader(options)
  // Each request owns its validated snapshot. A Vault refresh cannot change
  // scheduler authorization or VAPID keys halfway through a concurrent request.
  return async req => createConfiguredHandler({ ...options, env: await loadSettings() })(req)
}

function createConfiguredHandler({ env, db, webpush, fetch: fetcher = fetch, now = () => Date.now(), workerTiming = {} }) {
  const config = settings(env)
  const timing = { workMs: 48_000, observationMs: 18_000, databaseMs: 5_000, deliveryMs: 14_000, ...workerTiming }
  const query = async (request, signal) => unwrap(await (signal && request.abortSignal ? request.abortSignal(signal) : request))
  const rpc = async (name, args, signal) => query(db.rpc(`trading_alert_${name}`, args), signal)
  const rate = async (key, limit, seconds) => {
    if (!await rpc('rate_limit', { p_key: key, p_limit: limit, p_seconds: seconds })) throw new InputError('Too many requests. Try again later.', 'rate_limited', 429)
  }
  async function health() {
    if (!config || !db) return { configured: false, vapidPublicKey: null, checkIntervalSeconds: 60, lastCheckedAt: null, code: 'server_not_configured' }
    try {
      const worker = unwrap(await db.from('trading_alert_worker').select('last_success_at').eq('singleton', true).single())
      const stamp = worker?.last_success_at
      const healthy = stamp && now() - Date.parse(stamp) < 300_000 && Date.parse(stamp) <= now() + 30_000
      return { configured: !!healthy, vapidPublicKey: config.vapid.publicKey, checkIntervalSeconds: 60, lastCheckedAt: stamp ?? null, code: healthy ? null : 'monitoring_not_ready' }
    } catch { return { configured: false, vapidPublicKey: config.vapid.publicKey, checkIntervalSeconds: 60, lastCheckedAt: null, code: 'monitoring_not_ready' } }
  }
  async function requireMonitoring() {
    const status = await health()
    if (!status.configured) throw new InputError('Background monitoring is not ready. Check server configuration and scheduler.', status.code, 503)
  }
  async function activeSubscription(deviceId) {
    const row = unwrap(await db.from('trading_alert_subscriptions').select('*').eq('device_id', deviceId).maybeSingle())
    if (!row?.active) return null
    try { validateSubscription(row.subscription, now()); return row } catch {
      unwrap(await db.from('trading_alert_subscriptions').update({ active: false }).eq('device_id', deviceId).eq('endpoint_hash', row.endpoint_hash))
      return null
    }
  }
  async function push(subscription, payload, topic, signal) {
    // Revalidate stored endpoints too; redirects must never escape the allowlist.
    const valid = validateSubscription(subscription, now())
    const details = webpush.generateRequestDetails(valid, JSON.stringify(payload), {
      vapidDetails: config.vapid, TTL: 86400, urgency: 'high', contentEncoding: 'aes128gcm', topic,
    })
    const timeout = AbortSignal.timeout(8000)
    const response = await fetcher(valid.endpoint, { method: details.method, headers: details.headers, body: details.body, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    await response.body?.cancel()
    return response.status
  }
  async function check() {
    const owner = crypto.randomUUID()
    const started = performance.now()
    const deadline = AbortSignal.timeout(timing.workMs)
    const bounded = phase => AbortSignal.any([deadline, ...(phase ? [phase] : []), AbortSignal.timeout(timing.databaseMs)])
    if (!await rpc('acquire', { p_owner: owner }, bounded())) return { skipped: true }
    let finished = false
    try {
      const alarms = await query(db.from('trading_alert_alarms').select('*').eq('status', 'active').order('last_checked_at', { ascending: true, nullsFirst: true }).limit(200), bounded()) ?? []
      const byAsset = new Map()
      for (const alarm of alarms) byAsset.set(alarm.asset.id, [...(byAsset.get(alarm.asset.id) ?? []), alarm])
      // Reserve the complete delivery phase and finish write even if the initial
      // DB requests were slow. Persistence gets one DB-call grace period after
      // source cancellation; it never waits for every quote before making progress.
      const remaining = timing.workMs - (performance.now() - started)
      const observationMs = Math.max(1, Math.floor(Math.min(timing.observationMs, remaining - timing.deliveryMs - 2 * timing.databaseMs)))
      const sourceDeadline = AbortSignal.any([deadline, AbortSignal.timeout(observationMs)])
      const persistenceDeadline = AbortSignal.any([deadline, AbortSignal.timeout(observationMs + timing.databaseMs)])
      let checked = 0
      const observations = await loadObservations(alarms.map(a => a.asset), {
        now: now(), yahooBaseUrl: config.yahooBaseUrl, fetch: fetcher, signal: sourceDeadline,
        onResult: async (asset, observation) => parallelLimit(byAsset.get(asset.id) ?? [], 6, async alarm => {
          if (persistenceDeadline.aborted) return
          try {
            if (!observation || observation.currency !== alarm.currency) {
              await query(db.from('trading_alert_alarms').update({ last_error: observation ? 'currency_mismatch' : 'price_unavailable_or_stale', last_checked_at: new Date(now()).toISOString() }).eq('id', alarm.id).eq('status', 'active').eq('generation', alarm.generation), bounded(persistenceDeadline))
            } else {
              await rpc('observe', { p_owner: owner, p_alarm_id: alarm.id, p_generation: alarm.generation, p_price: observation.price, p_currency: observation.currency, p_observed_at: new Date(observation.observedAt).toISOString(), p_max_age_seconds: observation.maxAgeMs / 1000 }, bounded(persistenceDeadline))
            }
            checked++
          } catch (error) {
            if (!persistenceDeadline.aborted) throw error
          }
        }, persistenceDeadline),
      })
      const deliveryDeadline = AbortSignal.any([deadline, AbortSignal.timeout(timing.deliveryMs)])
      const events = await rpc('claim_deliveries', { p_owner: owner, p_limit: 12 }, bounded(deliveryDeadline))
      await parallelLimit(events ?? [], 6, async event => {
        if (deliveryDeadline.aborted) return
        let status = 0
        let subscriptionRow
        try {
          // Ack can race delivery; re-read immediately before sending and after claim.
          const current = await query(db.from('trading_alert_events').select('acknowledged_at,delivery_status').eq('id', event.id).single(), bounded(deliveryDeadline))
          if (current.acknowledged_at || current.delivery_status !== 'pending') return
          subscriptionRow = await query(db.from('trading_alert_subscriptions').select('*').eq('device_id', event.device_id).eq('active', true).maybeSingle(), bounded(deliveryDeadline))
          if (subscriptionRow) status = await push(subscriptionRow.subscription, notificationPayload(event), event.id.replace(/-/g, ''), deliveryDeadline)
          if ([404, 410].includes(status) && subscriptionRow) await query(db.from('trading_alert_subscriptions').update({ active: false }).eq('device_id', event.device_id).eq('endpoint_hash', subscriptionRow.endpoint_hash), bounded(deliveryDeadline))
        } catch (error) {
          if (deliveryDeadline.aborted) return
          status = 0
          if (error instanceof InputError && subscriptionRow) await query(db.from('trading_alert_subscriptions').update({ active: false }).eq('device_id', event.device_id).eq('endpoint_hash', subscriptionRow.endpoint_hash), bounded(deliveryDeadline))
        }
        // Failure/missing subscription leaves the event durable and retryable.
        if (!deliveryDeadline.aborted) {
          try { await rpc('delivery_result', { p_owner: owner, p_event_id: event.id, p_status: status }, bounded(deliveryDeadline)) }
          catch (error) { if (!deliveryDeadline.aborted) throw error }
        }
      }, deliveryDeadline)
      if (deadline.aborted) throw new Error('worker_timeout')
      await rpc('finish', { p_owner: owner, p_success: true, p_error: null }, bounded())
      finished = true
      return { checked, observed: observations.size, deliveries: events?.length ?? 0 }
    } finally {
      if (!finished) await rpc('finish', { p_owner: owner, p_success: false, p_error: 'worker_failed' }, AbortSignal.timeout(timing.databaseMs)).catch(() => {})
    }
  }
  return async function handler(req) {
    const origin = req.headers.get('origin')
    const allowed = config?.origins ?? (env.ALERT_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim())
    const cors = origin && allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type,X-Device-Id,X-Device-Token,apikey', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Max-Age': '600' } : {}
    const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...noCache, ...cors, ...(status === 429 ? { 'Retry-After': '60' } : {}) } })
    try {
      if (origin && !allowed.includes(origin)) throw new InputError('Origin is not allowed.', 'origin_not_allowed', 403)
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, Vary: 'Origin' } })
      const url = new URL(req.url)
      const prefix = '/trading-alerts'
      const position = url.pathname.indexOf(prefix)
      const path = position >= 0 ? url.pathname.slice(position + prefix.length).replace(/\/$/, '') || '/' : url.pathname.replace(/\/$/, '') || '/'
      if (req.method === 'GET' && path === '/config') return respond(await health())
      if (!config || !db) throw new InputError('Price alarm server is not configured.', 'server_not_configured', 503)
      if (path === '/check') {
        if (req.method !== 'POST' || !req.headers.get('x-scheduler-secret') || !timingSafeEqual(new TextEncoder().encode(await sha256(req.headers.get('x-scheduler-secret'))), new TextEncoder().encode(await sha256(env.ALERT_SCHEDULER_SECRET)))) throw new InputError('Scheduler authentication required.', 'unauthorized', 401)
        return respond(await check())
      }
      // The trusted platform-forwarded last hop is used only as an abuse control,
      // never as identity. Device identity is the random capability below.
      const ip = req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? 'unknown'
      const ipHash = await sha256(`${env.ALERT_SCHEDULER_SECRET}:${ip}`)
      if (req.method === 'POST' && path === '/register') {
        await jsonBody(req)
        await rate(`register:${ipHash}`, 10, 3600)
        await rate('register:global', 100, 3600)
        const deviceToken = encode(crypto.getRandomValues(new Uint8Array(32)))
        const deviceId = crypto.randomUUID()
        unwrap(await db.from('trading_alert_devices').insert({ id: deviceId, token_hash: await sha256(deviceToken) }))
        return respond({ deviceId, deviceToken }, 201)
      }
      const credentials = validateDeviceCredentials(req.headers.get('x-device-id'), req.headers.get('x-device-token'))
      await rate(`auth:${ipHash}`, 180, 60)
      const device = unwrap(await db.from('trading_alert_devices').select('id').eq('id', credentials.deviceId).eq('token_hash', await sha256(credentials.deviceToken)).maybeSingle())
      if (!device) throw new InputError('Device authentication required.', 'unauthorized', 401)
      await rate(`device:${device.id}`, 120, 60)
      if (req.method === 'POST' && path === '/subscribe') {
        const body = await jsonBody(req)
        const subscription = validateSubscription(body.subscription, now())
        try { await crypto.subtle.importKey('raw', base64urlBytes(subscription.keys.p256dh, 65), { name: 'ECDH', namedCurve: 'P-256' }, false, []) } catch { throw new InputError('Invalid P-256 push encryption key.') }
        const result = await db.from('trading_alert_subscriptions').upsert({ device_id: device.id, subscription, endpoint_hash: await sha256(subscription.endpoint), active: true, updated_at: new Date(now()).toISOString() }, { onConflict: 'device_id' })
        if (result.error?.code === '23505') throw new InputError('This push subscription already belongs to another device.', 'subscription_conflict', 409)
        unwrap(result)
        unwrap(await db.from('trading_alert_events').update({ next_attempt_at: new Date(now()).toISOString() }).eq('device_id', device.id).eq('delivery_status', 'pending').is('acknowledged_at', null))
        return respond({ subscribed: true })
      }
      if (req.method === 'POST' && path === '/test-push') {
        await jsonBody(req)
        await rate(`test:${device.id}`, 10, 3600)
        const row = await activeSubscription(device.id)
        if (!row) throw new InputError('Activate system notifications first.', 'subscription_required', 409)
        let status = 0
        try { status = await push(row.subscription, { type: 'push-test', title: 'Trading: Mitteilungen aktiviert', body: 'Die Testmitteilung wurde erfolgreich gesendet.' }, 'trading-push-test') } catch { /* Report failure, never a false success. */ }
        if (status < 200 || status > 299) {
          if ([404, 410].includes(status)) unwrap(await db.from('trading_alert_subscriptions').update({ active: false }).eq('device_id', device.id).eq('endpoint_hash', row.endpoint_hash))
          throw new InputError('The push provider did not accept the test notification.', 'push_unavailable', 503)
        }
        return respond({ sent: true })
      }
      if (req.method === 'GET' && path === '/alarms') {
        const rows = unwrap(await db.from('trading_alert_alarms').select('*').eq('device_id', device.id).order('created_at', { ascending: false }).limit(100)) ?? []
        const subscription = await activeSubscription(device.id)
        const status = await health()
        return respond({ alarms: rows.map(alarmDto), lastCheckedAt: status.lastCheckedAt, monitoringHealthy: status.configured, subscriptionActive: subscription?.active === true })
      }
      if (req.method === 'POST' && path === '/alarms') {
        const input = validateAlarmInput(await jsonBody(req))
        await requireMonitoring()
        const subscription = await activeSubscription(device.id)
        if (!subscription?.active) throw new InputError('Activate system notifications first.', 'subscription_required', 409)
        const row = await rpc('create', { p_device_id: device.id, p_id: input.id ?? crypto.randomUUID(), p_asset: input.asset, p_direction: input.direction, p_target: input.target, p_currency: input.currency })
        return respond({ alarm: alarmDto(row) }, 201)
      }
      const alarmRoute = /^\/alarms\/([0-9a-f-]+)(\/rearm)?$/i.exec(path)
      if (alarmRoute && UUID.test(alarmRoute[1])) {
        if (req.method === 'DELETE' && !alarmRoute[2]) {
          const deleted = await rpc('delete', { p_device_id: device.id, p_alarm_id: alarmRoute[1] })
          if (!deleted) throw new InputError('Alarm not found.', 'not_found', 404)
          return respond({ deleted: true })
        }
        if (req.method === 'POST' && alarmRoute[2]) {
          await jsonBody(req)
          await requireMonitoring()
          const subscription = await activeSubscription(device.id)
          if (!subscription?.active) throw new InputError('Activate system notifications first.', 'subscription_required', 409)
          const row = await rpc('rearm', { p_device_id: device.id, p_alarm_id: alarmRoute[1] })
          return respond({ alarm: alarmDto(row) })
        }
      }
      if (req.method === 'GET' && path === '/events') {
        const pending = unwrap(await db.from('trading_alert_events').select('*').eq('device_id', device.id).is('acknowledged_at', null).order('triggered_at', { ascending: false }).limit(100)) ?? []
        const history = unwrap(await db.from('trading_alert_events').select('*').eq('device_id', device.id).not('acknowledged_at', 'is', null).order('triggered_at', { ascending: false }).limit(100)) ?? []
        return respond({ events: [...pending, ...history].map(eventDto) })
      }
      if (req.method === 'POST' && path === '/ack') {
        const body = await jsonBody(req)
        if (typeof body.eventId !== 'string' || !UUID.test(body.eventId)) throw new InputError('Invalid event id.')
        const event = await rpc('ack', { p_device_id: device.id, p_event_id: body.eventId })
        return respond({ event: eventDto(event) })
      }
      throw new InputError('Route not found.', 'not_found', 404)
    } catch (error) {
      if (error instanceof InputError) return respond({ error: error.message, code: error.code }, error.status)
      // Do not log request headers, subscription endpoints, capabilities or secrets.
      console.error('trading-alerts request failed')
      return respond({ error: 'Alarm service temporarily unavailable.', code: 'internal_error' }, 500)
    }
  }
}
