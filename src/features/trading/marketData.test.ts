import { afterEach, describe, expect, it, vi } from 'vitest'
import { assetById } from './marketAssets'
import type { YahooAsset } from './marketAssets'
import { loadQuotes, loadSeries, seriesSpec } from './marketData'

const hbar = assetById('hbar')!
const btc = assetById('btc')!
const sap = assetById('yf:SAP.DE') as YahooAsset
const start = Date.UTC(2026, 8, 1)

function klines(count: number, step: number) {
  return Array.from({ length: count }, (_, index) => [start + index * step, '1', '2', '0.5', '1.5', '10', start + (index + 1) * step - 1, '5'])
}

const urlOf = (call: unknown[]) => String(call[0])

afterEach(() => vi.unstubAllGlobals())

describe('series', () => {
  it('uses another candle length per chart type and time unit', () => {
    expect(seriesSpec('line', '1M', '4h')).toMatchObject({ interval: '2h', limit: 360 })
    expect(seriesSpec('candles', '1M', '4h')).toMatchObject({ interval: '4h', limit: 360, visible: 120 })
    expect(seriesSpec('candles', '1D', 'M')).toMatchObject({ interval: '1M', limit: 120, visible: 60 })
  })

  it('loads candles from Binance and builds the 45 minute candles from 15 minute ones', async () => {
    const fetchMock = vi.fn(async () => Response.json(klines(992, 900_000)))
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadSeries(hbar, seriesSpec('candles', '1D', '45m'))

    expect(urlOf(fetchMock.mock.calls[0])).toContain('symbol=HBARUSDT&interval=15m&limit=992')
    expect(result.source).toBe('Binance')
    expect(result.candles.length).toBeLessThanOrEqual(330)
    expect(result.candles.length).toBeGreaterThan(300)
    expect(result.candles[1].t - result.candles[0].t).toBe(45 * 60_000)
    expect(result.candles[0]).toMatchObject({ o: 1, h: 2, l: 0.5, c: 1.5, v: 30 })
  })

  it('asks Binance for the right interval of the time unit', async () => {
    const fetchMock = vi.fn(async () => Response.json(klines(400, 7 * 86_400_000)))
    vi.stubGlobal('fetch', fetchMock)

    await loadSeries(btc, seriesSpec('candles', '1D', 'W'))
    await loadSeries(btc, seriesSpec('line', '1Y', 'W'))

    expect(urlOf(fetchMock.mock.calls[0])).toContain('symbol=BTCUSDT&interval=1w&limit=400')
    expect(urlOf(fetchMock.mock.calls[1])).toContain('symbol=BTCUSDT&interval=1d&limit=365')
  })

  it('falls back to CoinGecko and rebuilds candles from the prices', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('binance')) return new Response('blocked', { status: 451 })
      const prices = Array.from({ length: 24 * 40 }, (_, index) => [start + index * 3_600_000, 1 + (index % 7) / 10])
      return Response.json({ prices })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadSeries(hbar, seriesSpec('candles', '1D', 'D'))

    expect(urlOf(fetchMock.mock.calls[1])).toContain('/coins/hedera-hashgraph/market_chart?vs_currency=usd&days=365')
    expect(result.source).toBe('CoinGecko')
    expect(result.candles.length).toBeGreaterThan(30)
    expect(result.candles.every((candle) => candle.v === 0 && candle.h >= candle.l)).toBe(true)
    // several hourly prices make one daily candle with a real range
    expect(result.candles.some((candle) => candle.h > candle.l)).toBe(true)
  })

  it('fails when neither source answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    await expect(loadSeries(hbar, seriesSpec('line', '1D', 'D'))).rejects.toThrow()
  })
})

describe('quotes', () => {
  it('reads price and 24 h change of all markets with one request', async () => {
    const fetchMock = vi.fn(async () => Response.json([
      { symbol: 'HBARUSDT', lastPrice: '0.1234', priceChangePercent: '-1.25' },
      { symbol: 'BTCUSDT', lastPrice: '84000.50', priceChangePercent: '3.4' },
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const quotes = await loadQuotes([hbar, btc])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(decodeURIComponent(urlOf(fetchMock.mock.calls[0]))).toContain('symbols=["HBARUSDT","BTCUSDT"]')
    expect(quotes).toEqual({ hbar: { price: 0.1234, changePct: -1.25, currency: 'USD' }, btc: { price: 84000.5, changePct: 3.4, currency: 'USD' } })
  })

  it('uses CoinGecko when Binance does not answer', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('binance')) throw new TypeError('network')
      return Response.json({ 'hedera-hashgraph': { usd: 0.2, usd_24h_change: 2.5 } })
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await loadQuotes([hbar])).toEqual({ hbar: { price: 0.2, changePct: 2.5, currency: 'USD' } })
  })

  it('needs no request without a market', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await loadQuotes([])).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('exchange markets (Yahoo through the platform API)', () => {
  const session = Date.UTC(2026, 9, 6, 7)
  const apiCandles = (count: number, step: number, from = session) => Array.from({ length: count }, (_, index) => (
    { t: from + index * step, o: 100 + index, h: 101 + index, l: 99 + index, c: 100.5 + index, v: 10 }
  ))

  it('counts ranges in trading days: a day is the last session, a week 15-minute candles', () => {
    expect(seriesSpec('line', '1D', 'D', 'yahoo')).toMatchObject({ interval: '5m', yahoo: { fetch: '5m', lastSession: true } })
    expect(seriesSpec('line', '1W', 'D', 'yahoo')).toMatchObject({ interval: '15m', yahoo: { fetch: '15m' } })
    expect(seriesSpec('candles', '1D', '4h', 'yahoo')).toMatchObject({ interval: '4h', yahoo: { fetch: '60m', sessions: true } })
    expect(seriesSpec('candles', '1D', 'W', 'yahoo')).toMatchObject({ interval: '1w', yahoo: { fetch: '1wk' } })
  })

  it('asks the platform API, keeps only the last session of a day chart and reports the currency', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      symbol: 'SAP.DE', name: 'SAP SE', currency: 'EUR',
      // two sessions of 5-minute candles
      candles: [...apiCandles(60, 300_000, session - 86_400_000), ...apiCandles(50, 300_000)],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadSeries(sap, seriesSpec('line', '1D', 'D', 'yahoo'))

    expect(urlOf(fetchMock.mock.calls[0])).toMatch(/\/api\/trading\/candles\?symbol=SAP\.DE&interval=5m&days=7$/)
    expect(result.source).toBe('Yahoo Finance')
    expect(result.currency).toBe('EUR')
    expect(result.candles).toHaveLength(50)
  })

  it('builds 4-hour candles from hourly ones, starting with the opening of the day', async () => {
    const hour = 3_600_000
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      symbol: 'SAP.DE', name: 'SAP SE', currency: 'EUR',
      // 8 hourly candles from 07:00 UTC on two days
      candles: [...apiCandles(8, hour), ...apiCandles(8, hour, session + 86_400_000)],
    })))

    const result = await loadSeries(sap, seriesSpec('candles', '1D', '4h', 'yahoo'))

    expect(result.candles.map((candle) => new Date(candle.t).getUTCHours())).toEqual([7, 11, 7, 11])
    expect(result.candles[0]).toMatchObject({ o: 100, h: 104, l: 99, c: 103.5, v: 40 })
  })

  it('reads exchange quotes from the API and crypto quotes from Binance in one call', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => String(input).includes('/api/trading/quotes')
      ? Response.json([{ symbol: 'SAP.DE', name: 'SAP SE', currency: 'EUR', price: 201.5, changePct: -1.2, marketOpen: false }])
      : Response.json([{ symbol: 'BTCUSDT', lastPrice: '84000.50', priceChangePercent: '3.4' }]))
    vi.stubGlobal('fetch', fetchMock)

    const quotes = await loadQuotes([sap, btc])

    expect(quotes).toEqual({
      'yf:SAP.DE': { price: 201.5, changePct: -1.2, currency: 'EUR', marketOpen: false },
      btc: { price: 84000.5, changePct: 3.4, currency: 'USD' },
    })
    expect(urlOf(fetchMock.mock.calls.find((call) => urlOf(call).includes('/api/trading/quotes'))!)).toContain('symbols=SAP.DE')
  })

  it('still shows the crypto prices when the platform API is not reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/api/trading/quotes')) throw new TypeError('network')
      return Response.json([{ symbol: 'BTCUSDT', lastPrice: '84000.50', priceChangePercent: '3.4' }])
    }))

    expect(Object.keys(await loadQuotes([sap, btc]))).toEqual(['btc'])
  })
})
