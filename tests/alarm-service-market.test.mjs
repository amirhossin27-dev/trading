import test from 'node:test'
import assert from 'node:assert/strict'
import { loadObservations } from '../supabase/functions/trading-alerts/market.mjs'
const now = Date.parse('2026-11-16T12:00:00Z')
const btc = { id: 'btc', source: 'binance', pair: 'BTCUSDT', coingecko: 'bitcoin' }
const aapl = { id: 'yf:AAPL', source: 'yahoo', yahoo: 'AAPL' }
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

test('market loader uses server timestamps and falls back for missing crypto rows', async () => {
  const quotes = await loadObservations([btc], { now, yahooBaseUrl: 'https://example.com', fetch: async url => {
    if (url.startsWith('https://api.binance.com/')) return response([])
    if (url.startsWith('https://api.coingecko.com/api/v3/simple/price?')) return response({ bitcoin: { usd: 101, last_updated_at: now / 1000 - 60 } })
    throw new Error('Unexpected URL')
  } })
  assert.deepEqual(quotes.get('btc'), { price: 101, currency: 'USD', observedAt: now - 60000, maxAgeMs: 300000 })
})

test('market loader discards stale exchange closes and valid crypto is retained during exchange outage', async () => {
  const quotes = await loadObservations([btc, aapl], { now, yahooBaseUrl: 'https://example.com', fetch: async url => {
    if (url.startsWith('https://api.binance.com/')) return response([{ symbol: 'BTCUSDT', lastPrice: '101', closeTime: now - 1000 }])
    if (url.startsWith('https://example.com/api/trading/candles?')) return response({ symbol: 'AAPL', currency: 'USD', candles: [{ t: now - 1200001, c: 250 }] })
    throw new Error('Unexpected URL')
  } })
  assert.equal(quotes.get('btc').price, 101)
  assert.equal(quotes.has('yf:AAPL'), false)
})

test('market loader obtains fresh Yahoo candles through fixed backend and uses source currency', async () => {
  const quotes = await loadObservations([aapl], { now, yahooBaseUrl: 'https://example.com/', fetch: async (url, options) => {
    assert.equal(url, 'https://example.com/api/trading/candles?symbol=AAPL&interval=5m&days=1')
    assert.equal(options.redirect, 'error')
    return response({ symbol: 'AAPL', currency: 'USD', candles: [{ t: now - 300000, c: 251 }, { t: now - 60000, c: 252 }] })
  } })
  assert.equal(quotes.get('yf:AAPL').price, 252)
  assert.equal(quotes.get('yf:AAPL').observedAt, now - 60000)
})

test('Binance calls stay within twenty symbols and duplicate asset requests are collapsed', async () => {
  const assets = Array.from({ length: 43 }, (_, i) => ({ ...btc, id: `coin${i}`, pair: `COIN${i}USDT`, coingecko: `coin-${i}` }))
  let calls = 0
  const quotes = await loadObservations([...assets, assets[0]], { now, yahooBaseUrl: 'https://example.com', fetch: async url => {
    const parsed = new URL(url)
    assert.equal(parsed.hostname, 'api.binance.com')
    const symbols = JSON.parse(parsed.searchParams.get('symbols'))
    assert.ok(symbols.length <= 20)
    calls++
    return response(symbols.map(symbol => ({ symbol, lastPrice: '1', closeTime: now })))
  } })
  assert.equal(calls, 3)
  assert.equal(quotes.size, 43)
})
