import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Keep the real app and its children; replace only network-backed market loading.
vi.mock('./features/trading/marketData', async (original) => ({
  ...await original<object>(),
  loadSeries: vi.fn().mockResolvedValue({ candles: [], source: 'Test', currency: 'USD' }),
  loadQuotes: vi.fn().mockResolvedValue({}),
}))

beforeEach(() => {
  vi.resetModules()
  window.history.replaceState(null, '', '/')
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
  delete document.documentElement.dataset.theme
})

async function openApp({ standalone = false, iosStandalone = false, href = '/' } = {}) {
  window.history.replaceState(null, '', href)
  const media = new EventTarget()
  vi.stubGlobal('matchMedia', vi.fn((query: string) => Object.assign(media, {
    matches: standalone && query === '(display-mode: standalone)',
    media: query,
    onchange: null,
  })))
  vi.spyOn(window.navigator as Navigator & { standalone: boolean }, 'standalone', 'get').mockReturnValue(iosStandalone)
  const { App } = await import('./App')
  await act(async () => { render(<App />) })
}

describe('App header', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, get: () => false })
  })

  it('offers installation help in the browser and closes it again', async () => {
    await openApp()
    fireEvent.click(screen.getByRole('button', { name: 'Aufs iPhone' }))
    expect(screen.getByText('Als eigene App öffnen')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Verstanden' }))
    expect(screen.queryByText('Als eigene App öffnen')).toBeNull()
  })

  it('hides installation in standalone display mode while keeping language and appearance controls', async () => {
    await openApp({ standalone: true })
    expect(screen.queryByRole('button', { name: 'Aufs iPhone' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sprache wechseln' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Darstellung wechseln' })).toBeTruthy()
  })

  it('also detects an iPhone Home Screen launch through navigator.standalone', async () => {
    await openApp({ iosStandalone: true })
    expect(screen.queryByRole('button', { name: 'Aufs iPhone' })).toBeNull()
  })

  it('keeps language and appearance settings usable and persistent in the installed app', async () => {
    await openApp({ iosStandalone: true })
    fireEvent.click(screen.getByRole('button', { name: 'Sprache wechseln' }))
    expect(document.documentElement.lang).toBe('en')
    expect(window.localStorage.getItem('trading.language')).toBe('en')
    fireEvent.click(screen.getByRole('button', { name: 'Change appearance' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('trading.theme')).toBe('dark')
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })

  it.each(['?embed=1', '?embed=1&view=compact'])('keeps the header out of dashboard mode %s', async (query) => {
    await openApp({ href: '/' + query })
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Aufs iPhone' })).toBeNull()
  })
})
