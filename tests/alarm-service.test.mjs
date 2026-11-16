import test from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateAlarm, validateAlarmInput, validateSubscription, validatePushEndpoint,
  isFreshObservation, notificationPayload, validateDeviceCredentials,
} from '../supabase/functions/trading-alerts/domain.mjs'

const asset = { id: 'btc', source: 'binance', pair: 'BTCUSDT', coingecko: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', group: 'crypto' }
const now = Date.parse('2026-11-16T12:00:00Z')
const alarm = { id: '2feea3b8-eb5f-492d-bc98-87c5463a3d96', asset, target: 100, currency: 'USD', direction: 'above', status: 'active', lastPrice: 99 }
const quote = { price: 101, currency: 'USD', observedAt: now - 1000, maxAgeMs: 300000 }
const encode = bytes => Buffer.from(bytes).toString('base64url')
const subscription = { endpoint: 'https://web.push.apple.com/QHSf27/test', expirationTime: null, keys: { p256dh: encode(Uint8Array.from([4, ...new Array(64).fill(1)])), auth: encode(new Uint8Array(16).fill(1)) } }

test('price alarms include exact equality and jumps across either boundary', () => {
  assert.equal(evaluateAlarm(alarm, quote, now), true)
  assert.equal(evaluateAlarm(alarm, { ...quote, price: 100 }, now), true)
  assert.equal(evaluateAlarm(alarm, { ...quote, price: 99.99 }, now), false)
  assert.equal(evaluateAlarm({ ...alarm, direction: 'below', lastPrice: 105 }, { ...quote, price: 95 }, now), true)
  assert.equal(evaluateAlarm({ ...alarm, direction: 'below', lastPrice: 105 }, { ...quote, price: 100 }, now), true)
})

test('first valid observation can trigger and only active alarms can trigger', () => {
  assert.equal(evaluateAlarm({ ...alarm, lastPrice: null }, quote, now), true)
  assert.equal(evaluateAlarm({ ...alarm, status: 'triggered' }, quote, now), false)
  assert.equal(evaluateAlarm({ ...alarm, status: 'acked' }, quote, now), false)
  assert.equal(evaluateAlarm({ ...alarm, lastPrice: 102 }, quote, now), false)
})

test('stale, future, invalid and mismatched currency observations never fire', () => {
  for (const change of [{ observedAt: now - 300001 }, { observedAt: now + 30001 }, { price: NaN }, { price: Infinity }, { price: -1 }, { currency: 'EUR' }]) {
    assert.equal(evaluateAlarm(alarm, { ...quote, ...change }, now), false)
  }
  assert.equal(isFreshObservation({ ...quote, observedAt: now - 300000 }, now), true)
})

test('alarm validation rejects unsafe assets and bounds and keeps exact small prices', () => {
  const input = { ...alarm, target: 0.00000001 }
  assert.equal(validateAlarmInput(input).target, 0.00000001)
  for (const change of [{ target: 0 }, { target: -1 }, { target: 1e16 }, { target: NaN }, { target: '100' }, { direction: 'sideways' }, { currency: 'US Dollar' }, { asset: { ...asset, pair: 'BTCUSDT&symbols=ANY' } }, { asset: { ...asset, id: '../btc' } }, { asset: { ...asset, source: 'https://localhost' } }]) {
    assert.throws(() => validateAlarmInput({ ...input, ...change }))
  }
  assert.throws(() => validateAlarmInput({ ...input, currency: 'EUR' }))
  assert.throws(() => validateAlarmInput({ ...input, asset: { id: 'yf:AAPL', source: 'yahoo', yahoo: '../../private', symbol: 'AAPL', name: 'Apple', group: 'stock' } }))
})

test('push endpoints only allow exact known HTTPS provider hosts without redirects or credentials', () => {
  for (const url of ['https://web.push.apple.com/a', 'https://fcm.googleapis.com/fcm/send/a', 'https://updates.push.services.mozilla.com/wpush/v2/a']) assert.equal(validatePushEndpoint(url), url)
  for (const url of ['http://web.push.apple.com/a', 'https://web.push.apple.com.evil.test/a', 'https://evil.web.push.apple.com/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://169.254.169.254/latest/meta-data', 'https://web.push.apple.com:444/a', 'https://user:secret@web.push.apple.com/a', 'https://fcm.googleapis.com/a#secret', 'file:///etc/passwd']) assert.throws(() => validatePushEndpoint(url))
})

test('push subscriptions require correctly sized uncompressed encryption keys and unexpired time', () => {
  assert.equal(validateSubscription(subscription, now).endpoint, subscription.endpoint)
  for (const bad of [{ ...subscription, keys: {} }, { ...subscription, keys: { ...subscription.keys, auth: 'a' } }, { ...subscription, keys: { ...subscription.keys, p256dh: encode(new Uint8Array(65)) } }, { ...subscription, expirationTime: now - 1 }, { ...subscription, expirationTime: 'tomorrow' }]) assert.throws(() => validateSubscription(bad, now))
})

test('device capabilities require a UUID and exactly 256 bits of URL safe token', () => {
  assert.equal(validateDeviceCredentials(alarm.id, encode(new Uint8Array(32))).deviceId, alarm.id)
  assert.throws(() => validateDeviceCredentials(alarm.id, 'guess'))
  assert.throws(() => validateDeviceCredentials('../other', encode(new Uint8Array(32))))
})

test('notification payload carries a durable event id and chart destination without credentials or arbitrary URL', () => {
  const payload = notificationPayload({ id: 'evt', alarm_id: alarm.id, asset, target: 100, currency: 'USD', observed_price: 101, triggered_at: '2026-11-16T12:00:00Z' })
  assert.deepEqual(payload, { type: 'price-alert', eventId: 'evt', asset, target: 100, currency: 'USD', observedPrice: 101, triggeredAt: '2026-11-16T12:00:00Z', range: '1W', mode: 'candles' })
})
