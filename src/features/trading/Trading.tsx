import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './trading.css'
import type { Language } from '../../types/platform'
import { localeFor } from '../overview/overviewCopy'
import { tradingCopy } from './tradingCopy'
import { AssetLogo } from './AssetLogo'
import { TradingDialog } from './TradingDialog'
import { Watchlist } from './Watchlist'
import { AlarmControls } from './AlarmControls'
import type { AlertEvent } from './alertService'
import { indicatorColors } from './indicatorColors'
import { PriceChart } from './PriceChart'
import type { Tool } from './PriceChart'
import { intervalMs, priceFormatter } from './chartMath'
import { moneyFormatter } from './money'
import { assetById, assetDigits, marketAssets } from './marketAssets'
import type { MarketAsset } from './marketAssets'
import { lineRanges, loadQuotes, loadSeries, seriesSpec, timeframes } from './marketData'
import type { ChartKind, LineRange, MarketSeries, Quote, Timeframe } from './marketData'
import { indicatorIds, maxDrawingsPerMarket, readPrefs, writePrefs, updateMarketPrefs } from './marketPrefs'
import type { ChartView, Drawing, IndicatorId, MarketPrefs } from './marketPrefs'

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

function KindIcon({ kind }: { kind: ChartKind }) {
  return kind === 'line'
    ? <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 17l5-6 4 3 4-7 5 5" /></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 4v3M7 17v3M17 3v4M17 15v5" /><rect x="5" y="7" width="4" height="10" rx="1" /><rect x="15" y="7" width="4" height="8" rx="1" /></svg>
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

function WatchlistLayer({ embedded, open, onClose, label, closeLabel, children }: {
  embedded: boolean; open: boolean; onClose: () => void; label: string; closeLabel: string; children: ReactNode
}) {
  return embedded ? children : <TradingDialog open={open} onClose={onClose} label={label} closeLabel={closeLabel} className="mk-watch-overlay">{children}</TradingDialog>
}

/** A number with its sign, formatted like the price. */
function signed(format: Intl.NumberFormat, value: number) {
  const text = format.format(Math.abs(value))
  return `${value < 0 ? '−' : '+'}${text}`
}

export function Trading({ language, embedded = false, settingsControl }: { language: Language; embedded?: boolean; settingsControl?: ReactNode }) {
  const t = tradingCopy(language)
  const locale = localeFor(language)
  const [prefs, setPrefs] = useState<MarketPrefs>(readPrefs)
  const [alertView, setAlertView] = useState<(ChartView & { event: AlertEvent }) | null>(null)
  const [tool, setTool] = useState<Tool>('cursor')
  const [indicatorsOpen, setIndicatorsOpen] = useState(false)
  const [watchOpen, setWatchOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [seriesState, setSeriesState] = useState<SeriesState>({ key: '', series: null, failed: false })
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  // The rows of the list that are on screen: only their prices are requested.
  const [visibleIds, setVisibleIds] = useState<string[]>([])

  // Everything the user sets up is saved right away, so a reload (or the next visit) shows the same view.
  useEffect(() => {
    writePrefs(prefs)
  }, [prefs])

  const indicatorsRef = useDismiss(indicatorsOpen, () => setIndicatorsOpen(false))
  const optionsRef = useDismiss(optionsOpen, () => setOptionsOpen(false))
  const toolsRef = useDismiss(toolsOpen, () => setToolsOpen(false))

  // A market found with the search is built from the stored name on every lookup: keep one object, or every render would start a new request.
  const asset = useMemo(() => alertView?.event.asset ?? assetById(prefs.active, prefs.extras) ?? marketAssets[0], [alertView?.event.asset, prefs.active, prefs.extras])
  const chartView = alertView ?? prefs
  // A drawing tool belongs to one chart: another market starts with the cursor again.
  const [toolAsset, setToolAsset] = useState(asset.id)
  if (toolAsset !== asset.id) {
    setToolAsset(asset.id)
    setTool('cursor')
  }
  // The prices do not depend on the order of the list: moving a row must not start new requests.
  const marketKey = [...new Set([asset.id, ...(embedded || watchOpen ? visibleIds : [])])].sort().join(',')
  const quoteAssets = useMemo(() => marketKey.split(',').map((id) => id === asset.id ? asset : assetById(id, prefs.extras)).filter((item): item is MarketAsset => item !== undefined), [marketKey, prefs.extras, asset])
  const spec = seriesSpec(chartView.kind, chartView.range, chartView.timeframe, asset.source)
  const requestKey = `${asset.id}|${spec.interval}|${spec.limit}|${retryCount}`
  const viewKey = `${asset.id}|${chartView.kind}|${chartView.range}|${chartView.timeframe}|${alertView?.event.id ?? ''}`

  function update(patch: Partial<MarketPrefs>) {
    const viewChanged = patch.kind !== undefined || patch.range !== undefined || patch.timeframe !== undefined
    setPrefs((current) => {
      // A target can still be viewed when the saved-market cap is full; never overwrite a different market's view.
      if (viewChanged && alertView && current.active !== alertView.event.asset.id) return current
      return updateMarketPrefs(current, viewChanged && alertView ? { kind: alertView.kind, range: alertView.range, timeframe: alertView.timeframe, ...patch } : patch)
    })
    if (viewChanged) {
      setAlertView((current) => current ? { ...current, kind: patch.kind ?? current.kind, range: patch.range ?? current.range, timeframe: patch.timeframe ?? current.timeframe } : null)
    }
  }

  function openAlarm(event: AlertEvent) {
    // A saved market becomes the active one; any other market is only shown, not added to a list.
    if (prefs.tabs.includes(event.asset.id)) update({ active: event.asset.id })
    setWatchOpen(false)
    setOptionsOpen(false); setToolsOpen(false); setIndicatorsOpen(false)
    // Opening an alert is temporary; preserve the user's view until they deliberately change a control.
    setAlertView({ event, kind: 'candles', range: '1W', timeframe: 'auto' })
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
      // The active market may be outside this page: preserve the API's 20-symbol request cap.
      const batches = Array.from({ length: Math.ceil(quoteAssets.length / 20) }, (_, index) => quoteAssets.slice(index * 20, (index + 1) * 20))
      Promise.all(batches.map((batch) => loadQuotes(batch, controller.signal)))
        .then((results) => { if (!controller.signal.aborted) setQuotes((current) => Object.assign({}, current, ...results)) })
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
  const rangeName = chartView.kind === 'line' || chartView.timeframe === 'auto' ? t.rangeNames[chartView.range] : t.timeframeNames[chartView.timeframe]

  const currency = quote?.currency ?? series?.currency ?? 'USD'
  const digits = assetDigits(asset, price ?? 1)
  const money = useMemo(() => moneyFormatter(locale, currency, price ?? 1, digits), [locale, price, currency, digits])
  const percent = useMemo(() => new Intl.NumberFormat(locale, { style: 'percent', signDisplay: 'always', minimumFractionDigits: 2, maximumFractionDigits: 2 }), [locale])

  const drawings = prefs.drawings[asset.id] ?? []

  function selectTab(id: string) {
    setAlertView(null)
    update({ active: id })
    if (!embedded) setWatchOpen(false)
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

  const unitOptions: Array<{ id: LineRange | Timeframe; label: string; name: string; active: boolean; choose: () => void }> = chartView.kind === 'line'
    ? lineRanges.map((range) => ({ id: range, label: t.rangeLabels[range], name: t.rangeNames[range], active: range === chartView.range, choose: () => update({ range, timeframe: 'auto' }) }))
    : timeframes.map((timeframe) => ({ id: timeframe, label: timeframe === 'auto' ? t.autoTimeframe : t.timeframeLabels[timeframe], name: t.timeframeNames[timeframe] ?? t.autoTimeframe, active: timeframe === chartView.timeframe, choose: () => update({ timeframe }) }))

  const marketState = quote?.marketOpen === true ? t.marketOpen : quote?.marketOpen === false ? t.marketClosed : null

  const priceFormat = useMemo(() => priceFormatter(locale, price ?? 1, {}, digits), [locale, price, digits])
  const absoluteChange = price !== null && baseline !== null ? price - baseline : null
  const dayQuote = quote ? { tone: quote.changePct >= 0 ? 'up' : 'down', text: percent.format(quote.changePct / 100) } : null

  const kindControls = <div className="mk-seg" role="group" aria-label={t.kindLabel}>
    {(['line', 'candles'] as const).map((kind) => <button key={kind} type="button" className={chartView.kind === kind ? 'active' : ''} aria-pressed={chartView.kind === kind} onClick={() => chooseKind(kind)}>{t.kinds[kind]}</button>)}
  </div>

  const indicatorMenu = <div className="mk-menu mk-indicator-menu" ref={indicatorsRef}>
    <button type="button" className={`mk-menu-button mk-indicators-button${prefs.indicators.length > 0 ? ' has-value' : ''}`} aria-label={t.indicatorsButton} aria-haspopup="true" aria-expanded={indicatorsOpen} onClick={() => { setIndicatorsOpen((open) => !open); setToolsOpen(false); setOptionsOpen(false) }}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 17l5-6 4 3 4-7 5 5" /></svg>
      <span className="mk-control-label">{t.indicatorsButton}</span>{prefs.indicators.length > 0 && <b>{prefs.indicators.length}</b>}
    </button>
    {indicatorsOpen && <div className="mk-popover" role="group" aria-label={t.indicatorsButton}>
      {indicatorIds.map((id) => <label key={id} className="mk-check"><input type="checkbox" checked={prefs.indicators.includes(id)} onChange={() => toggleIndicator(id)} /><span className="mk-swatch" style={{ background: indicatorColors[id] }} aria-hidden="true" /><span>{t.indicators[id]}</span></label>)}
    </div>}
  </div>

  const drawingControls = <div className="mk-tools" role="group" aria-label={t.toolsLabel}>
    {drawingTools.map((item) => <button key={item} type="button" className={tool === item ? 'active' : ''} aria-pressed={tool === item} aria-label={t.tools[item]} title={t.tools[item]} onClick={() => { setTool(item); setToolsOpen(false) }}><ToolIcon tool={item} /></button>)}
    <button type="button" aria-label={t.tools.clear} title={t.tools.clear} disabled={drawings.length === 0} onClick={() => setDrawings([])}><ToolIcon tool="clear" /></button>
  </div>

  return (
    <section className={`tr-page${embedded ? ' tr-embedded' : ' tr-standalone'}`}>
      <article className={`panel mk-card is-${trend}`}>
        <div className="mk-layout">
          <div className="mk-main">
            <div className="mk-head">
              <div className="mk-identity">
                <AssetLogo asset={asset} size={embedded ? 40 : 36} className="mk-head-logo" />
                <div className="mk-identity-text">
                  <h2 aria-label={`${asset.name} · ${asset.symbol}`}>{asset.symbol}</h2>
                  <p className="mk-head-name">
                    <span className={`mk-live-dot${quote?.marketOpen === false ? ' is-closed' : ''}`} title={marketState ?? t.live} aria-hidden="true" />
                    <span className="mk-head-title">{asset.name}</span>
                    {marketState && <span className="mk-market-state">· {marketState}</span>}
                  </p>
                </div>
              </div>
              <div className="mk-price">
                <strong>{price !== null ? money.format(price) : '—'}</strong>
                {change !== null && <span className={`mk-change is-${trend}`} title={rangeName}>{absoluteChange !== null && <span className="mk-change-abs">{signed(priceFormat, absoluteChange)}</span>} {percent.format(change)}</span>}
              </div>
              {!embedded && <button type="button" className="mk-watch-trigger" aria-label={`${t.openWatchlist} (${prefs.tabs.length})`} aria-haspopup="dialog" aria-expanded={watchOpen} onClick={() => { setWatchOpen(true); setOptionsOpen(false); setToolsOpen(false); setIndicatorsOpen(false) }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></svg>
              </button>}
            </div>

            <div className="mk-toolbar">
              {embedded && kindControls}
              <div className={`mk-units${embedded ? '' : ' mk-ranges'}`} role="group" aria-label={embedded ? (chartView.kind === 'line' ? t.kinds.line : t.kinds.candles) : t.rangeLabel}>
                {embedded ? unitOptions.map((option) => <button key={option.id} type="button" className={option.active ? 'active' : ''} aria-pressed={option.active} title={option.name} onClick={option.choose}>{option.label}</button>)
                  : lineRanges.map((range) => <button key={range} type="button" className={chartView.range === range && (chartView.kind === 'line' || chartView.timeframe === 'auto') ? 'active' : ''} aria-pressed={chartView.range === range && (chartView.kind === 'line' || chartView.timeframe === 'auto')} title={t.rangeNames[range]} onClick={() => update({ range, timeframe: 'auto' })}>{t.rangeLabels[range]}</button>)}
              </div>
              {embedded && chartView.kind === 'candles' && <div className="mk-units" role="group" aria-label={t.rangeLabel}>
                {lineRanges.map((range) => <button key={range} type="button" className={chartView.range === range && chartView.timeframe === 'auto' ? 'active' : ''} aria-pressed={chartView.range === range && chartView.timeframe === 'auto'} title={t.rangeNames[range]} onClick={() => update({ range, timeframe: 'auto' })}>{t.rangeLabels[range]}</button>)}
              </div>}
              {embedded && indicatorMenu}
            </div>

            {tool !== 'cursor' && <p className="mk-hint" role="status">{t.toolHints[tool]}</p>}

            <div className="mk-body">
              {embedded && drawingControls}
              <div className="mk-stage" role="tabpanel" aria-label={t.chartLabel(asset.name)}>
                {candles.length >= 2 ? (
                  <PriceChart
                    key={viewKey}
                    candles={candles}
                    kind={chartView.kind}
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
                    alarmTarget={alertView ? { price: alertView.event.target, label: `${language === 'de' ? 'Alarm' : 'Alert'} · ${priceFormatter(locale, alertView.event.target).format(alertView.event.target)} ${alertView.event.currency}` } : undefined}
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

            {!embedded && <div className="mk-bottom-bar">
              <div className="mk-menu" ref={optionsRef}>
                <button type="button" className="mk-menu-button" aria-label={t.chartOptions} aria-expanded={optionsOpen} onClick={() => { setOptionsOpen((open) => !open); setToolsOpen(false); setIndicatorsOpen(false) }}><KindIcon kind={chartView.kind} /><span>{t.kinds[chartView.kind]}</span></button>
                {optionsOpen && <div className="mk-popover mk-chart-options">
                  {kindControls}
                  {chartView.kind === 'candles' && <div className="mk-units" role="group" aria-label={t.kinds.candles}>
                    {timeframes.map((timeframe) => <button key={timeframe} type="button" className={chartView.timeframe === timeframe ? 'active' : ''} aria-pressed={chartView.timeframe === timeframe} title={t.timeframeNames[timeframe] ?? t.autoTimeframe} onClick={() => update({ timeframe })}>{timeframe === 'auto' ? t.autoTimeframe : t.timeframeLabels[timeframe]}</button>)}
                  </div>}
                </div>}
              </div>
              <div className="mk-menu" ref={toolsRef}>
                <button type="button" className={`mk-menu-button mk-tools-trigger${tool !== 'cursor' ? ' has-value' : ''}`} aria-label={t.toolsButton} aria-expanded={toolsOpen} onClick={() => { setToolsOpen((open) => !open); setOptionsOpen(false); setIndicatorsOpen(false) }}><ToolIcon tool={tool} /><span>{t.toolsButton}</span></button>
                {toolsOpen && <div className="mk-popover mk-tool-popover">{drawingControls}</div>}
              </div>
              {indicatorMenu}
              <AlarmControls asset={asset} currency={asset.source === 'binance' ? 'USD' : quote?.currency ?? series?.currency ?? ''} language={language} onOpen={openAlarm} />
              {settingsControl}
            </div>}

          </div>

          <WatchlistLayer embedded={embedded} open={watchOpen} onClose={() => setWatchOpen(false)} label={t.watchlist} closeLabel={t.closeWatchlist}>
            <Watchlist
              prefs={prefs}
              setPrefs={setPrefs}
              quotes={quotes}
              activeId={asset.id}
              onSelect={selectTab}
              onVisibleChange={setVisibleIds}
              labels={t}
              locale={locale}
              overlay={!embedded}
              footer={!embedded && (
                <div className="mk-watch-footer">
                  <button type="button" className="mk-current" aria-label={`${t.backToChart}: ${asset.name}`} onClick={() => setWatchOpen(false)}>
                    <AssetLogo asset={asset} size={28} />
                    <b>{asset.symbol}</b>
                    <span className="mk-current-price">{price !== null ? priceFormat.format(price) : '–'}</span>
                    {dayQuote && <span className={`mk-current-change is-${dayQuote.tone}`}>{dayQuote.text} {t.today}</span>}
                    <span className="mk-current-go">{t.backToChart}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg></span>
                  </button>
                </div>
              )}
            />
          </WatchlistLayer>
        </div>
      </article>
    </section>
  )
}
