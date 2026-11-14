import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { bollinger, distanceToSegment, ema, fibonacciLevels, fibonacciPrice, indexToTime, niceTicks, priceFormatter, rsi, sma, timeToIndex, timeTicks } from './chartMath'
import type { Candle, Series } from './chartMath'
import { indicatorColors } from './indicatorColors'
import type { ChartKind } from './marketData'
import type { Drawing, IndicatorId } from './marketPrefs'

export type Tool = 'cursor' | 'trend' | 'hline' | 'fib' | 'measure'

export interface ChartLabels {
  open: string
  high: string
  low: string
  close: string
  volume: string
  indicators: Record<IndicatorId, string>
  bars: string
  zoomIn: string
  zoomOut: string
  zoomReset: string
  removeDrawing: string
  noVolume: string
  units: { day: string; hour: string; minute: string }
}

const AXIS_W = 62
const AXIS_H = 22
const PAD_L = 4
const PAD_T = 8
const GAP = 8
const SUB_HEIGHT = { volume: 46, rsi: 62 }
/** Empty candle slots right of the last candle. */
const MARGIN = 2
const MIN_COUNT = 8
const HIT_DISTANCE = 7

interface View {
  count: number
  /** Candles the chart is scrolled back from the newest one. */
  shift: number
}

interface Anchor {
  t: number
  p: number
}

interface Pending {
  tool: Tool
  a: Anchor
}

interface Layout {
  from: number
  to: number
  step: number
  plotW: number
  mainTop: number
  mainH: number
  lo: number
  hi: number
}

interface PriceChartProps {
  candles: Candle[]
  kind: ChartKind
  /** Candles shown at first. */
  visible: number
  intervalMs: number
  indicators: IndicatorId[]
  hasVolume: boolean
  drawings: Drawing[]
  onDrawingsChange: (next: Drawing[]) => void
  tool: Tool
  onToolChange: (tool: Tool) => void
  locale: string
  labels: ChartLabels
  /** Fixed number of price decimals (currency pairs); otherwise the price decides. */
  digits?: number
}

const day = 86_400_000

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function Badge({ x, y, text, anchor = 'middle', tone }: { x: number; y: number; text: string; anchor?: 'start' | 'middle' | 'end'; tone?: string }) {
  const width = text.length * 6.4 + 12
  const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2
  return (
    <g className="mk-badge" pointerEvents="none">
      <rect x={left} y={y - 9} width={width} height={18} rx={4} style={tone ? { fill: tone } : undefined} />
      <text x={left + width / 2} y={y + 4} textAnchor="middle">{text}</text>
    </g>
  )
}

interface IndicatorData {
  sma20: Series | null
  sma50: Series | null
  ema21: Series | null
  bands: { middle: Series; upper: Series; lower: Series } | null
  rsi: Series | null
}

function linePath(values: Series, from: number, to: number, x: (index: number) => number, y: (value: number) => number) {
  let path = ''
  let open = false
  const start = Math.max(0, Math.floor(from) - 1)
  const end = Math.min(values.length - 1, Math.ceil(to) + 1)
  for (let i = start; i <= end; i += 1) {
    const value = values[i]
    if (value === null) {
      open = false
      continue
    }
    path += `${open ? 'L' : 'M'}${x(i).toFixed(1)} ${y(value).toFixed(1)}`
    open = true
  }
  return path
}

interface SeriesLayerProps extends Layout {
  candles: Candle[]
  kind: ChartKind
  data: IndicatorData
  showBands: boolean
  clipId: string
  gradientId: string
}

/** Candles or line plus the moving averages. Kept apart so that moving the crosshair does not redraw it. */
const SeriesLayer = memo(function SeriesLayer({ candles, kind, from, to, step, mainTop, mainH, lo, hi, data, showBands, clipId, gradientId }: SeriesLayerProps) {
  const x = (index: number) => PAD_L + (index - from + 0.5) * step
  const y = (value: number) => mainTop + ((hi - value) / (hi - lo)) * mainH
  const start = Math.max(0, Math.floor(from))
  const end = Math.min(candles.length - 1, Math.ceil(to))
  const bodyWidth = Math.max(1, Math.min(18, step * 0.68))

  let drawing: ReactNode
  if (kind === 'candles') {
    const items = []
    for (let i = start; i <= end; i += 1) {
      const candle = candles[i]
      const rising = candle.c >= candle.o
      const top = y(Math.max(candle.o, candle.c))
      const bottom = y(Math.min(candle.o, candle.c))
      items.push(
        <g key={candle.t} className={rising ? 'mk-candle is-up' : 'mk-candle is-down'}>
          <line x1={x(i)} x2={x(i)} y1={y(candle.h)} y2={y(candle.l)} />
          <rect x={x(i) - bodyWidth / 2} y={top} width={bodyWidth} height={Math.max(1, bottom - top)} />
        </g>,
      )
    }
    drawing = items
  } else {
    const closes: Series = candles.map((candle) => candle.c)
    const line = linePath(closes, from, to, x, y)
    const first = Math.max(0, Math.floor(from) - 1)
    const last = Math.min(candles.length - 1, Math.ceil(to) + 1)
    drawing = (
      <>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.26" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {line && <path d={`${line}L${x(last).toFixed(1)} ${mainTop + mainH}L${x(first).toFixed(1)} ${mainTop + mainH}Z`} fill={`url(#${gradientId})`} />}
        <path d={line} className="mk-line" />
      </>
    )
  }

  const overlay = (id: 'sma20' | 'sma50' | 'ema21', values: Series | null) => values && <path key={id} d={linePath(values, from, to, x, y)} className="mk-overlay" style={{ stroke: indicatorColors[id] }} />

  let bandArea = ''
  if (showBands && data.bands) {
    const upper = linePath(data.bands.upper, from, to, x, y)
    const lower: string[] = []
    for (let i = Math.min(candles.length - 1, Math.ceil(to) + 1); i >= Math.max(0, Math.floor(from) - 1); i -= 1) {
      const value = data.bands.lower[i]
      if (value !== null) lower.push(`L${x(i).toFixed(1)} ${y(value).toFixed(1)}`)
    }
    if (upper && lower.length > 0) bandArea = `${upper}${lower.join('')}Z`
  }

  return (
    <g clipPath={`url(#${clipId})`} className="mk-layer">
      {bandArea && <path d={bandArea} className="mk-band-fill" />}
      {showBands && data.bands && (
        <>
          <path d={linePath(data.bands.upper, from, to, x, y)} className="mk-band" />
          <path d={linePath(data.bands.lower, from, to, x, y)} className="mk-band" />
        </>
      )}
      {drawing}
      {overlay('sma20', data.sma20)}
      {overlay('sma50', data.sma50)}
      {overlay('ema21', data.ema21)}
    </g>
  )
})

interface SubPanelProps extends Layout {
  id: 'volume' | 'rsi'
  top: number
  height: number
  candles: Candle[]
  data: IndicatorData
  plotClipId: string
  label: string
  index: number
  formatCompact: (value: number) => string
}

const SubPanel = memo(function SubPanel({ id, top, height, candles, from, to, step, plotW, data, plotClipId, label, index, formatCompact }: SubPanelProps) {
  const x = (position: number) => PAD_L + (position - from + 0.5) * step
  const start = Math.max(0, Math.floor(from))
  const end = Math.min(candles.length - 1, Math.ceil(to))
  const inner = { top: top + 14, height: height - 16 }
  const bodyWidth = Math.max(1, Math.min(18, step * 0.68))
  let content: ReactNode
  let value: string

  if (id === 'volume') {
    let max = 0
    for (let i = start; i <= end; i += 1) max = Math.max(max, candles[i].v)
    const bars = []
    for (let i = start; i <= end; i += 1) {
      const candle = candles[i]
      const barHeight = max > 0 ? (candle.v / max) * inner.height : 0
      bars.push(<rect key={candle.t} x={x(i) - bodyWidth / 2} y={inner.top + inner.height - barHeight} width={bodyWidth} height={Math.max(0, barHeight)} className={candle.c >= candle.o ? 'mk-vol is-up' : 'mk-vol is-down'} />)
    }
    content = bars
    value = formatCompact(candles[Math.min(Math.max(index, 0), candles.length - 1)]?.v ?? 0)
  } else {
    const series = data.rsi ?? []
    const y = (v: number) => inner.top + ((100 - v) / 100) * inner.height
    const path = linePath(series, from, to, x, y)
    const current = series[Math.min(Math.max(index, 0), series.length - 1)]
    value = current === null || current === undefined ? '–' : current.toFixed(1)
    content = (
      <>
        {[30, 70].map((level) => <line key={level} x1={PAD_L} x2={PAD_L + plotW} y1={y(level)} y2={y(level)} className="mk-rsi-level" />)}
        <path d={path} className="mk-overlay" style={{ stroke: indicatorColors.rsi }} />
        <text x={PAD_L + plotW + 8} y={y(70) + 4} className="mk-axis-text">70</text>
        <text x={PAD_L + plotW + 8} y={y(30) + 4} className="mk-axis-text">30</text>
      </>
    )
  }

  return (
    <g>
      <line x1={PAD_L} x2={PAD_L + plotW + AXIS_W} y1={top - GAP / 2} y2={top - GAP / 2} className="mk-panel-line" />
      <text x={PAD_L + 6} y={top + 9} className="mk-panel-label">{label} <tspan className="mk-panel-value">{value}</tspan></text>
      <g clipPath={`url(#${plotClipId})`}>{content}</g>
    </g>
  )
})

export function PriceChart({ candles, kind, visible, intervalMs: candleMs, indicators, hasVolume, drawings, onDrawingsChange, tool, onToolChange, locale, labels, digits }: PriceChartProps) {
  const gradientId = useId()
  const clipId = useId()
  const plotClipId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 720, h: 340 })
  const [view, setView] = useState<View>(() => ({ count: Math.min(visible, candles.length) + MARGIN, shift: 0 }))
  const [hover, setHover] = useState<number | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [measure, setMeasure] = useState<{ a: Anchor; b: Anchor } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panning, setPanning] = useState(false)
  const [lastTool, setLastTool] = useState(tool)
  const panRef = useRef<{ x: number; shift: number } | null>(null)
  const downRef = useRef<{ x: number; y: number } | null>(null)

  // A half-finished drawing and the ruler disappear when another tool is chosen.
  if (lastTool !== tool) {
    setLastTool(tool)
    setPending(null)
    setMeasure(null)
  }

  const count = candles.length
  const times = useMemo(() => candles.map((candle) => candle.t), [candles])
  const showVolume = indicators.includes('volume') && hasVolume
  const showRsi = indicators.includes('rsi')
  const showBands = indicators.includes('bollinger')

  const data = useMemo<IndicatorData>(() => {
    const closes = candles.map((candle) => candle.c)
    return {
      sma20: indicators.includes('sma20') ? sma(closes, 20) : null,
      sma50: indicators.includes('sma50') ? sma(closes, 50) : null,
      ema21: indicators.includes('ema21') ? ema(closes, 21) : null,
      bands: indicators.includes('bollinger') ? bollinger(closes, 20, 2) : null,
      rsi: indicators.includes('rsi') ? rsi(closes, 14) : null,
    }
  }, [candles, indicators])

  // The chart fills its box; the box is measured so that candles, text and drawings keep their pixel size.
  useEffect(() => {
    const element = wrapRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize((current) => (Math.abs(current.w - width) < 0.5 && Math.abs(current.h - height) < 0.5 ? current : { w: width, h: height }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // ---- geometry ----
  const panels: Array<{ id: 'volume' | 'rsi'; top: number; height: number }> = []
  const wanted = (showVolume ? SUB_HEIGHT.volume + GAP : 0) + (showRsi ? SUB_HEIGHT.rsi + GAP : 0)
  const fit = Math.min(1, (0.45 * (size.h - PAD_T - AXIS_H)) / (wanted || 1))
  const subTotal = Math.round(wanted * fit)
  const mainH = Math.max(90, size.h - PAD_T - AXIS_H - subTotal)
  let cursorTop = PAD_T + mainH + GAP
  for (const id of ['volume', 'rsi'] as const) {
    if ((id === 'volume' && !showVolume) || (id === 'rsi' && !showRsi)) continue
    const height = Math.round((SUB_HEIGHT[id] + GAP) * fit) - GAP
    panels.push({ id, top: cursorTop, height })
    cursorTop += height + GAP
  }
  const plotBottom = PAD_T + mainH + subTotal
  const plotW = Math.max(60, size.w - AXIS_W - PAD_L)
  const viewCount = clamp(view.count, MIN_COUNT, count + 10)
  const maxShift = Math.max(0, count + MARGIN - 6)
  const shift = clamp(view.shift, 0, maxShift)
  const to = count + MARGIN - shift
  const from = to - viewCount
  const step = plotW / viewCount
  const xOf = (index: number) => PAD_L + (index - from + 0.5) * step
  const indexAtX = (x: number) => (x - PAD_L) / step + from - 0.5

  let lo = Infinity
  let hi = -Infinity
  for (let i = Math.max(0, Math.floor(from)); i <= Math.min(count - 1, Math.ceil(to)); i += 1) {
    const candle = candles[i]
    lo = Math.min(lo, kind === 'candles' ? candle.l : candle.c)
    hi = Math.max(hi, kind === 'candles' ? candle.h : candle.c)
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0
    hi = 1
  }
  const padding = (hi - lo || Math.abs(hi) * 0.02 || 1) * 0.08
  lo -= padding
  hi += padding
  const layout: Layout = { from, to, step, plotW, mainTop: PAD_T, mainH, lo, hi }
  const yOf = (price: number) => PAD_T + ((hi - price) / (hi - lo)) * mainH
  const priceAtY = (y: number) => hi - ((y - PAD_T) / mainH) * (hi - lo)

  const last = candles[count - 1]
  const reference = last?.c ?? 1
  const fmt = useMemo(() => priceFormatter(locale, reference, {}, digits), [locale, reference, digits])
  const formatCompact = useMemo(() => {
    const formatter = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 })
    return (value: number) => formatter.format(value)
  }, [locale])
  const percent = useMemo(() => new Intl.NumberFormat(locale, { style: 'percent', signDisplay: 'always', minimumFractionDigits: 2, maximumFractionDigits: 2 }), [locale])

  const axisFormats = useMemo(() => ({
    time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
    day: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }),
    month: new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' }),
  }), [locale])
  const fullTime = useMemo(() => {
    if (candleMs < day) return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    if (candleMs > 20 * day) return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
    return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  }, [candleMs, locale])

  // ---- drawings in screen space ----
  function locate(drawing: Drawing) {
    return { x1: xOf(timeToIndex(times, drawing.t1)), y1: yOf(drawing.p1), x2: xOf(timeToIndex(times, drawing.t2)), y2: yOf(drawing.p2) }
  }

  function hits(drawing: Drawing, x: number, y: number) {
    const { x1, y1, x2, y2 } = locate(drawing)
    if (drawing.kind === 'hline') return Math.abs(y - y1) <= HIT_DISTANCE
    if (drawing.kind === 'trend') return distanceToSegment(x, y, x1, y1, x2, y2) <= HIT_DISTANCE
    if (x < Math.min(x1, x2) - HIT_DISTANCE) return false
    return fibonacciLevels.some((level) => Math.abs(y - yOf(fibonacciPrice(drawing.p1, drawing.p2, level))) <= HIT_DISTANCE)
  }

  const selected = drawings.find((item) => item.id === selectedId) ?? null
  const activePending = pending && pending.tool === tool ? pending : null

  // ---- interaction ----
  function localPoint(event: PointerEvent<Element>) {
    const rect = svgRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }

  function anchorAt(point: { x: number; y: number }): Anchor {
    return { t: indexToTime(times, indexAtX(point.x)), p: priceAtY(point.y) }
  }

  function hoverIndexAt(x: number) {
    return clamp(Math.round(indexAtX(x)), 0, count - 1)
  }

  function setViewClamped(next: View) {
    setView({ count: clamp(next.count, MIN_COUNT, count + 10), shift: clamp(next.shift, 0, Math.max(0, count + MARGIN - 6)) })
  }

  function zoom(factor: number, atX: number) {
    const nextCount = clamp(viewCount * factor, MIN_COUNT, count + 10)
    const focus = indexAtX(atX)
    const nextFrom = focus + 0.5 - (atX - PAD_L) / (plotW / nextCount)
    setViewClamped({ count: nextCount, shift: count + MARGIN - (nextFrom + nextCount) })
  }

  function resetView() {
    setView({ count: Math.min(visible, count) + MARGIN, shift: 0 })
  }

  function finishDrawing(kindOfDrawing: 'trend' | 'fib', a: Anchor, b: Anchor) {
    const first = { x: xOf(timeToIndex(times, a.t)), y: yOf(a.p) }
    const second = { x: xOf(timeToIndex(times, b.t)), y: yOf(b.p) }
    setPending(null)
    onToolChange('cursor')
    if (Math.hypot(first.x - second.x, first.y - second.y) < 4) return
    const created: Drawing = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: kindOfDrawing, t1: a.t, p1: a.p, t2: b.t, p2: b.p }
    onDrawingsChange([...drawings, created])
    setSelectedId(created.id)
  }

  function handleDown(event: PointerEvent<SVGRectElement>) {
    if (event.button !== 0 || count < 2) return
    const point = localPoint(event)
    downRef.current = point
    const inMain = point.y >= PAD_T && point.y <= PAD_T + mainH

    if (tool === 'cursor') {
      const hit = inMain ? [...drawings].reverse().find((item) => hits(item, point.x, point.y)) : undefined
      setSelectedId(hit?.id ?? null)
      if (!hit) {
        panRef.current = { x: point.x, shift }
        setPanning(true)
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Without capture the drag still works while the pointer stays over the chart.
        }
      }
      return
    }
    if (!inMain) return
    const anchor = anchorAt(point)
    if (tool === 'hline') {
      const created: Drawing = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: 'hline', t1: anchor.t, p1: anchor.p, t2: anchor.t, p2: anchor.p }
      onDrawingsChange([...drawings, created])
      setSelectedId(created.id)
      onToolChange('cursor')
      return
    }
    if (tool === 'measure') {
      if (activePending) {
        setMeasure({ a: activePending.a, b: anchor })
        setPending(null)
      } else {
        setMeasure(null)
        setPending({ tool, a: anchor })
      }
      return
    }
    if (activePending) finishDrawing(tool, activePending.a, anchor)
    else setPending({ tool, a: anchor })
  }

  function handleMove(event: PointerEvent<SVGRectElement>) {
    if (count < 2) return
    const point = localPoint(event)
    setPointer(point)
    setHover(hoverIndexAt(point.x))
    if (panRef.current) setViewClamped({ count: viewCount, shift: panRef.current.shift + (point.x - panRef.current.x) / step })
  }

  function handleUp(event: PointerEvent<SVGRectElement>) {
    const point = localPoint(event)
    if (panRef.current) {
      panRef.current = null
      setPanning(false)
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Nothing was captured.
      }
    }
    // Press, drag and release also draws a line (besides two separate clicks).
    const down = downRef.current
    downRef.current = null
    if (down && activePending && (tool === 'trend' || tool === 'fib' || tool === 'measure') && Math.hypot(point.x - down.x, point.y - down.y) > 8) {
      const anchor = anchorAt(point)
      if (tool === 'measure') {
        setMeasure({ a: activePending.a, b: anchor })
        setPending(null)
      } else {
        finishDrawing(tool, activePending.a, anchor)
      }
    }
  }

  function handleLeave() {
    if (panRef.current) return
    setPointer(null)
    setHover(null)
  }

  function removeDrawing(id: string) {
    onDrawingsChange(drawings.filter((item) => item.id !== id))
    setSelectedId(null)
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      setPending(null)
      setMeasure(null)
      setSelectedId(null)
      if (tool !== 'cursor') onToolChange('cursor')
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
      event.preventDefault()
      removeDrawing(selected.id)
      return
    }
    if (count < 2) return
    const lastIndex = count - 1
    const stepSize = Math.max(1, Math.round(viewCount / 40))
    const keys: Record<string, number> = { ArrowLeft: (hover ?? lastIndex) - stepSize, ArrowRight: (hover ?? lastIndex) + stepSize, Home: 0, End: lastIndex }
    if (!(event.key in keys)) return
    event.preventDefault()
    setHover(clamp(keys[event.key], 0, lastIndex))
    setPointer(null)
  }

  // Mouse wheel zooms around the pointer. React attaches wheel listeners as passive, so this one is added by hand.
  const wheelRef = useRef<(event: WheelEvent) => void>(() => undefined)
  useEffect(() => {
    wheelRef.current = (event: WheelEvent) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect || count < 2) return
      event.preventDefault()
      zoom(event.deltaY > 0 ? 1.18 : 1 / 1.18, event.clientX - rect.left)
    }
  })
  useEffect(() => {
    const element = wrapRef.current
    if (!element) return undefined
    const listener = (event: WheelEvent) => wheelRef.current(event)
    element.addEventListener('wheel', listener, { passive: false })
    return () => element.removeEventListener('wheel', listener)
  }, [])

  // ---- render pieces ----
  const priceTicks = niceTicks(lo, hi, Math.max(2, Math.floor(mainH / 48)))
  const axis = timeTicks(indexToTime(times, from), indexToTime(times, to), Math.max(2, Math.floor(plotW / 96)))
  const timeLabels = axis.ticks
    .map((t) => ({ t, x: xOf(timeToIndex(times, t)) }))
    // labels close to the edges would be cut off
    .filter((tick) => tick.x > PAD_L + 24 && tick.x < PAD_L + plotW - 24)
    .map((tick) => {
      const date = new Date(tick.t)
      const midnight = date.getHours() === 0 && date.getMinutes() === 0
      const format = axis.unit === 'months' ? axisFormats.month : axis.unit === 'days' || midnight ? axisFormats.day : axisFormats.time
      return { ...tick, label: format.format(date) }
    })

  const active = hover !== null ? Math.min(hover, count - 1) : count - 1
  const shown = candles[active]
  const previousClose = active > 0 ? candles[active - 1].c : shown?.o
  const shownChange = shown && previousClose ? (shown.c - previousClose) / previousClose : 0
  const lastRising = last ? last.c >= last.o : true

  function formatSpan(ms: number) {
    const abs = Math.abs(ms)
    if (abs >= 2 * day) return `${Math.round(abs / day)} ${labels.units.day}`
    if (abs >= day) return `${(abs / day).toFixed(1)} ${labels.units.day}`
    const hours = Math.floor(abs / 3_600_000)
    const minutes = Math.round((abs % 3_600_000) / 60_000)
    return hours > 0 ? `${hours} ${labels.units.hour}${minutes ? ` ${minutes} ${labels.units.minute}` : ''}` : `${minutes} ${labels.units.minute}`
  }

  function renderDrawing(drawing: Drawing, preview = false) {
    const { x1, y1, x2, y2 } = locate(drawing)
    const isSelected = drawing.id === selectedId
    const className = `mk-drawing is-${drawing.kind}${isSelected ? ' is-selected' : ''}${preview ? ' is-preview' : ''}`
    if (drawing.kind === 'hline') {
      return (
        <g key={drawing.id} className={className}>
          <line x1={PAD_L} x2={PAD_L + plotW} y1={y1} y2={y1} />
          <Badge x={PAD_L + plotW + 4} y={y1} text={fmt.format(drawing.p1)} anchor="start" tone="var(--accent)" />
        </g>
      )
    }
    if (drawing.kind === 'trend') {
      return (
        <g key={drawing.id} className={className}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} />
          <circle cx={x1} cy={y1} r={isSelected ? 4 : 3} />
          <circle cx={x2} cy={y2} r={isSelected ? 4 : 3} />
        </g>
      )
    }
    const left = Math.min(x1, x2)
    return (
      <g key={drawing.id} className={className}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="mk-fib-guide" />
        {fibonacciLevels.map((level) => {
          const price = fibonacciPrice(drawing.p1, drawing.p2, level)
          const levelY = yOf(price)
          return (
            <g key={level}>
              <line x1={left} x2={PAD_L + plotW} y1={levelY} y2={levelY} />
              <text x={Math.max(left, PAD_L) + 4} y={levelY - 4} className="mk-fib-label">{(level * 100).toFixed(level === 0 || level === 1 || level === 0.5 ? 0 : 1)}% · {fmt.format(price)}</text>
            </g>
          )
        })}
        <circle cx={x1} cy={y1} r={isSelected ? 4 : 3} />
        <circle cx={x2} cy={y2} r={isSelected ? 4 : 3} />
      </g>
    )
  }

  function removeHandlePosition(drawing: Drawing) {
    const { x1, y1, x2, y2 } = locate(drawing)
    const x = drawing.kind === 'hline' ? PAD_L + 28 : clamp((x1 + x2) / 2, PAD_L + 14, PAD_L + plotW - 14)
    const y = drawing.kind === 'hline' ? y1 : drawing.kind === 'trend' ? (y1 + y2) / 2 : Math.min(y1, y2)
    return { left: x, top: clamp(y - 16, PAD_T, PAD_T + mainH - 22) }
  }

  const measureLine = measure ?? (activePending && tool === 'measure' && pointer ? { a: activePending.a, b: anchorAt(pointer) } : null)
  const measureLayer = measureLine && (() => {
    const ax = xOf(timeToIndex(times, measureLine.a.t))
    const ay = yOf(measureLine.a.p)
    const bx = xOf(timeToIndex(times, measureLine.b.t))
    const by = yOf(measureLine.b.p)
    const delta = measureLine.b.p - measureLine.a.p
    const ratio = measureLine.a.p !== 0 ? delta / measureLine.a.p : 0
    const bars = Math.round(Math.abs(timeToIndex(times, measureLine.b.t) - timeToIndex(times, measureLine.a.t)))
    const text = `${percent.format(ratio)} · ${delta >= 0 ? '+' : '−'}${fmt.format(Math.abs(delta))} · ${bars} ${labels.bars} · ${formatSpan(measureLine.b.t - measureLine.a.t)}`
    const width = text.length * 6.2 + 14
    const boxX = clamp((ax + bx) / 2 - width / 2, PAD_L + 2, PAD_L + plotW - width - 2)
    const boxY = clamp(by < ay ? by - 30 : by + 12, PAD_T + 2, PAD_T + mainH - 22)
    return (
      <g className={`mk-measure ${delta >= 0 ? 'is-up' : 'is-down'}`} pointerEvents="none">
        <rect x={Math.min(ax, bx)} y={Math.min(ay, by)} width={Math.abs(bx - ax)} height={Math.abs(by - ay)} className="mk-measure-area" />
        <line x1={ax} y1={ay} x2={bx} y2={by} />
        <rect x={boxX} y={boxY} width={width} height={20} rx={5} className="mk-measure-box" />
        <text x={boxX + width / 2} y={boxY + 14} textAnchor="middle">{text}</text>
      </g>
    )
  })()

  const previewDrawing: Drawing | null = activePending && pointer && (tool === 'trend' || tool === 'fib')
    ? { id: 'preview', kind: tool, t1: activePending.a.t, p1: activePending.a.p, t2: anchorAt(pointer).t, p2: anchorAt(pointer).p }
    : null

  const crossX = hover !== null ? xOf(hover) : pointer ? xOf(hoverIndexAt(pointer.x)) : null
  const inMain = pointer !== null && pointer.y >= PAD_T && pointer.y <= PAD_T + mainH
  const crossPrice = pointer && inMain ? priceAtY(pointer.y) : null
  const indicatorList = (['sma20', 'sma50', 'ema21'] as const).filter((id) => indicators.includes(id))
  const valueOf = (series: Series | null | undefined) => {
    const value = series?.[active]
    return value === null || value === undefined ? '–' : fmt.format(value)
  }
  const seriesById: Record<'sma20' | 'sma50' | 'ema21', Series | null> = { sma20: data.sma20, sma50: data.sma50, ema21: data.ema21 }

  return (
    <div className={`mk-chart${tool !== 'cursor' ? ' is-drawing' : ''}${panning ? ' is-panning' : ''}`} ref={wrapRef}>
      <div className="mk-chart-focus" role="img" aria-label={`${labels.close}: ${last ? fmt.format(last.c) : '–'}`} tabIndex={0} onKeyDown={handleKey} onBlur={() => { setHover(null); setPointer(null) }}>
        <svg ref={svgRef} width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
          <defs>
            <clipPath id={clipId}><rect x={PAD_L} y={PAD_T} width={plotW} height={mainH} /></clipPath>
            <clipPath id={plotClipId}><rect x={PAD_L} y={0} width={plotW} height={size.h} /></clipPath>
          </defs>

          {priceTicks.map((tick) => (
            <g key={tick} pointerEvents="none">
              <line x1={PAD_L} x2={PAD_L + plotW} y1={yOf(tick)} y2={yOf(tick)} className="mk-grid" />
              <text x={PAD_L + plotW + 8} y={yOf(tick) + 4} className="mk-axis-text">{fmt.format(tick)}</text>
            </g>
          ))}
          {timeLabels.map((tick) => (
            <g key={tick.t} pointerEvents="none">
              <line x1={tick.x} x2={tick.x} y1={PAD_T} y2={plotBottom} className="mk-grid is-vertical" />
              <text x={tick.x} y={size.h - 6} textAnchor="middle" className="mk-axis-text">{tick.label}</text>
            </g>
          ))}

          {count >= 2 && <SeriesLayer {...layout} candles={candles} kind={kind} data={data} showBands={showBands} clipId={clipId} gradientId={gradientId} />}
          {panels.map((panel) => (
            <SubPanel {...layout} key={panel.id} id={panel.id} top={panel.top} height={panel.height} candles={candles} data={data} plotClipId={plotClipId} label={panel.id === 'volume' ? labels.volume : labels.indicators.rsi} index={active} formatCompact={formatCompact} />
          ))}

          {last && (
            <g pointerEvents="none" className={`mk-last ${kind === 'candles' ? (lastRising ? 'is-up' : 'is-down') : ''}`}>
              <line x1={PAD_L} x2={PAD_L + plotW} y1={clamp(yOf(last.c), PAD_T, PAD_T + mainH)} y2={clamp(yOf(last.c), PAD_T, PAD_T + mainH)} />
              <Badge x={PAD_L + plotW + 4} y={clamp(yOf(last.c), PAD_T + 9, PAD_T + mainH - 9)} text={fmt.format(last.c)} anchor="start" tone="currentColor" />
            </g>
          )}

          <g clipPath={`url(#${clipId})`} pointerEvents="none">
            {drawings.map((drawing) => renderDrawing(drawing))}
            {previewDrawing && renderDrawing(previewDrawing, true)}
            {measureLayer}
          </g>

          <rect className="mk-hit" x={PAD_L} y={0} width={plotW} height={plotBottom} onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={handleUp} onPointerCancel={handleUp} onPointerLeave={handleLeave} onDoubleClick={() => { if (tool === 'cursor') resetView() }} />

          {crossX !== null && count >= 2 && (
            <g pointerEvents="none" className="mk-cross">
              <line x1={crossX} x2={crossX} y1={PAD_T} y2={plotBottom} />
              {crossPrice !== null && pointer && (
                <>
                  <line x1={PAD_L} x2={PAD_L + plotW} y1={pointer.y} y2={pointer.y} />
                  <Badge x={PAD_L + plotW + 4} y={pointer.y} text={fmt.format(crossPrice)} anchor="start" />
                </>
              )}
              <Badge x={clamp(crossX, 48, PAD_L + plotW - 48)} y={size.h - 11} text={fullTime.format(candles[hover ?? hoverIndexAt(pointer?.x ?? 0)].t)} />
            </g>
          )}

        </svg>

        {shown && (
          <div className="mk-legend" aria-hidden="true">
            <div className="mk-legend-main">
              <b>{fullTime.format(shown.t)}</b>
              {kind === 'candles' ? (
                <>
                  <span className="mk-ohl">{labels.open} <i>{fmt.format(shown.o)}</i></span>
                  <span className="mk-ohl">{labels.high} <i>{fmt.format(shown.h)}</i></span>
                  <span className="mk-ohl">{labels.low} <i>{fmt.format(shown.l)}</i></span>
                  <span>{labels.close} <i>{fmt.format(shown.c)}</i></span>
                </>
              ) : (
                <span>{labels.close} <i>{fmt.format(shown.c)}</i></span>
              )}
              <span className={shownChange >= 0 ? 'is-up' : 'is-down'}>{percent.format(shownChange)}</span>
            </div>
            {(indicatorList.length > 0 || showBands) && (
              <div className="mk-legend-indicators">
                {indicatorList.map((id) => <span key={id} style={{ color: indicatorColors[id] }}>{labels.indicators[id]} <i>{valueOf(seriesById[id])}</i></span>)}
                {showBands && <span style={{ color: indicatorColors.bollinger }}>{labels.indicators.bollinger} <i>{valueOf(data.bands?.upper)} / {valueOf(data.bands?.lower)}</i></span>}
              </div>
            )}
            {indicators.includes('volume') && !hasVolume && <div className="mk-legend-indicators"><span>{labels.noVolume}</span></div>}
          </div>
        )}
      </div>

      {selected && tool === 'cursor' && (
        <button type="button" className="mk-remove" style={removeHandlePosition(selected)} aria-label={labels.removeDrawing} title={labels.removeDrawing} onClick={() => removeDrawing(selected.id)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7L7 17" /></svg>
        </button>
      )}

      <div className="mk-zoom" role="group">
        <button type="button" onClick={() => zoom(1 / 1.4, PAD_L + plotW / 2)} aria-label={labels.zoomIn} title={labels.zoomIn}>+</button>
        <button type="button" onClick={() => zoom(1.4, PAD_L + plotW / 2)} aria-label={labels.zoomOut} title={labels.zoomOut}>−</button>
        <button type="button" onClick={resetView} aria-label={labels.zoomReset} title={labels.zoomReset}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4.5h4.5" /></svg>
        </button>
      </div>
    </div>
  )
}
