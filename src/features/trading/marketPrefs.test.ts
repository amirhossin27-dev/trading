import { afterEach, describe, expect, it } from 'vitest'
import { defaultPrefs, readPrefs, sanitizePrefs, storageKey, writePrefs, updateMarketPrefs } from './marketPrefs'

afterEach(() => window.localStorage.clear())

describe('market preferences', () => {
  it('starts with HBAR and candles for one day at an automatic interval', () => {
    expect(readPrefs()).toEqual(defaultPrefs())
    expect(defaultPrefs()).toMatchObject({ tabs: ['hbar'], active: 'hbar', kind: 'candles', range: '1D', timeframe: 'auto' })
  })

  it('keeps the chosen time unit, tabs and drawings after a reload', () => {
    const prefs = {
      ...defaultPrefs(),
      tabs: ['hbar', 'btc'],
      active: 'btc',
      kind: 'candles' as const,
      range: '3M' as const,
      timeframe: '4h' as const,
      indicators: ['sma20' as const, 'rsi' as const],
      drawings: { btc: [{ id: 'a', kind: 'trend' as const, t1: 1, p1: 2, t2: 3, p2: 4 }] },
    }
    writePrefs(prefs)
    expect(readPrefs()).toMatchObject(prefs)
  })

  it('drops unknown tabs, values and broken drawings instead of failing', () => {
    const result = sanitizePrefs({
      tabs: ['btc', 'btc', 'doesnotexist', 42],
      active: 'eth',
      kind: 'pie',
      range: '5Y',
      timeframe: '3h',
      indicators: ['rsi', 'macd', 'sma20'],
      drawings: {
        btc: [{ id: 'ok', kind: 'hline', t1: 1, p1: 2, t2: 1, p2: 2 }, { id: 'bad', kind: 'hline', t1: 'x' }, null],
        nope: [{ id: 'x', kind: 'trend', t1: 1, p1: 2, t2: 3, p2: 4 }],
      },
    })
    expect(result.tabs).toEqual(['btc'])
    expect(result.active).toBe('btc')
    expect(result.kind).toBe('candles')
    expect(result.range).toBe('1D')
    expect(result.timeframe).toBe('auto')
    expect(result.indicators).toEqual(['sma20', 'rsi'])
    expect(Object.keys(result.drawings)).toEqual(['btc'])
    expect(result.drawings.btc).toHaveLength(1)
  })

  it('survives garbage in the storage', () => {
    window.localStorage.setItem(storageKey, '{not json')
    expect(readPrefs()).toEqual(defaultPrefs())
    window.localStorage.setItem(storageKey, '"text"')
    expect(readPrefs()).toEqual(defaultPrefs())
  })

  it('restores the chosen view for each market after switching and reloading', () => {
    let prefs = { ...defaultPrefs(), tabs: ['hbar', 'btc'] }
    prefs = updateMarketPrefs(prefs, { range: '1Y' })
    prefs = updateMarketPrefs(prefs, { active: 'btc' })
    expect(prefs).toMatchObject({ active: 'btc', kind: 'candles', range: '1D', timeframe: 'auto' })
    prefs = updateMarketPrefs(prefs, { kind: 'line', range: '1W' })
    prefs = updateMarketPrefs(prefs, { active: 'hbar' })
    expect(prefs).toMatchObject({ active: 'hbar', kind: 'candles', range: '1Y' })
    writePrefs(prefs)
    prefs = updateMarketPrefs(readPrefs(), { active: 'btc' })
    expect(prefs).toMatchObject({ active: 'btc', kind: 'line', range: '1W' })
  })

  it('migrates an older deliberate line-chart choice without losing its range', () => {
    window.localStorage.setItem(storageKey, JSON.stringify({ tabs: ['hbar', 'btc'], active: 'btc', kind: 'line', range: '1Y', timeframe: 'D' }))
    const migrated = readPrefs()
    expect(migrated.views.btc).toMatchObject({ kind: 'line', range: '1Y', timeframe: 'D' })
    expect(updateMarketPrefs(updateMarketPrefs(migrated, { active: 'hbar' }), { active: 'btc' }).range).toBe('1Y')
  })

  it('retains thousands of valid saved markets and only applies the high safety cap', () => {
    const tabs = Array.from({ length: 5001 }, (_, i) => 'yf:TEST' + i)
    const extras = Object.fromEntries(tabs.map((id, i) => [id, { symbol: 'TEST' + i, name: 'Test ' + i, group: 'stock' }]))
    const result = sanitizePrefs({ tabs, extras, active: tabs[4999] })
    expect(result.tabs).toHaveLength(5000)
    expect(result.active).toBe('yf:TEST4999')
    expect(result.tabs).toContain('yf:TEST4999')
  })

  it('remembers stocks that are not quick picks together with their name, and drops what is no longer open', () => {
    const result = sanitizePrefs({
      tabs: ['hbar', 'yf:NESN.SW', 'yf:AAPL', 'yf:GONE', 'yf:bad symbol'],
      extras: {
        'yf:NESN.SW': { symbol: 'NESN.SW', name: 'Nestlé S.A.', group: 'stock' },
        'yf:UNUSED': { symbol: 'UNUSED', name: 'Not open any more', group: 'stock' },
        'yf:bad symbol': { symbol: 'x', name: 'Broken id', group: 'stock' },
        'yf:ODD': { symbol: 'ODD', name: 'Odd group', group: 'planet' },
      },
      active: 'yf:NESN.SW',
      drawings: { 'yf:NESN.SW': [{ id: 'a', kind: 'hline', t1: 1, p1: 2, t2: 1, p2: 2 }] },
    })

    expect(result.tabs).toEqual(['hbar', 'yf:NESN.SW', 'yf:AAPL'])
    expect(result.extras).toEqual({ 'yf:NESN.SW': { symbol: 'NESN.SW', name: 'Nestlé S.A.', group: 'stock' } })
    expect(result.active).toBe('yf:NESN.SW')
    expect(result.drawings['yf:NESN.SW']).toHaveLength(1)
  })
})

