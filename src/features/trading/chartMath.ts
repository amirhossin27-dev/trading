/** Pure helpers of the market chart: candles, indicators, scales, formatting. No React in here. */

export interface Candle {
  /** Open time in ms. */
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export type Interval = '5m' | '15m' | '30m' | '45m' | '1h' | '2h' | '4h' | '8h' | '1d' | '1w' | '1M'

const minute = 60_000
const day = 86_400_000

/** Length of one candle; a month is only an average (calendar months are handled in `bucketStart`). */
export const intervalMs: Record<Interval, number> = {
  '5m': 5 * minute,
  '15m': 15 * minute,
  '30m': 30 * minute,
  '45m': 45 * minute,
  '1h': 60 * minute,
  '2h': 120 * minute,
  '4h': 240 * minute,
  '8h': 480 * minute,
  '1d': day,
  '1w': 7 * day,
  '1M': 30.4375 * day,
}

/** Start of the candle that contains `t`: epoch aligned, weeks start on Monday, months on the 1st (all UTC). */
export function bucketStart(t: number, interval: Interval) {
  if (interval === '1M') {
    const date = new Date(t)
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  }
  const size = intervalMs[interval]
  // 1 January 1970 was a Thursday, so Monday is four days later.
  const offset = interval === '1w' ? 4 * day : 0
  return Math.floor((t - offset) / size) * size + offset
}

/** Groups finer candles into coarser ones (15 min -> 45 min). A first bucket that is cut off by the start of the data is dropped. */
export function aggregateCandles(candles: Candle[], interval: Interval): Candle[] {
  const result: Candle[] = []
  const cutOff = candles.length > 0 && bucketStart(candles[0].t, interval) !== candles[0].t
  for (const candle of candles) {
    const start = bucketStart(candle.t, interval)
    const last = result[result.length - 1]
    if (last && last.t === start) {
      last.h = Math.max(last.h, candle.h)
      last.l = Math.min(last.l, candle.l)
      last.c = candle.c
      last.v += candle.v
    } else {
      result.push({ t: start, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v })
    }
  }
  return cutOff && result.length > 1 ? result.slice(1) : result
}

/**
 * Groups candles of an exchange into longer ones that start with the session: the first candle of each (UTC) day opens the first
 * group, so that 4-hour candles of a stock run from the opening bell and not from midnight. The group keeps the time of its first candle.
 */
export function aggregateSessions(candles: Candle[], bucketMs: number): Candle[] {
  const result: Candle[] = []
  let day = -1
  let dayStart = 0
  let bucket = -1
  for (const candle of candles) {
    const candleDay = Math.floor(candle.t / 86_400_000)
    if (candleDay !== day) {
      day = candleDay
      dayStart = candle.t
      bucket = -1
    }
    const index = Math.floor((candle.t - dayStart) / bucketMs)
    const last = result[result.length - 1]
    if (last && index === bucket) {
      last.h = Math.max(last.h, candle.h)
      last.l = Math.min(last.l, candle.l)
      last.c = candle.c
      last.v += candle.v
    } else {
      bucket = index
      result.push({ ...candle })
    }
  }
  return result
}

/** The candles of the last trading day, or of the last days until at least `minimum` candles are there. */
export function lastSessions(candles: Candle[], minimum: number): Candle[] {
  let start = candles.length
  let day = -1
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    const candleDay = Math.floor(candles[i].t / 86_400_000)
    if (candleDay !== day) {
      if (day !== -1 && candles.length - start >= minimum) break
      day = candleDay
    }
    start = i
  }
  return candles.slice(start)
}

/** Builds candles from plain price points (fallback source without OHLC). Buckets without a point are left out. */
export function bucketizePoints(points: Array<{ t: number; price: number }>, interval: Interval): Candle[] {
  return aggregateCandles(points.map((point) => ({ t: point.t, o: point.price, h: point.price, l: point.price, c: point.price, v: 0 })), interval)
}

export type Series = Array<number | null>

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

/** Exponential average, seeded with the simple average of the first `period` values. */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let previous = values.slice(0, period).reduce((total, value) => total + value, 0) / period
  out[period - 1] = previous
  for (let i = period; i < values.length; i += 1) {
    previous = values[i] * k + previous * (1 - k)
    out[i] = previous
  }
  return out
}

export interface BollingerBands {
  middle: Series
  upper: Series
  lower: Series
}

export function bollinger(values: number[], period = 20, deviations = 2): BollingerBands {
  const middle = sma(values, period)
  const upper: Series = new Array(values.length).fill(null)
  const lower: Series = new Array(values.length).fill(null)
  for (let i = period - 1; i < values.length; i += 1) {
    const mean = middle[i] as number
    let variance = 0
    for (let j = i - period + 1; j <= i; j += 1) variance += (values[j] - mean) ** 2
    const spread = Math.sqrt(variance / period) * deviations
    upper[i] = mean + spread
    lower[i] = mean - spread
  }
  return { middle, upper, lower }
}

/** Relative strength index with Wilder's smoothing. */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null)
  if (values.length <= period) return out
  const toRsi = (gain: number, loss: number) => (gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss))
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1]
    if (change >= 0) gain += change
    else loss -= change
  }
  let averageGain = gain / period
  let averageLoss = loss / period
  out[period] = toRsi(averageGain, averageLoss)
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1]
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period
    out[i] = toRsi(averageGain, averageLoss)
  }
  return out
}

/** Position (fractional candle index) of a point in time; extrapolates with the average candle length outside the data. */
export function timeToIndex(times: number[], t: number) {
  const count = times.length
  if (count === 0) return 0
  if (count === 1) return 0
  const step = (times[count - 1] - times[0]) / (count - 1)
  if (t <= times[0]) return (t - times[0]) / step
  if (t >= times[count - 1]) return count - 1 + (t - times[count - 1]) / step
  let low = 0
  let high = count - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (times[middle] <= t) low = middle
    else high = middle
  }
  return low + (t - times[low]) / (times[high] - times[low])
}

export function indexToTime(times: number[], index: number) {
  const count = times.length
  if (count === 0) return 0
  if (count === 1) return times[0]
  const step = (times[count - 1] - times[0]) / (count - 1)
  if (index <= 0) return times[0] + index * step
  if (index >= count - 1) return times[count - 1] + (index - (count - 1)) * step
  const low = Math.floor(index)
  return times[low] + (index - low) * (times[low + 1] - times[low])
}

/** Rounded axis values inside [min, max], about `count` of them. */
export function niceTicks(min: number, max: number, count: number) {
  if (!(max > min) || count < 1) return [min]
  const rawStep = (max - min) / count
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const fraction = rawStep / magnitude
  const step = (fraction < 1.5 ? 1 : fraction < 3.5 ? 2 : fraction < 7.5 ? 5 : 10) * magnitude
  const ticks: number[] = []
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) {
    ticks.push(Number(value.toPrecision(12)))
  }
  return ticks
}

/** How many decimals a price needs so that small coins stay readable. */
export function priceDigits(reference: number) {
  const value = Math.abs(reference)
  if (value >= 100) return 2
  if (value >= 1) return 3
  if (value >= 0.1) return 4
  if (value >= 0.01) return 5
  if (value >= 0.001) return 6
  return 8
}

export function priceFormatter(locale: string, reference: number, options: Intl.NumberFormatOptions = {}, fixedDigits?: number) {
  const digits = fixedDigits ?? priceDigits(reference)
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, ...options })
}

/** Distance of a point to the segment a-b in pixels. */
export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const ratio = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy))
}

export const fibonacciLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

/** Price at a Fibonacci retracement level between the two anchor prices (0 = second anchor, 1 = first). */
export function fibonacciPrice(from: number, to: number, level: number) {
  return to + (from - to) * level
}

export interface TimeTicks {
  /** Tick times in ms. */
  ticks: number[]
  /** What one tick step is: decides how the labels are written. */
  unit: 'minutes' | 'days' | 'months'
}

const fixedSteps = [5 * minute, 10 * minute, 15 * minute, 30 * minute, 60 * minute, 120 * minute, 180 * minute, 240 * minute, 360 * minute, 720 * minute, day, 2 * day, 7 * day, 14 * day]
const monthSteps = [1, 2, 3, 6, 12, 24, 60]

/**
 * Axis ticks at round local times (full hours, midnights, Mondays, month starts), so they stay put while the chart rolls.
 * Day ticks also mark the start of each month, so the labels can name the month there.
 */
export function timeTicks(start: number, end: number, maxCount: number): TimeTicks {
  const span = end - start
  if (!(span > 0) || maxCount < 1) return { ticks: [], unit: 'days' }
  const fixed = fixedSteps.find((step) => span / step <= maxCount)
  if (fixed !== undefined) {
    const offset = new Date(start).getTimezoneOffset() * minute
    // weeks and fortnights start on Monday (1 January 1970 was a Thursday)
    const base = fixed >= 7 * day ? 4 * day : 0
    let ticks: number[] = []
    for (let t = Math.ceil((start - offset - base) / fixed) * fixed + base + offset; t <= end; t += fixed) {
      // Steps of whole days follow local midnights, also across a change of summer time.
      if (fixed >= day) {
        const date = new Date(t)
        ticks.push(new Date(date.getFullYear(), date.getMonth(), date.getDate() + (date.getHours() >= 12 ? 1 : 0)).getTime())
      } else ticks.push(t)
    }
    if (fixed > day) {
      const first = new Date(start)
      for (let month = new Date(first.getFullYear(), first.getMonth() + 1, 1); month.getTime() <= end; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) {
        const t = month.getTime()
        ticks = ticks.filter((tick) => Math.abs(tick - t) >= fixed * 0.6)
        ticks.push(t)
      }
      ticks.sort((a, b) => a - b)
    }
    return { ticks: ticks.filter((tick) => tick >= start && tick <= end), unit: fixed < day ? 'minutes' : 'days' }
  }
  const months = monthSteps.find((step) => span / (step * 30.4375 * day) <= maxCount) ?? 60
  const first = new Date(start)
  const year = first.getFullYear()
  let month = Math.ceil(first.getMonth() / months) * months
  if (new Date(year, month, 1).getTime() < start) month += months
  const ticks: number[] = []
  for (;;) {
    const t = new Date(year, month, 1).getTime()
    if (t > end) break
    ticks.push(t)
    month += months
    if (ticks.length > 400) break
  }
  return { ticks, unit: 'months' }
}
