/** What the user set up in the market widget (tabs, chart type, time unit, indicators, drawings). Kept in this browser. */
import { assetById, assetGroups, defaultAssetId } from './marketAssets'
import type { StoredAsset } from './marketAssets'
import { lineRanges, timeframes } from './marketData'
import type { ChartKind, LineRange, Timeframe } from './marketData'

export type IndicatorId = 'sma20' | 'sma50' | 'ema21' | 'bollinger' | 'volume' | 'rsi'
export const indicatorIds: IndicatorId[] = ['sma20', 'sma50', 'ema21', 'bollinger', 'volume', 'rsi']

export type DrawingKind = 'trend' | 'hline' | 'fib'

/** A drawing is anchored in time and price, so it stays in place when another time unit is chosen. */
export interface Drawing {
  id: string
  kind: DrawingKind
  t1: number
  p1: number
  t2: number
  p2: number
}

export interface MarketPrefs {
  tabs: string[]
  /** Name and kind of the open markets that are not one of the quick picks (found with the search). */
  extras: Record<string, StoredAsset>
  active: string
  kind: ChartKind
  range: LineRange
  timeframe: Timeframe
  indicators: IndicatorId[]
  drawings: Record<string, Drawing[]>
  views: Record<string, ChartView>
}

export interface ChartView {
  kind: ChartKind
  range: LineRange
  timeframe: Timeframe
}

export const storageKey = 'dwh.market.v1'
export const maxTabs = 5000
export const maxDrawingsPerMarket = 40

export function defaultPrefs(): MarketPrefs {
  return { tabs: [defaultAssetId], extras: {}, active: defaultAssetId, kind: 'candles', range: '1D', timeframe: 'auto', indicators: [], drawings: {}, views: {} }
}

function chartView(value: { kind?: unknown; range?: unknown; timeframe?: unknown }): ChartView {
  return {
    kind: value.kind === 'line' ? 'line' : 'candles',
    range: lineRanges.includes(value.range as LineRange) ? value.range as LineRange : '1D',
    timeframe: timeframes.includes(value.timeframe as Timeframe) ? value.timeframe as Timeframe : 'auto',
  }
}

/** A market switch restores that market's own view, rather than overwriting every chart. */
export function updateMarketPrefs(current: MarketPrefs, patch: Partial<MarketPrefs>): MarketPrefs {
  const views = { ...current.views, [current.active]: chartView(current) }
  let next = { ...current, ...patch, views }
  if (patch.active && patch.active !== current.active) next = { ...next, ...(views[patch.active] ?? chartView({})) }
  if (patch.kind !== undefined || patch.range !== undefined || patch.timeframe !== undefined) {
    views[next.active] = chartView(next)
  }
  return next
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toDrawing(value: unknown): Drawing | null {
  if (!isRecord(value)) return null
  const { id, kind, t1, p1, t2, p2 } = value
  if (typeof id !== 'string' || (kind !== 'trend' && kind !== 'hline' && kind !== 'fib')) return null
  if (![t1, p1, t2, p2].every((item) => typeof item === 'number' && Number.isFinite(item))) return null
  return { id, kind, t1: t1 as number, p1: p1 as number, t2: t2 as number, p2: p2 as number }
}

const extraIdPattern = /^yf:[A-Za-z0-9.^=\-_]{1,24}$/

function toExtras(value: unknown): Record<string, StoredAsset> {
  const extras: Record<string, StoredAsset> = {}
  if (!isRecord(value)) return extras
  for (const [id, item] of Object.entries(value)) {
    if (!extraIdPattern.test(id) || !isRecord(item)) continue
    const { symbol, name, group } = item
    if (typeof symbol !== 'string' || symbol.length === 0 || symbol.length > 24 || typeof name !== 'string' || name.length > 80) continue
    extras[id] = { symbol, name, group: assetGroups.includes(group as StoredAsset['group']) ? (group as StoredAsset['group']) : 'stock' }
  }
  return extras
}

/** Takes whatever is in the storage and returns valid preferences; unknown values fall back to the defaults. */
export function sanitizePrefs(value: unknown): MarketPrefs {
  const defaults = defaultPrefs()
  if (!isRecord(value)) return defaults

  const stored = toExtras(value.extras)
  const tabs = Array.isArray(value.tabs)
    ? [...new Set(value.tabs.filter((id): id is string => typeof id === 'string' && assetById(id, stored) !== undefined))].slice(0, maxTabs)
    : []
  if (tabs.length === 0) tabs.push(defaultAssetId)
  const extras = Object.fromEntries(tabs.filter((id) => id in stored).map((id) => [id, stored[id]]))

  const indicators = Array.isArray(value.indicators)
    ? indicatorIds.filter((id) => (value.indicators as unknown[]).includes(id))
    : defaults.indicators

  const drawings: Record<string, Drawing[]> = {}
  if (isRecord(value.drawings)) {
    for (const [assetId, list] of Object.entries(value.drawings)) {
      if (!assetById(assetId, stored) || !Array.isArray(list)) continue
      const valid = list.map(toDrawing).filter((item): item is Drawing => item !== null).slice(0, maxDrawingsPerMarket)
      if (valid.length > 0) drawings[assetId] = valid
    }
  }

  const active = typeof value.active === 'string' && tabs.includes(value.active) ? value.active : tabs[0]
  const views: Record<string, ChartView> = {}
  if (isRecord(value.views)) {
    for (const id of tabs) {
      const view = value.views[id]
      if (isRecord(view)) views[id] = chartView(view)
    }
  }
  const selectedView = views[active] ?? chartView(value)
  // Legacy settings had one global view. Seed it for the active instrument during migration.
  views[active] = selectedView

  return {
    tabs,
    extras,
    active,
    ...selectedView,
    indicators,
    drawings,
    views,
  }
}

export function readPrefs(): MarketPrefs {
  try {
    const stored = window.localStorage.getItem(storageKey)
    return stored ? sanitizePrefs(JSON.parse(stored)) : defaultPrefs()
  } catch {
    return defaultPrefs()
  }
}

export function writePrefs(prefs: MarketPrefs) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(prefs))
  } catch {
    // Without storage the setup only lasts for this visit.
  }
}
