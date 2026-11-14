import { fetchJson } from '../../services/platformApi'

/** What the platform API returns for stocks, indices, currencies and commodities (Yahoo Finance behind it). */
export interface MarketSearchResult {
  symbol: string
  name: string
  exchange: string
  type: string
}

export interface YahooQuote {
  symbol: string
  name: string
  currency: string
  price: number
  /** Change to the previous close in percent. */
  changePct: number
  /** Whether the exchange is open right now (unknown for some instruments). */
  marketOpen: boolean | null
}

export interface YahooCandles {
  symbol: string
  name: string
  currency: string
  candles: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>
}

export type YahooInterval = '5m' | '15m' | '30m' | '60m' | '1d' | '1wk' | '1mo'

export function searchMarkets(query: string, signal?: AbortSignal) {
  return fetchJson<MarketSearchResult[]>(`/api/trading/search?q=${encodeURIComponent(query)}`, { signal })
}

export function loadYahooQuotes(symbols: string[], signal?: AbortSignal) {
  return fetchJson<YahooQuote[]>(`/api/trading/quotes?symbols=${symbols.map(encodeURIComponent).join(',')}`, { signal })
}

export function loadYahooCandles(symbol: string, interval: YahooInterval, days: number, signal?: AbortSignal) {
  return fetchJson<YahooCandles>(`/api/trading/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&days=${days}`, { signal })
}
