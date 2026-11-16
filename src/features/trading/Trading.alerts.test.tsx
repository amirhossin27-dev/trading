import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Trading } from './Trading'
import { AlertClient } from './alertService'
import { assetById } from './marketAssets'
import { storageKey } from './marketPrefs'

afterEach(() => { cleanup(); localStorage.clear(); delete window.APP_CONFIG; vi.unstubAllGlobals(); history.replaceState(null, '', location.pathname) })

async function openAlarmChart(prefs: object) {
  const base = 'https://test.supabase.co/functions/v1/trading-alerts'
  const id = 'ef218492-b23e-4c59-913a-f4ab522fa6b9'
  const event = { id, alarmId: id, asset: assetById('btc'), target: 110, currency: 'USD', observedPrice: 111, triggeredAt: '2026-11-16T12:00:00Z', acknowledgedAt: null }
  window.APP_CONFIG = { alertServiceUrl: base }
  localStorage.setItem(storageKey, JSON.stringify(prefs))
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    const url = String(input)
    if (url.endsWith('/register')) return Response.json({ deviceId: id, deviceToken: 'a'.repeat(43) })
    if (url.endsWith('/config')) return Response.json({ configured: true, vapidPublicKey: null, lastCheckedAt: new Date().toISOString(), checkIntervalSeconds: 60 })
    if (url.endsWith('/alarms')) return Response.json({ alarms: [], subscriptionActive: true })
    if (url.endsWith('/events')) return Response.json({ events: [event] })
    if (url.includes('/ticker/24hr')) return Response.json([])
    return Response.json(Array.from({ length: 336 }, (_, i) => [Date.UTC(2026, 0, 1) + i * 1_800_000, '100', '112', '99', '111', '10']))
  }))
  await new AlertClient(base).register()
  render(<Trading language="de" />)
  await waitFor(() => expect(document.querySelector('.mk-line')).toBeTruthy())
  fireEvent.click(await screen.findByRole('button', { name: 'Alarme, 1 unbestätigte Meldung' }))
  fireEvent.click(await screen.findByRole('button', { name: 'BTC bei 110 USD im Chart öffnen' }))
  await waitFor(() => expect(document.querySelector('.mk-candle')).toBeTruthy())
}

it('opens the alarm market as weekly candles with the target, preserving the saved view until the user changes it', async () => {
  await openAlarmChart({ tabs: ['hbar', 'btc'], active: 'hbar', kind: 'line', range: '1Y', timeframe: 'auto', views: { btc: { kind: 'line', range: '1M', timeframe: 'auto' } } })
  expect(screen.getByRole('button', { name: '1W' }).getAttribute('aria-pressed')).toBe('true')
  expect(document.querySelector('.mk-alarm-target')?.textContent).toContain('110')
  expect(JSON.parse(localStorage.getItem(storageKey)!).views.btc.range).toBe('1M')
  fireEvent.click(screen.getByRole('button', { name: '1J' }))
  await waitFor(() => expect(JSON.parse(localStorage.getItem(storageKey)!).views.btc).toEqual({ kind: 'candles', range: '1Y', timeframe: 'auto' }))
})

it('can show an alert with a full saved list without overwriting another market preference', async () => {
  const ids = Array.from({ length: 4999 }, (_, index) => `yf:TEST${index}`)
  const extras = Object.fromEntries(ids.map((id) => [id, { symbol: id.slice(3), name: id.slice(3), group: 'stock' }]))
  await openAlarmChart({ tabs: ['hbar', ...ids], extras, active: 'hbar', kind: 'line', range: '1Y', timeframe: 'auto' })
  const before = JSON.parse(localStorage.getItem(storageKey)!)
  fireEvent.click(screen.getByRole('button', { name: '1M' }))
  await waitFor(() => expect(document.querySelector('.mk-candle')).toBeTruthy())
  expect(screen.getByRole('button', { name: '1M' }).getAttribute('aria-pressed')).toBe('true')
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(before)
})
