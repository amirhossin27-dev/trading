import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TradingTile } from './TradingTile'
import { defaultPrefs, writePrefs } from '../trading/marketPrefs'

const api = vi.hoisted(() => ({ loadQuotes: vi.fn() }))
vi.mock('../trading/marketData', async (original) => ({ ...await original<object>(), ...api }))

beforeEach(() => {
  window.localStorage.clear()
  api.loadQuotes.mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('TradingTile', () => {
  it('shows the first six crypto and stock entries in watchlist order, including custom stocks and full prices', async () => {
    writePrefs({
      ...defaultPrefs(),
      lists: [{ id: 'main', name: '', color: null, entries: ['yf:^GDAXI', 'btc', 'yf:CUSTOM', 'eth', { id: 's1', name: 'More' }, 'yf:AAPL', 'hbar', 'sol', 'xrp'] }],
      active: 'sol',
      extras: { 'yf:CUSTOM': { symbol: 'CUSTOM', name: 'Custom stock', group: 'stock' } },
    })
    api.loadQuotes.mockResolvedValue({
      btc: { price: 123456.78, changePct: 12.34, currency: 'USD' },
      'yf:CUSTOM': { price: 1234567.89, changePct: -2.5, currency: 'EUR' },
      hbar: { price: 0.00001234, changePct: 0, currency: 'USD' },
      sol: { price: 150.12, changePct: 3.45, currency: 'USD' },
    })
    const onOpen = vi.fn()
    render(<TradingTile language="de" onOpen={onOpen} />)

    await screen.findByText('123.456,78 $')
    const rows = within(screen.getByRole('list', { name: 'Top 6 deiner Watchlist' })).getAllByRole('listitem')
    expect(rows.map((row) => row.querySelector('.start-trade-symbol')?.textContent)).toEqual(['BTC', 'CUSTOM', 'ETH', 'AAPL', 'HBAR', 'SOL'])
    expect(within(rows[1]).getByText('1.234.567,89 €')).toBeTruthy()
    expect(rows[1].textContent).toContain('-2,50')
    expect(within(rows[4]).getByText('0,00001234 $')).toBeTruthy()
    expect(within(rows[5]).getByText('150,12 $')).toBeTruthy()
    expect(api.loadQuotes.mock.calls[0][0].map((asset: { id: string }) => asset.id)).toEqual(['btc', 'yf:CUSTOM', 'eth', 'yf:AAPL', 'hbar', 'sol'])
    fireEvent.click(screen.getByRole('button', { name: 'Trading-Modul öffnen' }))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('keeps fewer than six entries and preserves quotes on a failed refresh, then clears its timer on unmount', async () => {
    vi.useFakeTimers()
    api.loadQuotes.mockResolvedValueOnce({ hbar: { price: 0.1234, changePct: 1 } }).mockRejectedValue(new Error('offline'))
    const { unmount } = render(<TradingTile language="en" onOpen={() => undefined} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('$0.1234')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(api.loadQuotes).toHaveBeenCalledTimes(2)
    expect(screen.getByText('$0.1234')).toBeTruthy()
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(api.loadQuotes).toHaveBeenCalledTimes(2)
  })

  it('explains how to populate the widget when the watchlist only contains other market types', () => {
    writePrefs({ ...defaultPrefs(), lists: [{ id: 'main', name: '', color: null, entries: ['yf:^GDAXI'] }], active: 'yf:^GDAXI' })
    render(<TradingTile language="de" onOpen={() => undefined} />)
    expect(screen.getByText('Füge im Trading-Modul Kryptos oder Aktien hinzu.')).toBeTruthy()
    expect(api.loadQuotes).not.toHaveBeenCalled()
  })
})
