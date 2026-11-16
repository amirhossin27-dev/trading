import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { createSettingsLoader } from '../supabase/functions/trading-alerts/server-settings.mjs'
import { createHandler } from '../supabase/functions/trading-alerts/handler.mjs'

const bootstrap = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'built-in-server-key' }
const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' })
const vault = {
  ALERT_VAPID_PUBLIC_KEY: Buffer.from([4, ...Buffer.from(key.x, 'base64url'), ...Buffer.from(key.y, 'base64url')]).toString('base64url'),
  ALERT_VAPID_PRIVATE_KEY: key.d,
  ALERT_VAPID_SUBJECT: 'https://github.com/amirhossin27-dev/trading',
  ALERT_SCHEDULER_SECRET: Buffer.alloc(32, 7).toString('base64url'),
  ALERT_ALLOWED_ORIGINS: 'https://trading.example.com',
  YAHOO_API_BASE_URL: 'https://api.example.com',
}

test('Vault fills only fixed server settings and environment values take precedence', async () => {
  let calls = 0
  const db = { async rpc(name, args) { calls++; assert.equal(name, 'trading_alert_server_settings'); assert.equal(args, undefined); return { data: { ...vault, SUPABASE_SERVICE_ROLE_KEY: 'injected', arbitrary_secret: 'must-not-be-loaded' } } } }
  const loader = createSettingsLoader({ env: { ...bootstrap, ALERT_ALLOWED_ORIGINS: 'https://override.example.com' }, db })
  assert.deepEqual(await loader(), { ...bootstrap, ...vault, ALERT_ALLOWED_ORIGINS: 'https://override.example.com' })
  assert.equal(calls, 1)
})

test('complete environment configuration does not need Vault access', async () => {
  const loader = createSettingsLoader({ env: { ...bootstrap, ...vault }, db: { rpc() { throw new Error('Unexpected Vault access') } } })
  assert.deepEqual(await loader(), { ...bootstrap, ...vault })
})

test('settings cache coalesces requests and expires after thirty seconds', async () => {
  let stamp = 0
  let calls = 0
  const db = { async rpc() { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return { data: { ...vault, ALERT_VAPID_SUBJECT: calls === 1 ? vault.ALERT_VAPID_SUBJECT : 'mailto:rotated@example.com' } } } }
  const loader = createSettingsLoader({ env: bootstrap, db, now: () => stamp })
  const [first, second] = await Promise.all([loader(), loader()])
  assert.deepEqual(first, second)
  assert.equal(calls, 1)
  stamp = 29999
  assert.equal((await loader()).ALERT_VAPID_SUBJECT, vault.ALERT_VAPID_SUBJECT)
  assert.equal(calls, 1)
  stamp = 30000
  assert.equal((await loader()).ALERT_VAPID_SUBJECT, 'mailto:rotated@example.com')
  assert.equal(calls, 2)
})

test('failed Vault refresh fails closed without extending expired private settings', async () => {
  let stamp = 0
  let calls = 0
  const loader = createSettingsLoader({ env: bootstrap, now: () => stamp, db: { async rpc() { calls++; return calls === 1 ? { data: vault } : { error: { message: 'unavailable' } } } } })
  assert.equal((await loader()).ALERT_VAPID_PRIVATE_KEY, vault.ALERT_VAPID_PRIVATE_KEY)
  stamp = 30000
  assert.deepEqual(await loader(), bootstrap)
})

test('missing built-in service credentials prevents all Vault access', async () => {
  const env = { SUPABASE_URL: bootstrap.SUPABASE_URL }
  const loader = createSettingsLoader({ env, db: { rpc() { throw new Error('Must not query without server bootstrap') } } })
  assert.deepEqual(await loader(), env)
})

test('public HTTP config loaded from Vault never exposes private settings', async () => {
  let calls = 0
  const db = {
    async rpc(name) { assert.equal(name, 'trading_alert_server_settings'); calls++; return { data: vault } },
    from() { return { select() { return this }, eq() { return this }, single: async () => ({ data: { last_success_at: new Date().toISOString() } }) } },
  }
  const handler = createHandler({ env: bootstrap, db })
  const response = await handler(new Request('https://project.supabase.co/functions/v1/trading-alerts/config', { headers: { Origin: vault.ALERT_ALLOWED_ORIGINS } }))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.configured, true)
  assert.equal(result.vapidPublicKey, vault.ALERT_VAPID_PUBLIC_KEY)
  assert.equal(response.headers.get('access-control-allow-origin'), vault.ALERT_ALLOWED_ORIGINS)
  const serialized = JSON.stringify(result)
  for (const secret of [vault.ALERT_VAPID_PRIVATE_KEY, vault.ALERT_SCHEDULER_SECRET, bootstrap.SUPABASE_SERVICE_ROLE_KEY]) assert.equal(serialized.includes(secret), false)
  assert.equal(calls, 1)
})
