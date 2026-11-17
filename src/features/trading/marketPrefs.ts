/** What the user set up in the market widget (lists, chart type, time unit, indicators, drawings). Kept in this browser. */
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

/** The colour lists work like flags: a market carries at most one colour, shown in front of it in every list. */
export type ListColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink'
export const listColors: ListColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']

/** A heading inside a list; the markets below it (up to the next heading) belong to it. */
export interface ListSection {
  id: string
  name: string
  collapsed?: boolean
}

/** A market (its id) or a section heading. */
export type ListEntry = string | ListSection

export interface Watchlist {
  id: string
  /** Empty: the default name (the colour or "My markets") in the chosen language. */
  name: string
  color: ListColor | null
  entries: ListEntry[]
}

export interface MarketPrefs {
  /** Every saved market across all lists, in list order. Derived from `lists`; kept for the compact tile. */
  tabs: string[]
  /** Name and kind of the saved markets that are not one of the quick picks (found with the search). */
  extras: Record<string, StoredAsset>
  lists: Watchlist[]
  activeList: string
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
export const maxLists = 50
export const mainListId = 'main'

export function colorListId(color: ListColor) {
  return `color:${color}`
}

export function isSection(entry: ListEntry): entry is ListSection {
  return typeof entry !== 'string'
}

/** The markets of a list in order, without the headings. */
export function listMarkets(list: Watchlist) {
  return list.entries.filter((entry): entry is string => typeof entry === 'string')
}

function defaultLists(markets: string[]): Watchlist[] {
  return [
    { id: mainListId, name: '', color: null, entries: markets },
    ...listColors.map((color): Watchlist => ({ id: colorListId(color), name: '', color, entries: [] })),
  ]
}

export function defaultPrefs(): MarketPrefs {
  return { tabs: [defaultAssetId], extras: {}, lists: defaultLists([defaultAssetId]), activeList: mainListId, active: defaultAssetId, kind: 'candles', range: '1D', timeframe: 'auto', indicators: [], drawings: {}, views: {} }
}

function chartView(value: { kind?: unknown; range?: unknown; timeframe?: unknown }): ChartView {
  return {
    kind: value.kind === 'line' ? 'line' : 'candles',
    range: lineRanges.includes(value.range as LineRange) ? value.range as LineRange : '1D',
    timeframe: timeframes.includes(value.timeframe as Timeframe) ? value.timeframe as Timeframe : 'auto',
  }
}

/** All markets of all lists, each once, in list order. */
export function allMarkets(lists: Watchlist[]) {
  const seen = new Set<string>()
  for (const list of lists) for (const entry of list.entries) if (typeof entry === 'string') seen.add(entry)
  return [...seen]
}

/** Recomputes what follows from the lists: the saved markets and which searched names are still needed. */
export function withLists(current: MarketPrefs, lists: Watchlist[], patch: Partial<MarketPrefs> = {}): MarketPrefs {
  const tabs = allMarkets(lists)
  const active = patch.active ?? current.active
  const keep = new Set([...tabs, active])
  const source = patch.extras ? { ...current.extras, ...patch.extras } : current.extras
  const kept = Object.keys(source).filter((id) => keep.has(id))
  // The same object when nothing changed: the chart and the price requests depend on it.
  const extras = source === current.extras && kept.length === Object.keys(source).length ? current.extras : Object.fromEntries(kept.map((id) => [id, source[id]]))
  const activeList = lists.some((list) => list.id === (patch.activeList ?? current.activeList)) ? (patch.activeList ?? current.activeList) : lists[0].id
  return { ...current, ...patch, lists, tabs, extras, activeList }
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
const itemIdPattern = /^[a-z0-9]{1,24}$/
export const maxNameLength = 40

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

export function cleanName(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxNameLength) : ''
}

function toEntries(value: unknown, known: (id: string) => boolean, budget: { left: number }): ListEntry[] {
  if (!Array.isArray(value)) return []
  const entries: ListEntry[] = []
  const seenMarkets = new Set<string>()
  const seenSections = new Set<string>()
  for (const item of value) {
    if (typeof item === 'string') {
      if (seenMarkets.has(item) || !known(item) || budget.left <= 0) continue
      seenMarkets.add(item)
      budget.left -= 1
      entries.push(item)
    } else if (isRecord(item) && typeof item.id === 'string' && itemIdPattern.test(item.id) && !seenSections.has(item.id)) {
      seenSections.add(item.id)
      entries.push({ id: item.id, name: cleanName(item.name), ...(item.collapsed === true ? { collapsed: true } : {}) })
    }
  }
  return entries
}

/** Builds the lists from storage: the colour lists always exist; a single older list of tabs becomes "My markets". */
function toLists(value: Record<string, unknown>, known: (id: string) => boolean): Watchlist[] {
  const budget = { left: maxTabs }
  const custom: Watchlist[] = []
  const colored = new Map<ListColor, Watchlist>()
  if (Array.isArray(value.lists)) {
    for (const item of value.lists) {
      if (!isRecord(item) || typeof item.id !== 'string') continue
      const color = listColors.find((entry) => item.id === colorListId(entry))
      if (color) {
        if (!colored.has(color)) colored.set(color, { id: item.id, name: cleanName(item.name), color, entries: toEntries(item.entries, known, budget) })
      } else if (itemIdPattern.test(item.id) && !custom.some((list) => list.id === item.id) && custom.length < maxLists) {
        custom.push({ id: item.id, name: cleanName(item.name), color: null, entries: toEntries(item.entries, known, budget) })
      }
    }
  }
  if (custom.length === 0) {
    const tabs = Array.isArray(value.tabs) ? value.tabs : [defaultAssetId]
    const entries = toEntries(tabs, known, budget)
    custom.push({ id: mainListId, name: '', color: null, entries: entries.length > 0 || Array.isArray(value.lists) ? entries : [defaultAssetId] })
  }
  // A market carries one colour: when stored data says otherwise, the first colour list keeps it.
  const flagged = new Set<string>()
  const colorLists = listColors.map((color) => {
    const list = colored.get(color) ?? { id: colorListId(color), name: '', color, entries: [] }
    const entries = list.entries.filter((entry) => {
      if (typeof entry !== 'string') return true
      if (flagged.has(entry)) return false
      flagged.add(entry)
      return true
    })
    return { ...list, entries }
  })
  return [...custom, ...colorLists]
}

/** Takes whatever is in the storage and returns valid preferences; unknown values fall back to the defaults. */
export function sanitizePrefs(value: unknown): MarketPrefs {
  const defaults = defaultPrefs()
  if (!isRecord(value)) return defaults

  const stored = toExtras(value.extras)
  const known = (id: string) => assetById(id, stored) !== undefined
  const lists = toLists(value, known)
  const tabs = allMarkets(lists)

  const indicators = Array.isArray(value.indicators)
    ? indicatorIds.filter((id) => (value.indicators as unknown[]).includes(id))
    : defaults.indicators

  const active = typeof value.active === 'string' && tabs.includes(value.active) ? value.active : tabs[0] ?? defaultAssetId
  const keep = new Set([...tabs, active])
  const extras = Object.fromEntries(Object.entries(stored).filter(([id]) => keep.has(id)))

  const drawings: Record<string, Drawing[]> = {}
  if (isRecord(value.drawings)) {
    for (const [assetId, list] of Object.entries(value.drawings)) {
      if (!assetById(assetId, extras) || !Array.isArray(list)) continue
      const valid = list.map(toDrawing).filter((item): item is Drawing => item !== null).slice(0, maxDrawingsPerMarket)
      if (valid.length > 0) drawings[assetId] = valid
    }
  }

  const views: Record<string, ChartView> = {}
  if (isRecord(value.views)) {
    for (const id of keep) {
      const view = value.views[id]
      if (isRecord(view)) views[id] = chartView(view)
    }
  }
  const selectedView = views[active] ?? chartView(value)
  // Legacy settings had one global view. Seed it for the active instrument during migration.
  views[active] = selectedView
  const activeList = typeof value.activeList === 'string' && lists.some((list) => list.id === value.activeList) ? value.activeList : lists[0].id

  return {
    tabs,
    extras,
    lists,
    activeList,
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
