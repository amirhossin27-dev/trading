import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PriceChart } from './PriceChart'
import { tradingCopy } from './tradingCopy'
import type { Tool } from './PriceChart'

const candles = Array.from({ length: 100 }, (_, i) => ({
  t: Date.UTC(2026, 0, 1) + i * 60_000,
  o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 100,
}))

beforeEach(() => {
  // jsdom has no native PointerEvent; preserve the browser event fields used by the real chart.
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? 'mouse'
    }
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function setup(tool: Tool = 'cursor', data = candles) {
  const onDrawingsChange = vi.fn()
  const onToolChange = vi.fn()
  const props = { candles: data, kind: 'candles' as const, visible: 80, intervalMs: 60_000,
    indicators: [], hasVolume: true, drawings: [], onDrawingsChange, tool, onToolChange,
    locale: 'en-US', labels: tradingCopy('en').chart }
  const rendered = render(<PriceChart {...props} />)
  const hit = () => document.querySelector('.mk-hit')!
  const touch = (type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel' | 'lostPointerCapture', id: number, x: number, y = 100) =>
    fireEvent[type](hit(), { pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y })
  const rects = () => Array.from(document.querySelectorAll('.mk-candle rect'))
  const width = () => Number(rects()[0]?.getAttribute('width'))
  const picture = () => document.querySelector('.mk-layer')?.innerHTML
  return { ...rendered, props, touch, rects, width, picture, onDrawingsChange, onToolChange, hit }
}

describe('PriceChart gestures', () => {
  it('marks an alarm target without adding a drawing or changing the visible candle prices', () => {
    const chart = setup()
    chart.rerender(<PriceChart {...chart.props} alarmTarget={{ price: 1000, label: 'Alarm · 1000 USD' }} />)
    expect(document.querySelector('.mk-alarm-target')?.textContent).toContain('1000 USD')
    expect(document.querySelector('.mk-alarm-target line')).toBeTruthy()
    expect(chart.onDrawingsChange).not.toHaveBeenCalled()
  })

  it.each(['trend', 'fib', 'measure'] as const)('shows a live %s preview before committing a touch drawing', (tool) => {
    const chart = setup(tool)
    chart.touch('pointerDown', 1, 200)
    chart.touch('pointerMove', 1, 300, 140)
    expect(document.querySelector(tool === 'measure' ? '.mk-measure' : '.mk-drawing.is-preview')).not.toBeNull()
    expect(chart.onDrawingsChange).not.toHaveBeenCalled()
    chart.touch('pointerCancel', 1, 300, 140)
    expect(document.querySelector('.mk-drawing.is-preview,.mk-measure')).toBeNull()
  })

  it('cancels a pinch when the SVG origin changes instead of mixing old and new coordinates', () => {
    const chart = setup()
    chart.touch('pointerDown', 1, 200)
    chart.touch('pointerDown', 2, 462)
    const before = chart.picture()
    const svg = document.querySelector('.mk-chart-focus > svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 0, right: 820, bottom: 340, width: 720, height: 340, x: 100, y: 0, toJSON: () => ({}) })
    chart.touch('pointerMove', 1, 201)
    chart.touch('pointerMove', 2, 463)
    expect(chart.picture()).toBe(before)
    expect(document.querySelector('.mk-chart.is-panning')).toBeNull()
  })

  it('cancels active pointers when the chart is resized', () => {
    let report: ResizeObserverCallback
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { report = callback }
      observe() {}
      disconnect() {}
    })
    const chart = setup()
    chart.touch('pointerDown', 1, 200)
    chart.touch('pointerDown', 2, 462)
    act(() => report([{ contentRect: { width: 600, height: 300 } } as ResizeObserverEntry], {} as ResizeObserver))
    const resized = chart.picture()
    chart.touch('pointerMove', 1, 201)
    chart.touch('pointerMove', 2, 463)
    expect(chart.picture()).toBe(resized)
    expect(document.querySelector('.mk-chart.is-panning')).toBeNull()
  })


  it('zooms around the two-finger midpoint and reverses without changing the app', () => {
    const chart = setup()
    const originalWidth = chart.width()
    const originalPicture = chart.picture()
    chart.touch('pointerDown', 1, 200)
    chart.touch('pointerDown', 2, 462)
    chart.touch('pointerMove', 1, 69)
    chart.touch('pointerMove', 2, 593)
    expect(chart.width()).toBeCloseTo(originalWidth * 2)
    // Candles 60 and 61 straddle x=331 before and after zoom. After zoom the first rendered index is 40.
    const center = (node: Element) => Number(node.getAttribute('x')) + Number(node.getAttribute('width')) / 2
    expect((center(chart.rects()[20]) + center(chart.rects()[21])) / 2).toBeCloseTo(331)
    chart.touch('pointerMove', 1, 200)
    chart.touch('pointerMove', 2, 462)
    expect(chart.picture()).toBe(originalPicture)
    expect(chart.onDrawingsChange).not.toHaveBeenCalled()
  })

  it('continues panning after lifting one finger without jumping or changing zoom', () => {
    const chart = setup()
    chart.touch('pointerDown', 1, 200)
    chart.touch('pointerDown', 2, 462)
    chart.touch('pointerMove', 1, 69)
    chart.touch('pointerMove', 2, 593)
    const pinched = chart.picture()
    const zoomedWidth = chart.width()
    chart.touch('pointerUp', 2, 593)
    expect(chart.picture()).toBe(pinched)
    chart.touch('pointerMove', 1, 99)
    expect(chart.width()).toBeCloseTo(zoomedWidth)
    expect(chart.picture()).not.toBe(pinched)
    chart.touch('pointerUp', 1, 99)
    const finished = chart.picture()
    chart.touch('pointerMove', 1, 150)
    expect(chart.picture()).toBe(finished)
  })

  it.each(['pointerCancel', 'lostPointerCapture'] as const)('ends a gesture on %s without drawing or leaving a stuck drag', (event) => {
    const chart = setup('trend')
    chart.touch('pointerDown', 1, 200)
    chart.touch('pointerMove', 1, 260, 140)
    chart.touch(event, 1, 260, 140)
    chart.touch('pointerUp', 1, 280, 160)
    expect(chart.onDrawingsChange).not.toHaveBeenCalled()
    expect(document.querySelector('.mk-chart.is-panning')).toBeNull()
    chart.touch('pointerDown', 3, 300)
    chart.touch('pointerUp', 3, 300)
    expect(chart.onDrawingsChange).not.toHaveBeenCalled()
  })

  it('does not turn a pinch into a horizontal line; a deliberate single tap still draws', () => {
    const chart = setup('hline')
    chart.touch('pointerDown', 1, 200)
    expect(chart.onDrawingsChange).not.toHaveBeenCalled()
    chart.touch('pointerDown', 2, 462)
    chart.touch('pointerMove', 2, 550)
    chart.touch('pointerUp', 2, 550)
    chart.touch('pointerUp', 1, 200)
    expect(chart.onDrawingsChange).not.toHaveBeenCalled()
    chart.touch('pointerDown', 3, 300)
    chart.touch('pointerUp', 3, 300)
    expect(chart.onDrawingsChange).toHaveBeenCalledOnce()
    expect(chart.onDrawingsChange.mock.calls[0][0][0].kind).toBe('hline')
  })

  it('keeps touch drawing by dragging and by two separate taps', () => {
    const chart = setup('trend')
    chart.touch('pointerDown', 1, 200)
    chart.touch('pointerMove', 1, 300, 140)
    chart.touch('pointerUp', 1, 300, 140)
    expect(chart.onDrawingsChange).toHaveBeenCalledOnce()
    expect(chart.onDrawingsChange.mock.calls[0][0][0].kind).toBe('trend')
    chart.onDrawingsChange.mockClear()
    chart.touch('pointerDown', 2, 240)
    chart.touch('pointerUp', 2, 240)
    chart.touch('pointerDown', 3, 320, 160)
    chart.touch('pointerUp', 3, 320, 160)
    expect(chart.onDrawingsChange).toHaveBeenCalledOnce()
  })

  it('ignores a third finger and remains bounded for extreme pinch distances', () => {
    const chart = setup()
    chart.touch('pointerDown', 1, 200)
    chart.touch('pointerDown', 2, 462)
    const beforeThird = chart.picture()
    chart.touch('pointerDown', 3, 600)
    chart.touch('pointerMove', 3, 650)
    expect(chart.picture()).toBe(beforeThird)
    chart.touch('pointerMove', 2, 50_000)
    expect(chart.rects().length).toBeLessThanOrEqual(11)
    expect(chart.width()).toBeGreaterThan(0)
    chart.touch('pointerMove', 2, 200)
    expect(chart.width()).toBeGreaterThan(0)
    expect(chart.picture()).not.toContain('NaN')
  })

  it('cancels touch state when changing tools or mounting another market', () => {
    const chart = setup()
    chart.touch('pointerDown', 1, 200)
    chart.touch('pointerDown', 2, 462)
    chart.rerender(<PriceChart {...chart.props} tool="trend" />)
    const afterTool = chart.picture()
    chart.touch('pointerMove', 2, 600)
    expect(chart.picture()).toBe(afterTool)
    chart.rerender(<PriceChart key="other-market" {...chart.props} />)
    const other = chart.picture()
    chart.touch('pointerMove', 1, 400)
    expect(chart.picture()).toBe(other)
  })

  it.each([0, 1])('ignores gestures with only %s data points', (count) => {
    const chart = setup('hline', candles.slice(0, count))
    chart.touch('pointerDown', 1, 200)
    chart.touch('pointerDown', 2, 462)
    chart.touch('pointerMove', 2, 600)
    chart.touch('pointerUp', 2, 600)
    chart.touch('pointerUp', 1, 200)
    expect(chart.onDrawingsChange).not.toHaveBeenCalled()
  })

  it('retains wheel zoom, mouse pan and the reset button', () => {
    const chart = setup()
    const original = chart.picture()
    fireEvent.wheel(chart.hit(), { deltaY: -100, clientX: 331 })
    expect(chart.picture()).not.toBe(original)
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(chart.picture()).toBe(original)
    fireEvent.pointerDown(chart.hit(), { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 250, clientY: 100 })
    fireEvent.pointerMove(chart.hit(), { pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 100 })
    fireEvent.pointerUp(chart.hit(), { pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 100 })
    expect(chart.picture()).not.toBe(original)
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(chart.picture()).toBe(original)
  })
})

describe('PriceChart touch crosshair', () => {
  afterEach(() => { vi.useRealTimers() })
  const crossX = () => Number(document.querySelector('.mk-cross line')?.getAttribute('x1'))

  it('pans on a quick drag without showing the crosshair', () => {
    const chart = setup()
    const before = chart.picture()
    chart.touch('pointerDown', 1, 300)
    chart.touch('pointerMove', 1, 304)
    expect(chart.picture()).toBe(before)
    chart.touch('pointerMove', 1, 360)
    expect(chart.picture()).not.toBe(before)
    expect(document.querySelector('.mk-cross')).toBeNull()
    chart.touch('pointerUp', 1, 360)
    expect(document.querySelector('.mk-chart.is-panning')).toBeNull()
    expect(document.querySelector('.mk-cross')).toBeNull()
  })

  it('shows the crosshair after a hold, moves it without panning, keeps it after release and hides it on a tap', () => {
    vi.useFakeTimers()
    const chart = setup()
    const before = chart.picture()
    chart.touch('pointerDown', 1, 300, 120)
    expect(document.querySelector('.mk-cross')).toBeNull()
    act(() => { vi.advanceTimersByTime(300) })
    expect(document.querySelector('.mk-cross')).not.toBeNull()
    const first = crossX()
    chart.touch('pointerMove', 1, 200, 150)
    expect(crossX()).toBeLessThan(first)
    expect(chart.picture()).toBe(before)
    chart.touch('pointerUp', 1, 200, 150)
    fireEvent.pointerLeave(chart.hit(), { pointerId: 1, pointerType: 'touch' })
    expect(document.querySelector('.mk-cross')).not.toBeNull()

    // A second drag moves the shown crosshair instead of the chart.
    const kept = crossX()
    chart.touch('pointerDown', 2, 200, 150)
    chart.touch('pointerMove', 2, 280, 150)
    expect(crossX()).toBeGreaterThan(kept)
    expect(chart.picture()).toBe(before)
    chart.touch('pointerUp', 2, 280, 150)
    expect(document.querySelector('.mk-cross')).not.toBeNull()

    chart.touch('pointerDown', 3, 100)
    chart.touch('pointerUp', 3, 100)
    expect(document.querySelector('.mk-cross')).toBeNull()
  })

  it('does not show the crosshair when a second finger starts a pinch during the hold', () => {
    vi.useFakeTimers()
    const chart = setup()
    chart.touch('pointerDown', 1, 200)
    chart.touch('pointerDown', 2, 462)
    act(() => { vi.advanceTimersByTime(400) })
    expect(document.querySelector('.mk-cross')).toBeNull()
  })

  it('resets the view on a double tap', () => {
    const chart = setup()
    const original = chart.picture()
    fireEvent.wheel(chart.hit(), { deltaY: -100, clientX: 331 })
    expect(chart.picture()).not.toBe(original)
    expect(screen.getByRole('button', { name: 'Reset view' }).className).toContain('is-changed')
    chart.touch('pointerDown', 1, 300)
    chart.touch('pointerUp', 1, 300)
    chart.touch('pointerDown', 2, 302)
    chart.touch('pointerUp', 2, 302)
    expect(chart.picture()).toBe(original)
    expect(screen.getByRole('button', { name: 'Reset view' }).className).not.toContain('is-changed')
  })
})

describe('PriceChart time axis', () => {
  it('labels a day of 5 minute candles every few hours and names the new day', () => {
    const start = new Date(2026, 0, 1, 12).getTime()
    const day = Array.from({ length: 288 }, (_, i) => ({ t: start + i * 300_000, o: 100, h: 101, l: 99, c: 100, v: 1 }))
    const chart = setup('cursor', day)
    chart.unmount()
    render(<PriceChart {...chart.props} visible={288} />)
    const labels = Array.from(document.querySelectorAll('.mk-chart text.mk-axis-text[text-anchor="middle"]')).map((node) => node.textContent)
    expect(labels.length).toBeGreaterThanOrEqual(6)
    expect(labels).toContain('Jan 2')
    expect(labels.some((label) => /^\d\d:00/.test(label ?? ''))).toBe(true)
  })

  it('keeps the zoom buttons over the price axis and away from the current price', () => {
    setup()
    const zoom = document.querySelector<HTMLElement>('.mk-zoom')!
    expect(zoom.querySelectorAll('button')).toHaveLength(3)
    const top = Number.parseFloat(zoom.style.top)
    const price = document.querySelector('.mk-last .mk-badge rect')!
    const badgeTop = Number(price.getAttribute('y'))
    const height = Number.parseFloat(zoom.style.height)
    expect(badgeTop + 18 < top || badgeTop > top + height).toBe(true)
  })
})

describe('PriceChart editing drawings', () => {
  const trend = { id: 't1', kind: 'trend' as const, t1: candles[40].t, p1: 150, t2: candles[80].t, p2: 180 }
  const hline = { id: 'h1', kind: 'hline' as const, t1: candles[50].t, p1: 160, t2: candles[50].t, p2: 160 }
  function withDrawing(drawing: typeof trend | typeof hline) {
    const chart = setup()
    chart.rerender(<PriceChart {...chart.props} drawings={[drawing]} />)
    const ends = () => Array.from(document.querySelectorAll('.mk-drawing circle:not(.mk-handle), .mk-drawing circle.mk-handle')).map((node) => ({ x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')) }))
    const mouse = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) =>
      fireEvent[type](chart.hit(), { pointerId: 9, pointerType: 'mouse', button: 0, clientX: x, clientY: y })
    return { ...chart, ends, mouse }
  }

  it('moves a whole trend line with the mouse and keeps its slope', () => {
    const chart = withDrawing(trend)
    const [a, b] = chart.ends()
    const before = chart.picture()
    chart.mouse('pointerDown', (a.x + b.x) / 2, (a.y + b.y) / 2)
    chart.mouse('pointerMove', (a.x + b.x) / 2 + 40, (a.y + b.y) / 2 + 30)
    // The line follows live, the chart itself does not pan.
    expect(document.querySelector('.mk-drawing.is-dragged')).not.toBeNull()
    expect(chart.picture()).toBe(before)
    expect(chart.onDrawingsChange).not.toHaveBeenCalled()
    chart.mouse('pointerUp', (a.x + b.x) / 2 + 40, (a.y + b.y) / 2 + 30)
    expect(chart.onDrawingsChange).toHaveBeenCalledOnce()
    const [moved] = chart.onDrawingsChange.mock.calls[0][0]
    expect(moved.id).toBe('t1')
    expect(moved.t1).toBeGreaterThan(trend.t1)
    expect(moved.t2 - moved.t1).toBeCloseTo(trend.t2 - trend.t1, -3)
    expect(moved.p1).toBeLessThan(trend.p1)
    expect(moved.p2 - moved.p1).toBeCloseTo(trend.p2 - trend.p1, 6)
  })

  it('drags one end point by touch and leaves the other one where it is', () => {
    const chart = withDrawing(trend)
    const [, b] = chart.ends()
    chart.touch('pointerDown', 1, b.x + 6, b.y + 4)
    chart.touch('pointerMove', 1, b.x + 6, b.y - 40)
    chart.touch('pointerUp', 1, b.x + 6, b.y - 40)
    expect(chart.onDrawingsChange).toHaveBeenCalledOnce()
    const [moved] = chart.onDrawingsChange.mock.calls[0][0]
    expect(moved.t1).toBe(trend.t1)
    expect(moved.p1).toBe(trend.p1)
    expect(moved.p2).toBeGreaterThan(trend.p2)
    expect(moved.t2).toBe(trend.t2)
  })

  it('selects a line on a tap without changing it or the chart', () => {
    const chart = withDrawing(trend)
    const [a, b] = chart.ends()
    const before = chart.picture()
    chart.touch('pointerDown', 1, (a.x + b.x) / 2, (a.y + b.y) / 2 + 2)
    chart.touch('pointerUp', 1, (a.x + b.x) / 2, (a.y + b.y) / 2 + 2)
    expect(chart.onDrawingsChange).not.toHaveBeenCalled()
    expect(chart.picture()).toBe(before)
    expect(document.querySelector('.mk-drawing.is-selected')).not.toBeNull()
    expect(document.querySelectorAll('.mk-drawing circle.mk-handle')).toHaveLength(2)
  })

  it('moves a horizontal line up and down, and puts it back when a second finger starts a pinch', () => {
    const chart = withDrawing(hline)
    const y = Number(document.querySelector('.mk-drawing.is-hline line')!.getAttribute('y1'))
    chart.touch('pointerDown', 1, 200, y + 5)
    chart.touch('pointerMove', 1, 260, y + 50)
    chart.touch('pointerDown', 2, 500, 200)
    chart.touch('pointerUp', 1, 260, y + 50)
    chart.touch('pointerUp', 2, 500, 200)
    expect(chart.onDrawingsChange).not.toHaveBeenCalled()
    expect(Number(document.querySelector('.mk-drawing.is-hline line')!.getAttribute('y1'))).toBeCloseTo(y, 5)

    chart.touch('pointerDown', 3, 200, y - 4)
    chart.touch('pointerMove', 3, 120, y - 60)
    chart.touch('pointerUp', 3, 120, y - 60)
    expect(chart.onDrawingsChange).toHaveBeenCalledOnce()
    const [moved] = chart.onDrawingsChange.mock.calls[0][0]
    expect(moved.p1).toBeGreaterThan(hline.p1)
    expect(moved.p2).toBe(moved.p1)
  })
})

describe('PriceChart ruler', () => {
  it('measures straight up and down only, whatever the finger does sideways', () => {
    const chart = setup('measure')
    chart.touch('pointerDown', 1, 200, 100)
    chart.touch('pointerMove', 1, 330, 220)
    const [line] = Array.from(document.querySelectorAll('.mk-measure line'))
    expect(line.getAttribute('x1')).toBe(line.getAttribute('x2'))
    chart.touch('pointerUp', 1, 330, 220)
    const [kept] = Array.from(document.querySelectorAll('.mk-measure line'))
    expect(kept.getAttribute('x1')).toBe(kept.getAttribute('x2'))
    expect(Number(kept.getAttribute('y2'))).toBeGreaterThan(Number(kept.getAttribute('y1')) + 100)
    expect(document.querySelector('.mk-measure text')?.textContent).toMatch(/^−\d+\.\d\d% · −/)
    expect(chart.onDrawingsChange).not.toHaveBeenCalled()
  })
})

describe('PriceChart axis swipes', () => {
  const priceLabels = () => Array.from(document.querySelectorAll('text.mk-axis-text:not([text-anchor])')).map((node) => node.textContent)
  const axis = (which: 'x' | 'y') => document.querySelector(`.mk-hit-axis.is-${which}`)!
  const swipe = (which: 'x' | 'y', id: number, from: [number, number], to: [number, number]) => {
    fireEvent.pointerDown(axis(which), { pointerId: id, pointerType: 'touch', button: 0, clientX: from[0], clientY: from[1] })
    fireEvent.pointerMove(axis(which), { pointerId: id, pointerType: 'touch', clientX: to[0], clientY: to[1] })
    fireEvent.pointerUp(axis(which), { pointerId: id, pointerType: 'touch', clientX: to[0], clientY: to[1] })
  }
  const tap = (which: 'x' | 'y', id: number, at: [number, number]) => swipe(which, id, at, at)

  it('compresses and stretches the prices on the price axis; a double tap there makes them automatic again', () => {
    const chart = setup()
    const before = priceLabels()
    const picture = chart.picture()
    swipe('y', 1, [690, 120], [690, 220])
    const compressed = priceLabels()
    expect(compressed).not.toEqual(before)
    const span = (labels: Array<string | null>) => Number(labels.at(-1)?.replace(/,/g, '')) - Number(labels[0]?.replace(/,/g, ''))
    expect(Math.abs(span(compressed))).toBeGreaterThan(Math.abs(span(before)))
    expect(chart.picture()).not.toBe(picture)
    expect(screen.getByRole('button', { name: 'Reset view' }).className).toContain('is-changed')

    // With a hand-set price axis a drag also moves the chart up and down.
    const shifted = chart.picture()
    chart.touch('pointerDown', 2, 300, 100)
    chart.touch('pointerMove', 2, 300, 160)
    chart.touch('pointerUp', 2, 300, 160)
    expect(chart.picture()).not.toBe(shifted)

    tap('y', 3, [690, 150])
    tap('y', 4, [690, 151])
    expect(priceLabels()).toEqual(before)
    expect(chart.picture()).toBe(picture)
  })

  it('shows wider or more candles on the time axis and keeps the newest candle at the right edge', () => {
    const chart = setup()
    const before = chart.width()
    const lastX = () => Number(chart.rects().at(-1)?.getAttribute('x')) + chart.width() / 2
    const right = 720 - 62
    swipe('x', 1, [300, 330], [380, 330])
    expect(chart.width()).toBeGreaterThan(before)
    // Still the two empty candle places of margin on the right, now just wider ones.
    const step = (right - lastX()) / 2.5
    expect(step).toBeGreaterThan(before)
    expect(chart.width()).toBeCloseTo(Math.min(18, step * 0.68), 5)
    swipe('x', 2, [380, 330], [200, 330])
    expect(chart.width()).toBeLessThan(before)
    tap('x', 3, [300, 330])
    tap('x', 4, [301, 330])
    expect(chart.width()).toBeCloseTo(before, 5)
  })
})
