import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { createHandler } from '../supabase/functions/trading-alerts/handler.mjs'

const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' })
const publicKey = Buffer.from([4, ...Buffer.from(key.x, 'base64url'), ...Buffer.from(key.y, 'base64url')]).toString('base64url')
const env = {
  SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-test-key',
  ALERT_ALLOWED_ORIGINS: 'https://trading.example.com', YAHOO_API_BASE_URL: 'https://api.example.com',
  ALERT_VAPID_PUBLIC_KEY: publicKey, ALERT_VAPID_PRIVATE_KEY: key.d,
  ALERT_VAPID_SUBJECT: 'mailto:admin@example.com', ALERT_SCHEDULER_SECRET: 's'.repeat(64),
}
const btc = { id: 'btc', source: 'binance', pair: 'BTCUSDT', coingecko: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', group: 'crypto' }
const cryptoAlarm = { id: '11111111-1111-4111-8111-111111111111', device_id: '22222222-2222-4222-8222-222222222222', asset: btc, generation: 1, status: 'active', direction: 'above', target: 100, currency: 'USD', last_price: 99 }
const pendingEvent = { id: '33333333-3333-4333-8333-333333333333', device_id: cryptoAlarm.device_id, alarm_id: cryptoAlarm.id, asset: btc, target: 100, currency: 'USD', observed_price: 101, triggered_at: '2026-11-16T12:00:00Z', delivery_status: 'pending', acknowledged_at: null }
const subscription = { endpoint: 'https://web.push.apple.com/worker-regression-test', keys: { p256dh: publicKey, auth: Buffer.alloc(16, 1).toString('base64url') } }

test('slow exchange requests cannot discard completed crypto observations or starve pending pushes', { timeout: 4000 }, async () => {
  const alarms = [cryptoAlarm, ...Array.from({ length: 30 }, (_, i) => ({ ...cryptoAlarm, id: `yahoo-${i}`, asset: { id: `yf:TEST${i}`, source: 'yahoo', yahoo: `TEST${i}` } }))]
  let sourceCompletions = 0
  let sourceStarts = 0
  let observedBeforeSlowSource = false
  let sent = false
  let delivered = false
  let successfulFinish = false
  const checkedIds = new Set()
  const db = {
    async rpc(name, args) {
      if (name === 'trading_alert_acquire') return { data: true }
      if (name === 'trading_alert_observe') {
        assert.equal(args.p_alarm_id, cryptoAlarm.id)
        assert.equal(args.p_price, 101)
        observedBeforeSlowSource = sourceCompletions === 0
        checkedIds.add(args.p_alarm_id)
        return { data: 'new-event' }
      }
      if (name === 'trading_alert_claim_deliveries') return { data: [pendingEvent] }
      if (name === 'trading_alert_delivery_result') { assert.equal(args.p_status, 201); delivered = true; return { data: true } }
      if (name === 'trading_alert_finish') { successfulFinish = args.p_success; return { data: true } }
      throw new Error(`Unexpected RPC ${name}`)
    },
    from(table) {
      const filters = {}
      let changes
      const query = {
        select() { return this }, eq(field, value) { filters[field] = value; return this },
        order() { return this }, limit() { return this }, abortSignal() { return this },
        update(value) { changes = value; return this },
        async single() { assert.equal(table, 'trading_alert_events'); return { data: pendingEvent } },
        async maybeSingle() { assert.equal(table, 'trading_alert_subscriptions'); return { data: { subscription, active: true, endpoint_hash: 'test-endpoint' } } },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            assert.equal(table, 'trading_alert_alarms')
            if (changes) { checkedIds.add(filters.id); return { data: null } }
            return { data: alarms }
          }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const fetcher = async (url, options) => {
    if (url.startsWith('https://api.binance.com/')) return new Response(JSON.stringify([{ symbol: 'BTCUSDT', lastPrice: '101', closeTime: Date.now() }]))
    if (url.startsWith('https://api.example.com/')) {
      sourceStarts++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { sourceCompletions++; resolve(new Response('{"symbol":"stale","candles":[]}')) }, 80)
        options.signal.addEventListener('abort', () => { clearTimeout(timer); sourceCompletions++; reject(options.signal.reason) }, { once: true })
      })
    }
    assert.equal(url, subscription.endpoint)
    assert.equal(checkedIds.has(cryptoAlarm.id), true, 'completed observations must be persisted before delivery')
    sent = true
    return new Response(null, { status: 201 })
  }
  const handler = createHandler({ env, db, webpush: { generateRequestDetails: () => ({ method: 'POST', headers: {}, body: new Uint8Array([1]) }) }, fetch: fetcher,
    workerTiming: { observationMs: 25, workMs: 1500, databaseMs: 100, deliveryMs: 500 },
  })
  const response = await handler(new Request('https://project.supabase.co/functions/v1/trading-alerts/check', { method: 'POST', headers: { 'X-Scheduler-Secret': env.ALERT_SCHEDULER_SECRET } }))
  assert.equal(response.status, 200)
  assert.equal(observedBeforeSlowSource, true, 'crypto persistence must not await all exchange requests')
  assert.ok(sourceStarts <= 4, 'the phase deadline must stop launching queued exchange requests')
  assert.equal(sent, true)
  assert.equal(delivered, true)
  assert.equal(successfulFinish, true)
  assert.ok(checkedIds.size > 1, 'attempted failures must advance the oldest-check queue')
  assert.ok(checkedIds.size < alarms.length, 'unstarted requests must remain available to the next worker')
})
