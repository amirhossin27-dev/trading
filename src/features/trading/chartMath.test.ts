import { describe, expect, it } from 'vitest'
import {
  aggregateCandles, aggregateSessions, lastSessions, bollinger, bucketStart, bucketizePoints, distanceToSegment, ema, fibonacciPrice, indexToTime, intervalMs, niceTicks, priceDigits, rsi, sma, timeTicks, timeToIndex,
} from './chartMath'
import type { Candle } from './chartMath'

const minute = 60_000

function candle(t: number, o: number, h: number, l: number, c: number, v = 1): Candle {
  return { t, o, h, l, c, v }
}

describe('indicators', () => {
  it('averages over the period and leaves the warm-up empty', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })

  it('seeds the exponential average with the simple average', () => {
    const result = ema([1, 2, 3, 4, 5], 3)
    expect(result.slice(0, 2)).toEqual([null, null])
    expect(result[2]).toBeCloseTo(2)
    expect(result[3]).toBeCloseTo(3)
    expect(result[4]).toBeCloseTo(4)
  })

  it('draws the Bollinger bands symmetrically around the average', () => {
    const { middle, upper, lower } = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2)
    expect(middle[7]).toBeCloseTo(5)
    // population deviation of this classic sample is exactly 2
    expect(upper[7]).toBeCloseTo(9)
    expect(lower[7]).toBeCloseTo(1)
    expect(upper[3]).toBeNull()
  })

  it('calculates the RSI like the textbook example (Wilder)', () => {
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64]
    const result = rsi(closes, 14)
    expect(result[13]).toBeNull()
    // The published table rounds its intermediate values, so it is off by a few hundredths.
    expect(result[14]).toBeCloseTo(70.46, 1)
    expect(Math.abs((result[14] as number) - 70.53)).toBeLessThan(0.1)
    expect(Math.abs((result[15] as number) - 66.32)).toBeLessThan(0.3)
    expect(Math.abs((result[19] as number) - 57.97)).toBeLessThan(0.3)
  })

  it('treats a flat price as neutral and a rising one as overbought', () => {
    expect(rsi(new Array(20).fill(5), 14)[19]).toBe(50)
    expect(rsi(Array.from({ length: 20 }, (_, index) => index), 14)[19]).toBe(100)
  })
})

describe('candles', () => {
  it('aligns the buckets: epoch for hours, Monday for weeks, the 1st for months', () => {
    // 45-minute buckets start at 0:00, 0:45, 1:30 ... so 17:50 falls into the one that began at 17:15
    expect(bucketStart(Date.UTC(2026, 9, 7, 17, 50), '45m')).toBe(Date.UTC(2026, 9, 7, 17, 15))
    // 7 Oct 2026 is a Wednesday, the week starts on Monday 5 Oct
    expect(bucketStart(Date.UTC(2026, 9, 7, 17, 50), '1w')).toBe(Date.UTC(2026, 9, 5))
    expect(bucketStart(Date.UTC(2026, 9, 31, 23, 59), '1M')).toBe(Date.UTC(2026, 9, 1))
  })

  it('builds 45-minute candles from 15-minute ones and drops a cut-off first bucket', () => {
    const day = Date.UTC(2026, 9, 7)
    const at = (hour: number, minutes: number) => day + (hour * 60 + minutes) * minute
    const raw = [
      candle(at(10, 0), 5, 6, 4, 5.5, 1), // belongs to the bucket that began at 9:45, before the data
      candle(at(10, 30), 10, 12, 9, 11, 2),
      candle(at(10, 45), 11, 15, 10, 14, 3),
      candle(at(11, 0), 14, 14, 8, 9, 4),
      candle(at(11, 15), 9, 10, 8, 9.5, 5),
    ]
    expect(aggregateCandles(raw, '45m')).toEqual([
      candle(at(10, 30), 10, 15, 8, 9, 9),
      candle(at(11, 15), 9, 10, 8, 9.5, 5),
    ])
  })

  it('builds candles from plain prices', () => {
    const start = Date.UTC(2026, 9, 6)
    const result = bucketizePoints([
      { t: start, price: 1 }, { t: start + 3_600_000, price: 3 }, { t: start + 7_200_000, price: 2 },
      { t: start + 86_400_000 + 3_600_000, price: 5 },
    ], '1d')
    expect(result).toEqual([candle(start, 1, 3, 1, 2, 0), candle(start + 86_400_000, 5, 5, 5, 5, 0)])
  })
})

describe('time axis', () => {
  const times = [1000, 2000, 3000, 4000]

  it('maps times to fractional indexes and back, also outside of the data', () => {
    expect(timeToIndex(times, 2500)).toBeCloseTo(1.5)
    expect(timeToIndex(times, 5000)).toBeCloseTo(4)
    expect(timeToIndex(times, 0)).toBeCloseTo(-1)
    expect(indexToTime(times, 1.5)).toBeCloseTo(2500)
    expect(indexToTime(times, 4)).toBeCloseTo(5000)
    expect(indexToTime(times, -1)).toBeCloseTo(0)
  })

  it('copes with irregular candles', () => {
    const uneven = [0, 10, 40]
    expect(timeToIndex(uneven, 25)).toBeCloseTo(1.5)
    expect(indexToTime(uneven, 1.5)).toBeCloseTo(25)
  })

  it('knows the length of a candle', () => {
    expect(intervalMs['4h']).toBe(14_400_000)
  })
})

describe('scales and geometry', () => {
  it('picks rounded ticks inside the range', () => {
    expect(niceTicks(0.1712, 0.1788, 4)).toEqual([0.172, 0.174, 0.176, 0.178])
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(5, 5, 4)).toEqual([5])
  })

  it('shows more decimals for small prices', () => {
    expect(priceDigits(84000)).toBe(2)
    expect(priceDigits(0.1712)).toBe(4)
    expect(priceDigits(0.00001234)).toBe(8)
  })

  it('measures the distance to a segment, also beyond its ends', () => {
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBe(3)
    expect(distanceToSegment(13, 4, 0, 0, 10, 0)).toBe(5)
    expect(distanceToSegment(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2)
  })

  it('calculates retracement levels between two anchors', () => {
    expect(fibonacciPrice(100, 200, 0)).toBe(200)
    expect(fibonacciPrice(100, 200, 1)).toBe(100)
    expect(fibonacciPrice(100, 200, 0.5)).toBe(150)
  })
})

describe('time ticks', () => {
  const start = new Date(2026, 9, 1, 13, 20).getTime()

  it('puts day ticks on local midnights, whatever the time of the first candle', () => {
    const result = timeTicks(start, start + 9 * 86_400_000, 6)
    expect(result.unit).toBe('days')
    expect(result.ticks.length).toBeGreaterThan(2)
    for (const tick of result.ticks) {
      const date = new Date(tick)
      expect([date.getHours(), date.getMinutes()]).toEqual([0, 0])
      expect(tick).toBeGreaterThanOrEqual(start)
    }
  })

  it('keeps the same ticks when the window rolls on by one candle', () => {
    const a = timeTicks(start, start + 2 * 86_400_000, 8)
    const b = timeTicks(start + 4 * 3_600_000, start + 2 * 86_400_000 + 4 * 3_600_000, 8)
    expect(a.unit).toBe('minutes')
    expect(a.ticks.filter((tick) => b.ticks.includes(tick)).length).toBeGreaterThan(a.ticks.length - 3)
  })

  it('switches to month starts for long spans', () => {
    const result = timeTicks(Date.UTC(2024, 0, 15), Date.UTC(2026, 9, 1), 6)
    expect(result.unit).toBe('months')
    for (const tick of result.ticks) expect(new Date(tick).getDate()).toBe(1)
    expect(result.ticks.length).toBeLessThanOrEqual(8)
  })

  it('returns nothing for an empty window', () => {
    expect(timeTicks(5, 5, 6).ticks).toEqual([])
  })
})

describe('exchange sessions', () => {
  const hour = 3_600_000
  const candle = (t: number, o: number, c = o) => ({ t, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1 })

  it('starts the groups with the opening of each day instead of with midnight', () => {
    const monday = Date.UTC(2026, 9, 5, 8)
    const tuesday = monday + 24 * hour
    const hourly = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => candle(monday + index * hour, 10 + index))
      .concat([0, 1, 2].map((index) => candle(tuesday + index * hour, 50 + index)))

    const result = aggregateSessions(hourly, 4 * hour)

    expect(result.map((item) => item.t)).toEqual([monday, monday + 4 * hour, tuesday])
    expect(result[0]).toMatchObject({ o: 10, c: 13, v: 4 })
    expect(result[2]).toMatchObject({ o: 50, v: 3 })
  })

  it('keeps the last trading day, or more days when the last one has just begun', () => {
    const day = (date: number, count: number) => Array.from({ length: count }, (_, index) => candle(Date.UTC(2026, 9, date, 8) + index * 300_000, 1))
    const candles = [...day(5, 40), ...day(6, 40)]

    expect(lastSessions(candles, 12)).toHaveLength(40)
    expect(lastSessions([...day(5, 40), ...day(6, 4)], 12)).toHaveLength(44)
    expect(lastSessions([], 12)).toEqual([])
  })
})
