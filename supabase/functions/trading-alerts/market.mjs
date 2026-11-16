import { isFreshObservation } from './domain.mjs'

export function chunks(values, size = 20) {
  const result = []
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size))
  return result
}

export async function parallelLimit(items, limit, operation, signal) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => {
    while (next < items.length && !signal?.aborted) await operation(items[next++])
  }))
}

export async function loadObservations(assets, options) {
  const now = options.now ?? Date.now()
  const fetcher = options.fetch ?? fetch
  const observations = new Map()
  const completed = new Set()
  const attemptedCrypto = new Set()
  const unique = [...new Map(assets.map(a => [a.id, a])).values()]
  const crypto = unique.filter(a => a.source === 'binance')
  const yahoo = unique.filter(a => a.source === 'yahoo')
  async function get(url) {
    const timeout = AbortSignal.timeout(10_000)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    signal.throwIfAborted()
    const response = await fetcher(url, { signal, redirect: 'error', headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error('price_source_unavailable')
    const body = await response.text()
    if (body.length > 1_000_000) throw new Error('price_response_too_large')
    return JSON.parse(body)
  }
  function observation(price, currency, observedAt, maxAgeMs) {
    const quote = { price, currency, observedAt, maxAgeMs }
    return typeof currency === 'string' && /^[A-Za-z]{3,8}$/.test(currency) && isFreshObservation(quote, now) ? quote : null
  }
  async function publish(asset, quote) {
    if (completed.has(asset.id)) return
    completed.add(asset.id)
    if (quote) observations.set(asset.id, quote)
    // Persist each completed result while other providers are still fetching.
    // Callback errors are intentionally outside source-failure catch blocks.
    await options.onResult?.(asset, quote)
  }
  await Promise.all([
    (async () => {
      await parallelLimit(chunks(crypto), 3, async batch => {
        batch.forEach(a => attemptedCrypto.add(a.id))
        let rows
        try {
          const symbols = encodeURIComponent(JSON.stringify(batch.map(a => a.pair)))
          rows = await get(`https://api.binance.com/api/v3/ticker/24hr?symbols=${symbols}`)
        } catch { /* A source outage leaves no observation and cannot trigger an alarm. */ }
        if (Array.isArray(rows)) await parallelLimit(batch, 6, async a => {
          const row = rows.find(row => row.symbol === a.pair)
          const quote = row && observation(Number(row.lastPrice), 'USD', row.closeTime, 300_000)
          if (quote) await publish(a, quote)
        })
      }, options.signal)
      await parallelLimit(chunks(crypto.filter(a => !completed.has(a.id))), 2, async batch => {
        batch.forEach(a => attemptedCrypto.add(a.id))
        let rows
        try {
          const ids = encodeURIComponent(batch.map(a => a.coingecko).join(','))
          rows = await get(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_last_updated_at=true`)
        } catch { /* No fabricated prices. */ }
        await parallelLimit(batch, 6, async a => {
          const row = rows?.[a.coingecko]
          await publish(a, row ? observation(row.usd, 'USD', row.last_updated_at * 1000, 300_000) : null)
        })
      }, options.signal)
      // A timed-out attempted batch advances the fair queue; untouched batches
      // stay unmarked and therefore become the oldest work for the next run.
      await parallelLimit(crypto.filter(a => attemptedCrypto.has(a.id) && !completed.has(a.id)), 6, a => publish(a, null))
    })(),
    parallelLimit(yahoo, 4, async a => {
      let quote = null
      try {
        // The existing /quotes DTO has no source timestamp. A timestamped 5-minute
        // candle close allows stale/closed-market data to be rejected explicitly.
        const base = options.yahooBaseUrl.replace(/\/$/, '')
        const data = await get(`${base}/api/trading/candles?symbol=${encodeURIComponent(a.yahoo)}&interval=5m&days=1`)
        if (data.symbol?.toUpperCase() === a.yahoo && Array.isArray(data.candles)) {
          const latest = data.candles.filter(c => Number.isFinite(c.t) && Number.isFinite(c.c) && c.t <= now + 30_000).sort((a, b) => b.t - a.t)[0]
          if (latest) quote = observation(latest.c, data.currency, latest.t, 1_200_000)
        }
      } catch { /* Exchange outage or stale session: no observation. */ }
      await publish(a, quote)
    }, options.signal),
  ])
  return observations
}
