import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { createHandler } from '../supabase/functions/trading-alerts/handler.mjs'

const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' })
const env = {
  SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-test-key',
  ALERT_ALLOWED_ORIGINS: 'https://trading.example.com', YAHOO_API_BASE_URL: 'https://api.example.com',
  ALERT_VAPID_PUBLIC_KEY: Buffer.from([4, ...Buffer.from(keys.x, 'base64url'), ...Buffer.from(keys.y, 'base64url')]).toString('base64url'),
  ALERT_VAPID_PRIVATE_KEY: keys.d, ALERT_VAPID_SUBJECT: 'mailto:admin@example.com', ALERT_SCHEDULER_SECRET: 's'.repeat(64),
}
const forbiddenDb = { rpc() { throw new Error('Database access should not occur') }, from() { throw new Error('Database access should not occur') } }
const deviceId = '11111111-1111-4111-8111-111111111111'
const deviceToken = Buffer.alloc(32, 1).toString('base64url')
const deviceHeaders = { 'X-Device-Id': deviceId, 'X-Device-Token': deviceToken, 'Content-Type': 'application/json' }
function authenticationDb() {
  return {
    async rpc(name) { assert.equal(name, 'trading_alert_rate_limit'); return { data: true } },
    from(table) {
      assert.equal(table, 'trading_alert_devices', 'Invalid input must not reach another table')
      const matches = {}
      return { select() { return this }, eq(key, value) { matches[key] = value; return this }, async maybeSingle() {
        return { data: matches.id === deviceId && matches.token_hash === createHash('sha256').update(deviceToken).digest('hex') ? { id: deviceId } : null }
      } }
    },
  }
}

test('missing configuration returns honest config state with no secrets or public key', async () => {
  const handler = createHandler({ env: {}, db: forbiddenDb })
  const response = await handler(new Request('https://project.supabase.co/functions/v1/trading-alerts/config'))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { configured: false, vapidPublicKey: null, checkIntervalSeconds: 60, lastCheckedAt: null, code: 'server_not_configured' })
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('device routes reject project API keys as a substitute for device credentials', async () => {
  const handler = createHandler({ env, db: forbiddenDb })
  const response = await handler(new Request('https://project.supabase.co/functions/v1/trading-alerts/events', { headers: { apikey: 'public-project-key', Authorization: 'Bearer public-project-key', Origin: env.ALERT_ALLOWED_ORIGINS } }))
  assert.equal(response.status, 401)
  assert.equal((await response.json()).code, 'unauthorized')
  assert.equal(response.headers.get('access-control-allow-origin'), env.ALERT_ALLOWED_ORIGINS)
})

test('scheduler requires its separate secret and disallowed origins get no CORS grant', async () => {
  const handler = createHandler({ env, db: forbiddenDb })
  const response = await handler(new Request('https://project.supabase.co/functions/v1/trading-alerts/check', { method: 'POST', headers: { 'x-scheduler-secret': 'wrong' } }))
  assert.equal(response.status, 401)
  const crossOrigin = await handler(new Request('https://project.supabase.co/functions/v1/trading-alerts/config', { headers: { Origin: 'https://evil.example.com' } }))
  assert.equal(crossOrigin.status, 403)
  assert.equal(crossOrigin.headers.get('access-control-allow-origin'), null)
})

test('registration rejects oversized bodies and invalid JSON before any database writes', async () => {
  const handler = createHandler({ env, db: forbiddenDb })
  for (const [body, status] of [['not json', 400], ['{"padding":"' + 'a'.repeat(17000) + '"}', 413], ['[]', 400]]) {
    const response = await handler(new Request('https://project.supabase.co/functions/v1/trading-alerts/register', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }))
    assert.equal(response.status, status)
  }
})

test('configured server without a recent scheduler heartbeat does not advertise monitoring', async () => {
  const handler = createHandler({ env, db: { from() { return { select() { return this }, eq() { return this }, single: async () => ({ data: { last_success_at: '2000-01-01T00:00:00Z' } }) } } } })
  const response = await handler(new Request('https://project.supabase.co/functions/v1/trading-alerts/config'))
  const config = await response.json()
  assert.equal(config.configured, false)
  assert.equal(config.code, 'monitoring_not_ready')
  assert.equal(config.vapidPublicKey, env.ALERT_VAPID_PUBLIC_KEY)
  assert.equal(JSON.stringify(config).includes(env.ALERT_SCHEDULER_SECRET), false)
  assert.equal(JSON.stringify(config).includes(env.ALERT_VAPID_PRIVATE_KEY), false)
})

test('mismatched VAPID key pairs are rejected before reporting configured monitoring', async () => {
  const otherKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' })
  const handler = createHandler({ env: { ...env, ALERT_VAPID_PRIVATE_KEY: otherKeys.d }, db: forbiddenDb })
  const response = await handler(new Request('https://project.supabase.co/functions/v1/trading-alerts/config'))
  assert.equal((await response.json()).code, 'server_not_configured')
})

test('a well-formed but incorrect capability cannot read device events', async () => {
  const handler = createHandler({ env, db: authenticationDb() })
  const response = await handler(new Request('https://project.supabase.co/functions/v1/trading-alerts/events', { headers: { ...deviceHeaders, 'X-Device-Token': Buffer.alloc(32, 2).toString('base64url') } }))
  assert.equal(response.status, 401)
  assert.equal((await response.json()).code, 'unauthorized')
})

test('invalid curve points are rejected before a push subscription is stored', async () => {
  const handler = createHandler({ env, db: authenticationDb() })
  const body = { subscription: { endpoint: 'https://web.push.apple.com/test', keys: { p256dh: Buffer.from([4, ...new Array(64).fill(1)]).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } } }
  const response = await handler(new Request('https://project.supabase.co/functions/v1/trading-alerts/subscribe', { method: 'POST', headers: deviceHeaders, body: JSON.stringify(body) }))
  assert.equal(response.status, 400)
  assert.equal((await response.json()).code, 'invalid_input')
})
