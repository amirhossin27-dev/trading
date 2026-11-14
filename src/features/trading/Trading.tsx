import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import './trading.css'
import type { Language } from '../../types/platform'
import { localeFor } from '../overview/overviewCopy'
import { tradingCopy } from './tradingCopy'
import { AssetPicker } from './AssetPicker'
import { indicatorColors } from './indicatorColors'
import { PriceChart } from './PriceChart'
import type { Tool } from './PriceChart'
import { intervalMs, priceFormatter } from './chartMath'
import { moneyFormatter } from './money'
import { assetById, assetDigits, marketAssets } from './marketAssets'
import type { MarketAsset } from './marketAssets'
import { lineRanges, loadQuotes, loadSeries, seriesSpec, timeframes } from './marketData'
import type { ChartKind, LineRange, MarketSeries, Quote, Timeframe } from './marketData'
import { indicatorIds, maxDrawingsPerMarket, maxTabs, readPrefs, writePrefs } from './marketPrefs'
import type { Drawing, IndicatorId, MarketPrefs } from './marketPrefs'

const quoteRefreshMs = 15_000
const seriesRefreshMs = 60_000

interface SeriesState {
  key: string
  series: MarketSeries | null
  failed: boolean
}

/** Closes a pop-up on a click outside of it or on Escape. The returned ref belongs on the element that holds trigger and pop-up. */
function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event: PointerEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) closeRef.current()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return ref
}

function ToolIcon({ tool }: { tool: Tool | 'clear' }) {
  let shapes: ReactNode
  if (tool === 'cursor') shapes = <path d="M6 3.5l12 8-5.3 1.3L10.2 18z" />
  else if (tool === 'trend') shapes = <><path d="M7.2 16.8L16.8 7.2" /><circle cx="5.5" cy="18.5" r="1.8" /><circle cx="18.5" cy="5.5" r="1.8" /></>
  else if (tool === 'hline') shapes = <><path d="M3 12h18" /><circle cx="12" cy="12" r="1.8" /></>
  else if (tool === 'fib') shapes = <path d="M4 5h16M4 9.7h16M4 14.3h16M4 19h16" />
  else if (tool === 'measure') shapes = <path d="M12 4v16M8.2 7.8L12 4l3.8 3.8M8.2 16.2L12 20l3.8-3.8" />
  else shapes = <path d="M5 7h14M10 7V5h4v2M7.2 7l.9 12h7.8l.9-12" />
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{shapes}</svg>
}

const drawingTools: Tool[] = ['cursor', 'trend', 'hline', 'fib', 'measure']

const brandColors: Record<string, string> = {
  BTC: '#f7931a', ETH: '#627eea', SOL: '#9945ff', XRP: '#2b3138', ADA: '#0a3fb8', DOGE: '#c2a633', BNB: '#d9a40a', HBAR: '#222222',
  LINK: '#2a5ada', DOT: '#e6007a', AVAX: '#e84142', LTC: '#345d9d', TRX: '#eb0029', SHIB: '#e42d04', UNI: '#ff007a', POL: '#7b3fe4',
}

/** Round badge in front of a market: a known brand colour, otherwise a colour derived from the name. */
function avatarColor(asset: MarketAsset) {
  const brand = brandColors[asset.symbol]
  if (brand) return brand
  let hash = 0
  for (const character of asset.symbol) hash = (hash * 31 + character.charCodeAt(0)) % 360
  return `hsl(${hash} 52% 40%)`
}

/** A number with its sign, formatted like the price. */
function signed(format: Intl.NumberFormat, value: number) {
  const text = format.format(Math.abs(value))
  return `${value < 0 ? '−' : '+'}${text}`
}

export function Trading({ language }: { language: Language }) {
  const t = tradingCopy(language)
  const locale = localeFor(language)
  const [prefs, setPrefs] = useState<MarketPrefs>(readPrefs)
  const [tool, setTool] = useState<Tool>('cursor')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [indicatorsOpen, setIndicatorsOpen] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [seriesState, setSeriesState] = useState<SeriesState>({ key: '', series: null, failed: false })
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  // Reordering the watchlist: the row that is dragged and the row it hovers (dropped before or after it).
  const [drag, setDrag] = useState<{ id: string; overId: string | null; after: boolean } | null>(null)
  const [moveNote, setMoveNote] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // Everything the user sets up is saved right away, so a reload (or the next visit) shows the same view.
  useEffect(() => {
    writePrefs(prefs)
  }, [prefs])

  const pickerRef = useDismiss(pickerOpen, () => setPickerOpen(false))
  const indicatorsRef = useDismiss(indicatorsOpen, () => setIndicatorsOpen(false))

  // A market found with the search is built from the stored name on every lookup: keep one object, or every render would start a new request.
  const asset = useMemo(() => assetById(prefs.active, prefs.extras) ?? marketAssets[0], [prefs.active, prefs.extras])
  const tabAssets = useMemo(() => prefs.tabs.map((id) => assetById(id, prefs.extras)).filter((item): item is MarketAsset => item !== undefined), [prefs.tabs, prefs.extras])
  // The prices do not depend on the order of the list: moving a row must not start new requests.
  const marketKey = [...prefs.tabs].sort().join(',')
  const quoteAssets = useMemo(() => marketKey.split(',').map((id) => assetById(id, prefs.extras)).filter((item): item is MarketAsset => item !== undefined), [marketKey, prefs.extras])
  const spec = seriesSpec(prefs.kind, prefs.range, prefs.timeframe, asset.source)
  const requestKey = `${asset.id}|${spec.interval}|${spec.limit}|${retryCount}`
  const viewKey = `${asset.id}|${prefs.kind}|${prefs.kind === 'line' ? prefs.range : prefs.timeframe}`

  function update(patch: Partial<MarketPrefs>) {
    setPrefs((current) => ({ ...current, ...patch }))
  }

  useEffect(() => {
    const controller = new AbortController()
    function refresh() {
      loadSeries(asset, spec, controller.signal)
        .then((series) => setSeriesState({ key: requestKey, series, failed: false }))
        .catch(() => {
          if (controller.signal.aborted) return
          // A failed background refresh keeps the chart that is already on screen.
          setSeriesState((current) => (current.key === requestKey && current.series ? current : { key: requestKey, series: null, failed: true }))
        })
    }
    refresh()
    const timer = window.setInterval(refresh, seriesRefreshMs)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [asset, spec, requestKey])

  useEffect(() => {
    const controller = new AbortController()
    function refresh() {
      loadQuotes(quoteAssets, controller.signal)
        .then((next) => setQuotes((current) => ({ ...current, ...next })))
        .catch(() => undefined)
    }
    refresh()
    const timer = window.setInterval(refresh, quoteRefreshMs)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [quoteAssets])

  const isCurrent = seriesState.key === requestKey
  const series = isCurrent ? seriesState.series : null
  const failed = isCurrent && seriesState.failed
  const quote = quotes[asset.id]
  const livePrice = quote?.price ?? null

  // The newest candle follows the live price between two refreshes of the series.
  const candles = useMemo(() => {
    const base = series?.candles ?? []
    if (base.length === 0 || livePrice === null) return base
    const last = base[base.length - 1]
    return [...base.slice(0, -1), { ...last, c: livePrice, h: Math.max(last.h, livePrice), l: Math.min(last.l, livePrice) }]
  }, [series, livePrice])
  const hasVolume = useMemo(() => candles.some((candle) => candle.v > 0), [candles])

  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null
  const price = livePrice ?? lastCandle?.c ?? null
  const baseline = candles.length > 0 ? candles[Math.max(0, candles.length - Math.min(spec.visible, candles.length))].o : null
  const change = price !== null && baseline !== null && baseline !== 0 ? price / baseline - 1 : null
  const trend = change === null ? 'flat' : change >= 0 ? 'up' : 'down'
  const rangeName = prefs.kind === 'line' ? t.rangeNames[prefs.range] : t.timeframeNames[prefs.timeframe]

  const currency = quote?.currency ?? series?.currency ?? 'USD'
  const digits = assetDigits(asset, price ?? 1)
  const money = useMemo(() => moneyFormatter(locale, currency, price ?? 1, digits), [locale, price, currency, digits])
  const percent = useMemo(() => new Intl.NumberFormat(locale, { style: 'percent', signDisplay: 'always', minimumFractionDigits: 2, maximumFractionDigits: 2 }), [locale])

  const drawings = prefs.drawings[asset.id] ?? []

  function selectTab(id: string) {
    setTool('cursor')
    update({ active: id })
  }

  function pickAsset(picked: MarketAsset) {
    setPickerOpen(false)
    setTool('cursor')
    setPrefs((current) => {
      if (current.tabs.includes(picked.id)) return { ...current, active: picked.id }
      if (current.tabs.length >= maxTabs) return current
      // A market from the search is remembered with its name; the quick picks are known anyway.
      const extras = picked.source === 'yahoo' && assetById(picked.id) === undefined
        ? { ...current.extras, [picked.id]: { symbol: picked.symbol, name: picked.name, group: picked.group } }
        : current.extras
      return { ...current, tabs: [...current.tabs, picked.id], extras, active: picked.id }
    })
  }

  function closeTab(id: string) {
    setPrefs((current) => {
      if (current.tabs.length <= 1) return current
      const index = current.tabs.indexOf(id)
      const tabs = current.tabs.filter((item) => item !== id)
      const active = current.active === id ? tabs[Math.min(index, tabs.length - 1)] : current.active
      const extras = Object.fromEntries(Object.entries(current.extras).filter(([extraId]) => extraId !== id))
      return { ...current, tabs, extras, active }
    })
    setTool('cursor')
  }

  /** Puts a market at the given place of the watchlist (`to` is its place after the move). */
  function moveTab(id: string, to: number) {
    setPrefs((current) => {
      const from = current.tabs.indexOf(id)
      const target = Math.max(0, Math.min(current.tabs.length - 1, to))
      if (from < 0 || from === target) return current
      const tabs = current.tabs.filter((item) => item !== id)
      tabs.splice(target, 0, id)
      return { ...current, tabs }
    })
  }

  function dragOverRow(event: DragEvent<HTMLDivElement>, id: string) {
    if (!drag || drag.id === id) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    // On a narrow card the list is a strip: the rows are side by side instead of one below the other.
    const strip = event.currentTarget.parentElement !== null && window.getComputedStyle(event.currentTarget.parentElement).display === 'flex'
    const after = strip ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2
    if (drag.overId !== id || drag.after !== after) setDrag({ ...drag, overId: id, after })
  }

  function dropRow() {
    if (drag?.overId && drag.overId !== drag.id) {
      const from = prefs.tabs.indexOf(drag.id)
      const over = prefs.tabs.indexOf(drag.overId)
      if (from >= 0 && over >= 0) {
        const insertAt = over + (drag.after ? 1 : 0)
        moveTab(drag.id, insertAt > from ? insertAt - 1 : insertAt)
      }
    }
    setDrag(null)
  }

  /** Alt + arrow keys move the focused row, so the order can be changed without a mouse. */
  function keyMoveRow(event: ReactKeyboardEvent<HTMLButtonElement>, tab: MarketAsset) {
    const step = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : 0
    if (!event.altKey || step === 0) return
    event.preventDefault()
    const from = prefs.tabs.indexOf(tab.id)
    const to = Math.max(0, Math.min(prefs.tabs.length - 1, from + step))
    if (from < 0 || to === from) return
    moveTab(tab.id, to)
    setMoveNote(t.moved(tab.name, to + 1, prefs.tabs.length))
    // The moved row is re-inserted into the page: give the focus back to it once it is in its new place.
    window.requestAnimationFrame(() => {
      const button = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-market]') ?? [])].find((item) => item.dataset.market === tab.id)
      button?.focus()
    })
  }

  function toggleIndicator(id: IndicatorId) {
    setPrefs((current) => ({
      ...current,
      indicators: current.indicators.includes(id) ? current.indicators.filter((item) => item !== id) : indicatorIds.filter((item) => item === id || current.indicators.includes(item)),
    }))
  }

  function setDrawings(next: Drawing[]) {
    setPrefs((current) => ({ ...current, drawings: { ...current.drawings, [asset.id]: next.slice(-maxDrawingsPerMarket) } }))
  }

  function chooseKind(kind: ChartKind) {
    setTool('cursor')
    update({ kind })
  }

  const unitOptions: Array<{ id: LineRange | Timeframe; label: string; name: string; active: boolean; choose: () => void }> = prefs.kind === 'line'
    ? lineRanges.map((range) => ({ id: range, label: t.rangeLabels[range], name: t.rangeNames[range], active: range === prefs.range, choose: () => update({ range }) }))
    : timeframes.map((timeframe) => ({ id: timeframe, label: t.timeframeLabels[timeframe], name: t.timeframeNames[timeframe], active: timeframe === prefs.timeframe, choose: () => update({ timeframe }) }))

  const marketState = quote?.marketOpen === true ? t.marketOpen : quote?.marketOpen === false ? t.marketClosed : null

  const priceFormats = (item: MarketAsset, reference: number) => priceFormatter(locale, reference, {}, assetDigits(item, reference))

  return (
    <section className="tr-page">
      <article className={`panel mk-card is-${trend}`}>
        <div className="mk-layout">
          <div className="mk-main">
            <div className="mk-head">
              <div>
                <p className="eyebrow mk-eyebrow">
                  <span className={`mk-live-dot${quote?.marketOpen === false ? ' is-closed' : ''}`} title={t.live} aria-hidden="true" />
                  {t.eyebrow}
                  {marketState && <span className="mk-market-state">· {marketState}</span>}
                </p>
                <h2>{asset.name} · {asset.symbol}</h2>
              </div>
              <div className="mk-price">
                <strong>{price !== null ? money.format(price) : '—'}</strong>
                {change !== null && <span className={`mk-change is-${trend}`} title={rangeName}>{percent.format(change)}</span>}
              </div>
            </div>

            <div className="mk-toolbar">
              <div className="mk-seg" role="group" aria-label={t.kindLabel}>
                {(['line', 'candles'] as const).map((kind) => (
                  <button key={kind} type="button" className={prefs.kind === kind ? 'active' : ''} aria-pressed={prefs.kind === kind} onClick={() => chooseKind(kind)}>{t.kinds[kind]}</button>
                ))}
              </div>

              <div className="mk-units" role="group" aria-label={prefs.kind === 'line' ? t.kinds.line : t.kinds.candles}>
                {unitOptions.map((option) => (
                  <button key={option.id} type="button" className={option.active ? 'active' : ''} aria-pressed={option.active} title={option.name} onClick={option.choose}>{option.label}</button>
                ))}
              </div>

              <div className="mk-menu" ref={indicatorsRef}>
                <button type="button" className={`mk-menu-button${prefs.indicators.length > 0 ? ' has-value' : ''}`} aria-haspopup="true" aria-expanded={indicatorsOpen} onClick={() => setIndicatorsOpen((open) => !open)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 17l5-6 4 3 4-7 5 5" /></svg>
                  {t.indicatorsButton}
                  {prefs.indicators.length > 0 && <b>{prefs.indicators.length}</b>}
                </button>
                {indicatorsOpen && (
                  <div className="mk-popover" role="group" aria-label={t.indicatorsButton}>
                    {indicatorIds.map((id) => (
                      <label key={id} className="mk-check">
                        <input type="checkbox" checked={prefs.indicators.includes(id)} onChange={() => toggleIndicator(id)} />
                        <span className="mk-swatch" style={{ background: indicatorColors[id] }} aria-hidden="true" />
                        <span>{t.indicators[id]}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {tool !== 'cursor' && <p className="mk-hint" role="status">{t.toolHints[tool]}</p>}

            <div className="mk-body">
              <div className="mk-tools" role="group" aria-label={t.toolsLabel}>
                {drawingTools.map((item) => (
                  <button key={item} type="button" className={tool === item ? 'active' : ''} aria-pressed={tool === item} aria-label={t.tools[item]} title={t.tools[item]} onClick={() => setTool(item)}>
                    <ToolIcon tool={item} />
                  </button>
                ))}
                <button type="button" aria-label={t.tools.clear} title={t.tools.clear} disabled={drawings.length === 0} onClick={() => setDrawings([])}>
                  <ToolIcon tool="clear" />
                </button>
              </div>
              <div className="mk-stage" role="tabpanel" aria-label={t.chartLabel(asset.name)}>
                {candles.length >= 2 ? (
                  <PriceChart
                    key={viewKey}
                    candles={candles}
                    kind={prefs.kind}
                    visible={spec.visible}
                    intervalMs={intervalMs[spec.interval]}
                    indicators={prefs.indicators}
                    hasVolume={hasVolume}
                    drawings={drawings}
                    onDrawingsChange={setDrawings}
                    tool={tool}
                    onToolChange={setTool}
                    locale={locale}
                    labels={t.chart}
                    digits={digits}
                  />
                ) : failed ? (
                  <div className="mk-state">
                    <span>{t.loadError}</span>
                    <button type="button" onClick={() => setRetryCount((count) => count + 1)}>{t.retry}</button>
                  </div>
                ) : (
                  <div className="mk-state" role="status"><span>{t.loading}</span></div>
                )}
              </div>
            </div>

            <div className="mk-foot">
              <small>{t.noTrading}</small>
              {series && <small>{t.source}: {series.source}</small>}
            </div>
          </div>

          <aside className="mk-watch">
            <div className="mk-watch-head" ref={pickerRef}>
              <h3>{t.watchlist}</h3>
              <button type="button" className="mk-add-button" aria-haspopup="dialog" aria-expanded={pickerOpen} aria-label={t.addTab} title={t.addTab} onClick={() => setPickerOpen((open) => !open)}>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>
              </button>
              {pickerOpen && <AssetPicker tabs={prefs.tabs} full={prefs.tabs.length >= maxTabs} onPick={pickAsset} onClose={() => setPickerOpen(false)} labels={t} />}
            </div>
            <div
              ref={listRef}
              className="mk-watch-list"
              role="tablist"
              aria-orientation="vertical"
              aria-label={t.tabsLabel}
              onDragLeave={(event) => {
                // Leaving the list: no row is the target any more.
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrag((current) => (current ? { ...current, overId: null } : current))
              }}
            >
              {tabAssets.map((tab) => {
                const row = quotes[tab.id]
                const active = tab.id === asset.id
                const tone = row ? (row.changePct >= 0 ? 'up' : 'down') : 'flat'
                const formatPrice = row ? priceFormats(tab, row.price) : null
                // the change in price terms follows from the price and the percentage
                const absolute = row ? row.price - row.price / (1 + row.changePct / 100) : null
                const dropClass = drag?.overId === tab.id ? (drag.after ? ' drop-after' : ' drop-before') : ''
                return (
                  <div
                    key={tab.id}
                    className={`mk-row${active ? ' active' : ''}${drag?.id === tab.id ? ' is-dragging' : ''}${dropClass}`}
                    draggable={tabAssets.length > 1}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      // Firefox only starts a drag when some data is set.
                      event.dataTransfer.setData('text/plain', tab.id)
                      setDrag({ id: tab.id, overId: null, after: false })
                    }}
                    onDragOver={(event) => dragOverRow(event, tab.id)}
                    onDrop={(event) => {
                      event.preventDefault()
                      dropRow()
                    }}
                    onDragEnd={() => setDrag(null)}
                  >
                    <button
                      type="button"
                      role="tab"
                      data-market={tab.id}
                      aria-selected={active}
                      aria-keyshortcuts={tabAssets.length > 1 ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                      aria-label={`${tab.name} (${tab.symbol})${row ? ` ${percent.format(row.changePct / 100)}` : ''}`}
                      title={`${tab.name} · ${t.dayChange}${tabAssets.length > 1 ? ` · ${t.reorderHint}` : ''}`}
                      onClick={() => selectTab(tab.id)}
                      onKeyDown={(event) => keyMoveRow(event, tab)}
                    >
                      <span className="mk-avatar" style={{ background: avatarColor(tab) }} aria-hidden="true">{tab.symbol.replace(/[^A-Za-z0-9]/g, '').charAt(0)}</span>
                      <b className="mk-row-symbol">{tab.symbol}</b>
                      <span className="mk-row-price">{row && formatPrice ? formatPrice.format(row.price) : '–'}</span>
                      <span className={`mk-row-abs is-${tone}`}>{absolute !== null && formatPrice ? signed(formatPrice, absolute) : ''}</span>
                      <span className={`mk-row-pct is-${tone}`}>{row ? percent.format(row.changePct / 100) : ''}</span>
                    </button>
                    {tabAssets.length > 1 && (
                      <button type="button" className="mk-row-close" aria-label={t.closeTab(tab.symbol)} title={t.closeTab(tab.symbol)} onClick={() => closeTab(tab.id)}>
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7L7 17" /></svg>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="mk-visually-hidden" aria-live="polite">{moveNote}</p>
          </aside>
        </div>
      </article>
    </section>
  )
}
