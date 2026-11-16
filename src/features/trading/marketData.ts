/**
 * Prices and candles. Crypto: Binance (primary) and CoinGecko (fallback), both read straight from the browser without a key.
 * Stocks, indices, currencies and commodities: Yahoo Finance through the platform API (the browser may not call it directly).
 */
import { aggregateCandles, aggregateSessions, bucketizePoints, intervalMs, lastSessions } from './chartMath'
import type { Candle, Interval } from './chartMath'
import type { CryptoAsset, MarketAsset, YahooAsset } from './marketAssets'
import { loadYahooCandles, loadYahooQuotes } from './tradingApi'
import type { YahooInterval } from './tradingApi'

export type ChartKind = 'line' | 'candles'
/** Line chart: how far back the chart reaches. */
export type LineRange = '1D' | '1W' | '1M' | '3M' | '1Y' | 'MAX'
/** Candle chart: length of one candle (45 minutes, 4 hours, day, week, month). */
export type Timeframe = 'auto' | '45m' | '4h' | 'D' | 'W' | 'M'

export const lineRanges: LineRange[] = ['1D', '1W', '1M', '3M', '1Y', 'MAX']
export const timeframes: Timeframe[] = ['auto', '45m', '4h', 'D', 'W', 'M']

export interface SeriesSpec {
  interval: Interval
  /** Candles that are loaded (more than shown, so that indicators are warmed up and the chart can be scrolled back). */
  limit: number
  /** Candles that are shown at first. */
  visible: number
  /** Exchange markets: what to ask Yahoo for and how to shape the answer. */
  yahoo?: {
    fetch: YahooInterval
    /** Look-back in calendar days. */
    days: number
    /** Build the candles from finer ones, starting with the opening of each trading day. */
    sessions?: boolean
    /** Only the last trading day (at least an hour). */
    lastSession?: boolean
  }
}

const cryptoRanges: Record<LineRange, SeriesSpec> = {
  '1D': { interval: '5m', limit: 288, visible: 288 },
  '1W': { interval: '30m', limit: 336, visible: 336 },
  '1M': { interval: '2h', limit: 360, visible: 360 },
  '3M': { interval: '8h', limit: 270, visible: 270 },
  '1Y': { interval: '1d', limit: 365, visible: 365 },
  MAX: { interval: '1w', limit: 1000, visible: 1000 },
}

const cryptoTimeframes: Record<Exclude<Timeframe, 'auto'>, SeriesSpec> = {
  '45m': { interval: '45m', limit: 330, visible: 110 },
  '4h': { interval: '4h', limit: 360, visible: 120 },
  D: { interval: '1d', limit: 365, visible: 120 },
  W: { interval: '1w', limit: 400, visible: 130 },
  M: { interval: '1M', limit: 120, visible: 60 },
}

// Exchanges are closed at night and at the weekend, so ranges are counted in trading days. Yahoo keeps 5 to 30 minute candles for
// about 60 days and hourly candles for two years.
const yahooRanges: Record<LineRange, SeriesSpec> = {
  '1D': { interval: '5m', limit: 200, visible: 200, yahoo: { fetch: '5m', days: 7, lastSession: true } },
  '1W': { interval: '15m', limit: 140, visible: 140, yahoo: { fetch: '15m', days: 10 } },
  '1M': { interval: '1h', limit: 160, visible: 160, yahoo: { fetch: '60m', days: 40 } },
  '3M': { interval: '1d', limit: 70, visible: 70, yahoo: { fetch: '1d', days: 100 } },
  '1Y': { interval: '1d', limit: 260, visible: 260, yahoo: { fetch: '1d', days: 380 } },
  MAX: { interval: '1w', limit: 1000, visible: 1000, yahoo: { fetch: '1wk', days: 36_500 } },
}

const yahooTimeframes: Record<Exclude<Timeframe, 'auto'>, SeriesSpec> = {
  '45m': { interval: '45m', limit: 330, visible: 110, yahoo: { fetch: '15m', days: 59, sessions: true } },
  '4h': { interval: '4h', limit: 360, visible: 120, yahoo: { fetch: '60m', days: 300, sessions: true } },
  D: { interval: '1d', limit: 365, visible: 120, yahoo: { fetch: '1d', days: 560 } },
  W: { interval: '1w', limit: 400, visible: 130, yahoo: { fetch: '1wk', days: 3700 } },
  M: { interval: '1M', limit: 120, visible: 60, yahoo: { fetch: '1mo', days: 3700 } },
}

export function seriesSpec(kind: ChartKind, range: LineRange, timeframe: Timeframe, source: MarketAsset['source'] = 'binance'): SeriesSpec {
  if (source === 'yahoo') return kind === 'line' || timeframe === 'auto' ? yahooRanges[range] : yahooTimeframes[timeframe]
  return kind === 'line' || timeframe === 'auto' ? cryptoRanges[range] : cryptoTimeframes[timeframe]
}

export interface MarketSeries {
  candles: Candle[]
  source: string
  /** Currency of the prices; crypto is always in USD. */
  currency?: string
}

export interface Quote {
  price: number
  /** Change over the last 24 hours (crypto) or to the previous close (exchanges) in percent. */
  changePct: number
  currency?: string
  /** Whether the exchange is open; unknown for crypto, which never closes. */
  marketOpen?: boolean | null
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<T>
}

async function withFallback<T>(signal: AbortSignal | undefined, primary: () => Promise<T>, fallback: () => Promise<T>) {
  try {
    return await primary()
  } catch (error) {
    if (signal?.aborted) throw error
    return fallback()
  }
}

async function binanceCandles(asset: CryptoAsset, spec: SeriesSpec, signal?: AbortSignal): Promise<MarketSeries> {
  // Binance has no 45-minute candles: they are built from three 15-minute candles.
  const built = spec.interval === '45m'
  const interval = built ? '15m' : spec.interval
  const limit = Math.min(1000, built ? spec.limit * 3 + 2 : spec.limit)
  const rows = await getJson<Array<Array<string | number>>>(`https://api.binance.com/api/v3/klines?symbol=${asset.pair}&interval=${interval}&limit=${limit}`, signal)
  let candles: Candle[] = rows
    .map((row) => ({ t: Number(row[0]), o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]), v: Number(row[5]) }))
    .filter((candle) => [candle.t, candle.o, candle.h, candle.l, candle.c].every(Number.isFinite))
  if (built) candles = aggregateCandles(candles, '45m')
  candles = candles.slice(-spec.limit)
  if (candles.length < 2) throw new Error('No data')
  return { candles, source: 'Binance', currency: 'USD' }
}

async function coingeckoCandles(asset: CryptoAsset, spec: SeriesSpec, signal?: AbortSignal): Promise<MarketSeries> {
  // The free CoinGecko API serves one year of history and prices only: candles are rebuilt from the points and have no volume.
  const days = Math.min(365, Math.max(1, Math.ceil((spec.limit * intervalMs[spec.interval]) / 86_400_000)))
  const data = await getJson<{ prices: Array<[number, number]> }>(`https://api.coingecko.com/api/v3/coins/${asset.coingecko}/market_chart?vs_currency=usd&days=${days}`, signal)
  const points = data.prices.map(([t, price]) => ({ t, price })).filter((point) => Number.isFinite(point.price))
  const candles = bucketizePoints(points, spec.interval).slice(-spec.limit)
  if (candles.length < 2) throw new Error('No data')
  return { candles, source: 'CoinGecko', currency: 'USD' }
}

async function yahooCandles(asset: YahooAsset, spec: SeriesSpec, signal?: AbortSignal): Promise<MarketSeries> {
  const plan = spec.yahoo
  if (!plan) throw new Error('No plan for this market')
  const data = await loadYahooCandles(asset.yahoo, plan.fetch, plan.days, signal)
  let candles: Candle[] = data.candles
  if (plan.sessions) candles = aggregateSessions(candles, intervalMs[spec.interval])
  if (plan.lastSession) candles = lastSessions(candles, 12)
  candles = candles.slice(-spec.limit)
  if (candles.length < 2) throw new Error('No data')
  return { candles, source: 'Yahoo Finance', currency: data.currency }
}

export function loadSeries(asset: MarketAsset, spec: SeriesSpec, signal?: AbortSignal): Promise<MarketSeries> {
  if (asset.source === 'yahoo') return yahooCandles(asset, spec, signal)
  return withFallback(signal, () => binanceCandles(asset, spec, signal), () => coingeckoCandles(asset, spec, signal))
}

function cryptoQuotes(assets: CryptoAsset[], signal?: AbortSignal): Promise<Record<string, Quote>> {
  if (assets.length === 0) return Promise.resolve({})
  return withFallback<Record<string, Quote>>(
    signal,
    async () => {
      const symbols = encodeURIComponent(JSON.stringify(assets.map((asset) => asset.pair)))
      const rows = await getJson<Array<{ symbol: string; lastPrice: string; priceChangePercent: string }>>(`https://api.binance.com/api/v3/ticker/24hr?symbols=${symbols}`, signal)
      const quotes: Record<string, Quote> = {}
      for (const asset of assets) {
        const row = rows.find((item) => item.symbol === asset.pair)
        const price = Number(row?.lastPrice)
        const changePct = Number(row?.priceChangePercent)
        if (row && Number.isFinite(price) && Number.isFinite(changePct)) quotes[asset.id] = { price, changePct, currency: 'USD' }
      }
      if (Object.keys(quotes).length === 0) throw new Error('No data')
      return quotes
    },
    async () => {
      const ids = assets.map((asset) => asset.coingecko).join(',')
      const data = await getJson<Record<string, { usd?: number; usd_24h_change?: number }>>(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`, signal)
      const quotes: Record<string, Quote> = {}
      for (const asset of assets) {
        const row = data[asset.coingecko]
        if (row && Number.isFinite(row.usd) && Number.isFinite(row.usd_24h_change)) quotes[asset.id] = { price: row.usd as number, changePct: row.usd_24h_change as number, currency: 'USD' }
      }
      return quotes
    },
  )
}

async function yahooQuotes(assets: YahooAsset[], signal?: AbortSignal): Promise<Record<string, Quote>> {
  if (assets.length === 0) return {}
  const quotes: Record<string, Quote> = {}
  // The API accepts 20 symbols per request. Only the visible page plus the active market are requested by the UI.
  for (let offset = 0; offset < assets.length; offset += 20) {
    const batch = assets.slice(offset, offset + 20)
    const rows = await loadYahooQuotes(batch.map((asset) => asset.yahoo), signal)
    for (const asset of batch) {
      const row = rows.find((item) => item.symbol.toUpperCase() === asset.yahoo)
      if (row && Number.isFinite(row.price) && Number.isFinite(row.changePct)) quotes[asset.id] = { price: row.price, changePct: row.changePct, currency: row.currency, marketOpen: row.marketOpen }
    }
  }
  return quotes
}

/** Price and change of all given markets; the two sources are asked in parallel and one of them may fail. */
export async function loadQuotes(assets: MarketAsset[], signal?: AbortSignal): Promise<Record<string, Quote>> {
  const [crypto, exchanges] = await Promise.allSettled([
    cryptoQuotes(assets.filter((asset): asset is CryptoAsset => asset.source === 'binance'), signal),
    yahooQuotes(assets.filter((asset): asset is YahooAsset => asset.source === 'yahoo'), signal),
  ])
  if (crypto.status === 'rejected' && exchanges.status === 'rejected') throw crypto.reason
  return { ...(crypto.status === 'fulfilled' ? crypto.value : {}), ...(exchanges.status === 'fulfilled' ? exchanges.value : {}) }
}
