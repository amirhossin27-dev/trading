import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Trading } from './Trading'
import { storageKey } from './marketPrefs'

const day = 86_400_000
const start = Date.UTC(2026, 8, 1)

function klines(limit: number, step: number) {
  return Array.from({ length: limit }, (_, index) => {
    const price = 0.1 + Math.sin(index / 9) * 0.01 + index * 0.0001
    return [start + index * step, String(price), String(price + 0.002), String(price - 0.002), String(price + 0.0005), '1000', start + (index + 1) * step - 1, '100']
  })
}

const dayChange: Record<string, string> = { HBARUSDT: '-1.25', BTCUSDT: '3.40' }

// Stocks come from the platform API: the same candles for every symbol, one session of 5-minute candles.
const stockCandles = Array.from({ length: 100 }, (_, index) => {
  const price = 90 + Math.sin(index / 8)
  return { t: Date.UTC(2026, 9, 6, 8) + index * 300_000, o: price, h: price + 0.4, l: price - 0.4, c: price + 0.1, v: 500 }
})

async function defaultFetch(input: string | URL | Request) {
  const url = String(input)
  if (url.includes('/api/trading/search')) {
    return Response.json([{ symbol: 'NESN.SW', name: 'Nestlé S.A.', exchange: 'Swiss', type: 'EQUITY' }])
  }
  if (url.includes('/api/trading/quotes')) {
    return Response.json([{ symbol: 'NESN.SW', name: 'Nestlé S.A.', currency: 'CHF', price: 91.2, changePct: 0.8, marketOpen: false }])
  }
  if (url.includes('/api/trading/candles')) {
    return Response.json({ symbol: 'NESN.SW', name: 'Nestlé S.A.', currency: 'CHF', candles: stockCandles })
  }
  if (url.includes('/ticker/24hr')) {
    const symbols = JSON.parse(decodeURIComponent(new URL(url).searchParams.get('symbols') ?? '[]')) as string[]
    return Response.json(symbols.map((symbol) => ({ symbol, lastPrice: symbol === 'BTCUSDT' ? '84000.5' : '0.1234', priceChangePercent: dayChange[symbol] ?? '0.5' })))
  }
  if (url.includes('/klines')) {
    const interval = new URL(url).searchParams.get('interval') ?? '1d'
    const steps: Record<string, number> = { '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '1d': day, '1w': 7 * day, '1M': 30 * day }
    return Response.json(klines(Number(new URL(url).searchParams.get('limit')), steps[interval]))
  }
  return new Response('not found', { status: 404 })
}

const fetchMock = vi.fn(defaultFetch)

function storedPrefs() {
  return JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') as Record<string, unknown>
}

beforeEach(() => {
  // Tests of the existing line interactions opt into the saved line view.
  window.localStorage.setItem(storageKey, JSON.stringify({ kind: 'line' }))
  fetchMock.mockImplementation(defaultFetch)
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockClear()
  window.localStorage.clear()
})

describe('Trading', () => {
  it('offers history periods for candles in the full embed and restores automatic candle length when selected', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ kind: 'candles', range: '1D', timeframe: 'D' }))
    render(<Trading language="en" embedded />)
    fireEvent.click(screen.getByRole('button', { name: '1Y' }))
    await waitFor(() => expect(storedPrefs()).toMatchObject({ kind: 'candles', range: '1Y', timeframe: 'auto' }))
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('interval=1d&limit=365'))).toBe(true)
  })

  it('opens the standalone watchlist as a modal, keeps the chart mounted and restores focus on Escape', async () => {
    window.localStorage.setItem(storageKey, JSON.stringify({ kind: 'line', range: '1D', timeframe: 'D' }))
    const user = userEvent.setup()
    render(<Trading language="en" />)
    await waitFor(() => expect(document.querySelector('.mk-line')).toBeTruthy())
    const chart = document.querySelector('.mk-chart')
    expect(screen.getByRole('button', { name: '1D' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('tablist', { name: 'Markets' })).toBeNull()
    const opener = screen.getByRole('button', { name: /Open my markets/ })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'My markets' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close markets' }))
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(document.activeElement).toBe(within(dialog).getByRole('tab', { name: /Hedera/ }))
    await user.tab()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close markets' }))
    expect(document.querySelector('.mk-chart')).toBe(chart)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'My markets' })).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(document.querySelector('.mk-chart')).toBe(chart)
  })

  it('closes the standalone watchlist after choosing a market and on the backdrop', async () => {
    window.localStorage.setItem(storageKey, JSON.stringify({ tabs: ['hbar', 'btc'], active: 'hbar', kind: 'line' }))
    const user = userEvent.setup()
    render(<Trading language="en" />)
    await user.click(screen.getByRole('button', { name: /Open my markets/ }))
    await user.click(screen.getByRole('tab', { name: /Bitcoin/ }))
    expect(screen.queryByRole('dialog', { name: 'My markets' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Bitcoin · BTC' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Open my markets/ }))
    fireEvent.click(document.querySelector('.mk-watch-overlay.is-open .mk-watch-backdrop')!)
    expect(screen.queryByRole('dialog', { name: 'My markets' })).toBeNull()
  })

  it('offers every range with candles and keeps drawing tools on demand in standalone mode', async () => {
    window.localStorage.removeItem(storageKey)
    const user = userEvent.setup()
    render(<Trading language="de" />)
    const ranges = within(screen.getByRole('group', { name: 'Zeitraum' })).getAllByRole('button')
    expect(ranges.map((button) => button.textContent)).toEqual(['1T', '1W', '1M', '3M', '1J', 'Max'])
    await waitFor(() => expect(document.querySelector('.mk-candle')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Trendlinie' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Werkzeuge' }))
    expect(screen.getByRole('button', { name: 'Trendlinie' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Trendlinie' }))
    expect(screen.queryByRole('button', { name: 'Trendlinie' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Anfang und Ende')
  })

  it('returns to the chart after adding a market from the standalone picker', async () => {
    const user = userEvent.setup()
    render(<Trading language="en" />)
    await user.click(screen.getByRole('button', { name: /Open my markets/ }))
    await user.click(screen.getByRole('button', { name: 'Add market' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search markets' }), 'bitcoin')
    await user.click(screen.getByRole('button', { name: /BTC\s+Bitcoin$/ }))
    expect(screen.queryByRole('dialog', { name: 'My markets' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Bitcoin · BTC' })).toBeTruthy()
  })

  it('filters and pages a large watchlist while loading quotes only for the active and visible markets', async () => {
    const extras = Object.fromEntries(Array.from({ length: 45 }, (_, index) => [`yf:TEST${index}`, { symbol: `TEST${index}`, name: `Test market ${index}`, group: 'stock' }]))
    window.localStorage.setItem(storageKey, JSON.stringify({ tabs: ['hbar', ...Object.keys(extras)], active: 'hbar', extras, kind: 'line' }))
    const user = userEvent.setup()
    render(<Trading language="en" />)
    await waitFor(() => expect(document.querySelector('.mk-line')).toBeTruthy())
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/trading/quotes'))).toBe(false)
    await user.click(screen.getByRole('button', { name: /Open my markets/ }))
    expect(screen.getAllByRole('tab')).toHaveLength(20)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('TEST18'))).toBe(true))
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('TEST19'))).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getAllByRole('tab')).toHaveLength(20)
    expect(screen.getByRole('tab', { name: /Test market 19 \(TEST19\)/ })).toBeTruthy()
    await user.type(screen.getByRole('searchbox', { name: 'Filter my markets' }), 'Test market 44')
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: /Test market 44/ })).toBeTruthy()
    const quoteCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/trading/quotes'))
    expect(quoteCalls.every(([url]) => (new URL(String(url), 'http://localhost').searchParams.get('symbols') ?? '').split(',').length <= 20)).toBe(true)
  })

  it('shows HBAR with its day change in the tab and a chart', async () => {
    render(<Trading language="en" embedded />)

    expect(await screen.findByRole('tab', { name: /Hedera \(HBAR\).*1\.25%/ })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Hedera · HBAR' })).toBeTruthy()
    await waitFor(() => expect(document.querySelector('.mk-line')).toBeTruthy())
  })

  it('lists the markets one below the other with price, price change and change in %', async () => {
    const user = userEvent.setup()
    render(<Trading language="en" embedded />)
    await user.click(await screen.findByRole('button', { name: 'Add market' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search markets' }), 'bitcoin')
    await user.click(screen.getByRole('button', { name: /BTC\s+Bitcoin$/ }))

    const hedera = await screen.findByRole('tab', { name: /Hedera \(HBAR\)/ })
    const bitcoin = await screen.findByRole('tab', { name: /Bitcoin \(BTC\).*3\.40%/ })
    expect(hedera.closest('[role="tablist"]')?.getAttribute('aria-orientation')).toBe('vertical')
    expect(bitcoin.closest('[role="tablist"]')).toBe(hedera.closest('[role="tablist"]'))
    // price, price change (follows from the price and the percentage) and change in %
    await waitFor(() => expect(hedera.textContent).toMatch(/0\.1234.*[−-]0\.0016.*1\.25%/))
    expect(bitcoin.textContent).toMatch(/84,000\.50\+2,762\.11.*3\.40%/)
  })

  it('saves the chosen chart type and time unit and restores them after a reload', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Trading language="en" embedded />)
    await waitFor(() => expect(document.querySelector('.mk-line')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: '1W' }))
    expect(storedPrefs()).toMatchObject({ kind: 'line', range: '1W' })

    await user.click(screen.getByRole('button', { name: 'Candles' }))
    await user.click(screen.getByRole('button', { name: '4h' }))
    expect(storedPrefs()).toMatchObject({ kind: 'candles', range: '1W', timeframe: '4h' })
    await waitFor(() => expect(document.querySelectorAll('.mk-candle').length).toBeGreaterThan(50))

    unmount()
    render(<Trading language="en" embedded />)
    expect(screen.getByRole('button', { name: 'Candles' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '4h' }).getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(document.querySelectorAll('.mk-candle').length).toBeGreaterThan(50))
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('interval=4h'))).toBe(true)
  })

  it('offers 45 minute, 4 hour, day, week and month candles', async () => {
    const user = userEvent.setup()
    render(<Trading language="de" embedded />)
    await user.click(screen.getByRole('button', { name: 'Kerzen' }))

    const units = within(screen.getByRole('group', { name: 'Kerzen' })).getAllByRole('button')
    expect(units.map((button) => button.textContent)).toEqual(['Auto', '45m', '4h', 'T', 'W', 'M'])
    await user.click(screen.getByRole('button', { name: '45m' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('interval=15m'))).toBe(true))
    await waitFor(() => expect(document.querySelectorAll('.mk-candle').length).toBe(110))
  })

  it('adds a market with the + button, shows its day change and removes it again', async () => {
    const user = userEvent.setup()
    render(<Trading language="en" embedded />)
    await screen.findByRole('tab', { name: /HBAR/ })

    await user.click(screen.getByRole('button', { name: 'Add market' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search markets' }), 'bitcoin')
    await user.click(screen.getByRole('button', { name: /BTC\s+Bitcoin$/ }))

    const bitcoin = await screen.findByRole('tab', { name: /Bitcoin \(BTC\).*3\.40%/ })
    expect(bitcoin.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { level: 2, name: 'Bitcoin · BTC' })).toBeTruthy()
    expect(storedPrefs()).toMatchObject({ tabs: ['hbar', 'btc'], active: 'btc' })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('klines?symbol=BTCUSDT'))).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Remove BTC' }))
    expect(screen.queryByRole('tab', { name: /Bitcoin/ })).toBeNull()
    expect(screen.getByRole('tab', { name: /Hedera/ }).getAttribute('aria-selected')).toBe('true')
    // the last tab cannot be closed
    expect(screen.queryByRole('button', { name: 'Remove HBAR' })).toBeNull()
  })

  it('adds a stock found with the search, shows its currency and market state, and keeps it after a reload', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Trading language="en" embedded />)
    await screen.findByRole('tab', { name: /HBAR/ })

    await user.click(screen.getByRole('button', { name: 'Add market' }))
    // quick picks need no search ...
    expect(screen.getByRole('button', { name: /AAPL\s+Apple/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /DAX\s+DAX/ })).toBeTruthy()
    // ... everything else is found through the platform API
    await user.type(screen.getByRole('searchbox', { name: 'Search markets' }), 'nestle')
    await user.click(await screen.findByRole('button', { name: /NESN\.SW\s+Nestlé S\.A\.\s*Swiss/ }))

    const tab = await screen.findByRole('tab', { name: /Nestlé S\.A\. \(NESN\.SW\).*0\.80%/ })
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText(/CHF\s?91\.20/)).toBeTruthy()
    expect(screen.getByText(/Market closed/)).toBeTruthy()
    // A newly added market starts with candles; this test explicitly exercises its saved line view.
    await user.click(screen.getByRole('button', { name: 'Line' }))
    await waitFor(() => expect(document.querySelector('.mk-line')).toBeTruthy())
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/trading/candles?symbol=NESN.SW&interval=5m&days=7'))).toBe(true)
    expect(storedPrefs()).toMatchObject({ tabs: ['hbar', 'yf:NESN.SW'], active: 'yf:NESN.SW', extras: { 'yf:NESN.SW': { symbol: 'NESN.SW', name: 'Nestlé S.A.' } } })

    unmount()
    render(<Trading language="en" embedded />)
    expect(await screen.findByRole('tab', { name: /NESN\.SW/ })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Nestlé S.A. · NESN.SW' })).toBeTruthy()
  })

  it('loads a market found with the search once, not again and again (rate limit of the API)', async () => {
    window.localStorage.setItem(storageKey, JSON.stringify({
      tabs: ['hbar', 'yf:NESN.SW'],
      extras: { 'yf:NESN.SW': { symbol: 'NESN.SW', name: 'Nestlé S.A.', group: 'stock' } },
      active: 'yf:NESN.SW',
      kind: 'line',
      range: '1D',
      timeframe: 'D',
      indicators: [],
      drawings: {},
    }))
    render(<Trading language="en" embedded />)
    await waitFor(() => expect(document.querySelector('.mk-line')).toBeTruthy())

    // give a possible loop time to show itself
    await new Promise((resolve) => setTimeout(resolve, 600))

    const candleCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/trading/candles'))
    const quoteCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/trading/quotes'))
    expect(candleCalls).toHaveLength(1)
    expect(quoteCalls.length).toBeLessThanOrEqual(2)
  })

  it('adds a quick-pick stock without a search and reads its candles from the API', async () => {
    const user = userEvent.setup()
    render(<Trading language="de" embedded />)
    await screen.findByRole('tab', { name: /HBAR/ })

    await user.click(screen.getByRole('button', { name: 'Kurs hinzufügen' }))
    await user.click(screen.getByRole('button', { name: 'Aktien' }))
    await user.click(screen.getByRole('button', { name: /SIE\.DE\s+Siemens/ }))

    expect(await screen.findByRole('tab', { name: /Siemens \(SIE\.DE\)/ })).toBeTruthy()
    expect(storedPrefs()).toMatchObject({ tabs: ['hbar', 'yf:SIE.DE'], extras: {} })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/trading/candles?symbol=SIE.DE'))).toBe(true)
  })

  it('switches indicators on and keeps them', async () => {
    const user = userEvent.setup()
    render(<Trading language="en" embedded />)
    await waitFor(() => expect(document.querySelector('.mk-line')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: 'Indicators' }))
    await user.click(screen.getByRole('checkbox', { name: 'SMA 20' }))
    await user.click(screen.getByRole('checkbox', { name: 'RSI (14)' }))

    expect(storedPrefs()).toMatchObject({ indicators: ['sma20', 'rsi'] })
    await waitFor(() => expect(document.querySelectorAll('.mk-overlay').length).toBeGreaterThanOrEqual(2))
  })

  it('draws a horizontal line with the tool and removes it again', async () => {
    const user = userEvent.setup()
    render(<Trading language="en" embedded />)
    await waitFor(() => expect(document.querySelector('.mk-line')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: 'Horizontal line' }))
    expect(screen.getByRole('status').textContent).toMatch(/price level/)
    const hit = document.querySelector('.mk-hit') as SVGRectElement
    await user.pointer({ keys: '[MouseLeft]', target: hit, coords: { clientX: 200, clientY: 120 } })

    await waitFor(() => expect(document.querySelectorAll('.mk-drawing.is-hline').length).toBe(1))
    expect((storedPrefs().drawings as Record<string, unknown[]>).hbar).toHaveLength(1)

    await user.click(await screen.findByRole('button', { name: 'Remove drawing' }))
    expect(document.querySelectorAll('.mk-drawing').length).toBe(0)
    expect(screen.getByRole('button', { name: 'Delete all drawings' }).hasAttribute('disabled')).toBe(true)
  })

  it('says so and offers a retry when no price can be loaded', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async () => new Response('down', { status: 503 }))
    render(<Trading language="en" embedded />)

    expect(await screen.findByText('The price could not be loaded.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(4))
  })

  describe('reordering the watchlist', () => {
    function storeTabs(tabs: string[]) {
      window.localStorage.setItem(storageKey, JSON.stringify({ tabs, extras: {}, active: tabs[0], kind: 'line', range: '1D', timeframe: 'D', indicators: [], drawings: {} }))
    }

    const order = () => screen.getAllByRole('tab').map((tab) => tab.getAttribute('data-market'))
    const rowOf = (market: string) => screen.getAllByRole('tab').find((tab) => tab.getAttribute('data-market') === market)?.closest('.mk-row') as HTMLElement

    /** Drags the row of one market onto the upper or lower half of another one, as the browser reports it. */
    function drag(from: string, to: string, half: 'upper' | 'lower') {
      const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
      const target = rowOf(to)
      target.getBoundingClientRect = () => ({ top: 100, bottom: 140, left: 0, right: 300, width: 300, height: 40, x: 0, y: 100, toJSON: () => ({}) })
      fireEvent.dragStart(rowOf(from), { dataTransfer })
      const over = createEvent.dragOver(target, { dataTransfer })
      Object.defineProperty(over, 'clientY', { value: half === 'lower' ? 132 : 108 })
      fireEvent(target, over)
      fireEvent.drop(target, { dataTransfer })
      fireEvent.dragEnd(rowOf(from), { dataTransfer })
    }

    it('changes the order by dragging a row onto another one, in both directions, and remembers it', async () => {
      storeTabs(['hbar', 'btc', 'eth'])
      render(<Trading language="en" embedded />)
      await screen.findByRole('tab', { name: /Bitcoin/ })
      expect(order()).toEqual(['hbar', 'btc', 'eth'])
      expect(rowOf('hbar').getAttribute('draggable')).toBe('true')

      drag('hbar', 'eth', 'lower')
      expect(order()).toEqual(['btc', 'eth', 'hbar'])
      expect(storedPrefs().tabs).toEqual(['btc', 'eth', 'hbar'])
      expect(storedPrefs().active).toBe('hbar')

      drag('eth', 'btc', 'upper')
      expect(order()).toEqual(['eth', 'btc', 'hbar'])
      expect(storedPrefs().tabs).toEqual(['eth', 'btc', 'hbar'])

      // dropped on its own place or onto the row right behind it: nothing changes
      drag('eth', 'btc', 'upper')
      expect(order()).toEqual(['eth', 'btc', 'hbar'])
      expect(rowOf('eth').className).not.toContain('is-dragging')

      // after a reload the order is the same
      cleanup()
      render(<Trading language="en" embedded />)
      await screen.findByRole('tab', { name: /Bitcoin/ })
      expect(order()).toEqual(['eth', 'btc', 'hbar'])
    })

    it('shows where the row lands while it is dragged', async () => {
      storeTabs(['hbar', 'btc', 'eth'])
      render(<Trading language="en" embedded />)
      await screen.findByRole('tab', { name: /Bitcoin/ })

      const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
      fireEvent.dragStart(rowOf('hbar'), { dataTransfer })
      expect(rowOf('hbar').className).toContain('is-dragging')
      const target = rowOf('btc')
      target.getBoundingClientRect = () => ({ top: 100, bottom: 140, left: 0, right: 300, width: 300, height: 40, x: 0, y: 100, toJSON: () => ({}) })
      const over = createEvent.dragOver(target, { dataTransfer })
      Object.defineProperty(over, 'clientY', { value: 135 })
      fireEvent(target, over)
      expect(target.className).toContain('drop-after')
      fireEvent.dragEnd(rowOf('hbar'), { dataTransfer })
      expect(target.className).not.toContain('drop-after')
      expect(rowOf('hbar').className).not.toContain('is-dragging')
    })

    it('moves the focused row with Alt and the arrow keys and announces the new place', async () => {
      storeTabs(['hbar', 'btc', 'eth'])
      render(<Trading language="en" embedded />)
      const bitcoin = await screen.findByRole('tab', { name: /Bitcoin/ })

      bitcoin.focus()
      fireEvent.keyDown(bitcoin, { key: 'ArrowUp', altKey: true })
      expect(order()).toEqual(['btc', 'hbar', 'eth'])
      expect(screen.getByText('Bitcoin is now at position 1 of 3')).toBeTruthy()
      await waitFor(() => expect(document.activeElement?.getAttribute('data-market')).toBe('btc'))
      expect(storedPrefs().tabs).toEqual(['btc', 'hbar', 'eth'])

      // already at the top; without Alt the arrow keys do nothing
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp', altKey: true })
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
      expect(order()).toEqual(['btc', 'hbar', 'eth'])

      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown', altKey: true })
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight', altKey: true })
      expect(order()).toEqual(['hbar', 'eth', 'btc'])
    })

    it('does not ask for prices again when the order changes, and a single market cannot be dragged', async () => {
      storeTabs(['hbar', 'btc', 'eth'])
      render(<Trading language="en" embedded />)
      await screen.findByRole('tab', { name: /Bitcoin/ })
      await waitFor(() => expect(document.querySelector('.mk-line')).toBeTruthy())
      await new Promise((resolve) => setTimeout(resolve, 100))

      const before = fetchMock.mock.calls.length
      drag('hbar', 'eth', 'lower')
      drag('btc', 'eth', 'lower')
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(fetchMock.mock.calls.length).toBe(before)

      cleanup()
      storeTabs(['hbar'])
      render(<Trading language="en" embedded />)
      await screen.findByRole('tab', { name: /Hedera/ })
      expect(rowOf('hbar').getAttribute('draggable')).toBe('false')
      expect(screen.getByRole('tab', { name: /Hedera/ }).hasAttribute('aria-keyshortcuts')).toBe(false)
    })
  })
})
