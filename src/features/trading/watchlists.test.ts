import { describe, expect, it } from 'vitest'
import { colorListId, defaultPrefs, mainListId, maxLists } from './marketPrefs'
import type { MarketPrefs } from './marketPrefs'
import { addSection, addToList, canDeleteList, clearList, colorOf, createList, deleteList, deleteSection, moveEntry, removeFromList, renameList, renameSection, setColor, toggleSection } from './watchlists'

const entriesOf = (prefs: MarketPrefs, id: string) => prefs.lists.find((list) => list.id === id)?.entries

describe('watchlists', () => {
  it('adds a market to the end of a list or of a section, once', () => {
    let prefs = addToList(defaultPrefs(), mainListId, 'btc')
    const { prefs: withSection, section } = addSection(prefs, mainListId, 'Aktien')
    prefs = addToList(withSection, mainListId, 'yf:AAPL', null)
    prefs = addToList(prefs, mainListId, 'eth', section.id)
    expect(entriesOf(prefs, mainListId)).toEqual(['hbar', 'btc', section, 'yf:AAPL', 'eth'])
    // a heading in the middle: the market goes before the next heading
    const { prefs: second, section: other } = addSection(prefs, mainListId, 'Rest')
    prefs = addToList(second, mainListId, 'sol', section.id)
    expect(entriesOf(prefs, mainListId)).toEqual(['hbar', 'btc', section, 'yf:AAPL', 'eth', 'sol', other])
    expect(addToList(prefs, mainListId, 'btc', other.id)).toEqual(prefs)
    expect(prefs.tabs).toEqual(['hbar', 'btc', 'yf:AAPL', 'eth', 'sol'])
  })

  it('gives a market at most one colour', () => {
    let prefs = setColor(defaultPrefs(), 'btc', 'red')
    expect(colorOf(prefs, 'btc')).toBe('red')
    prefs = setColor(prefs, 'btc', 'green')
    expect(colorOf(prefs, 'btc')).toBe('green')
    expect(entriesOf(prefs, colorListId('red'))).toEqual([])
    prefs = addToList(prefs, colorListId('blue'), 'btc')
    expect(colorOf(prefs, 'btc')).toBe('blue')
    expect(entriesOf(prefs, colorListId('green'))).toEqual([])
    prefs = setColor(prefs, 'btc', null)
    expect(colorOf(prefs, 'btc')).toBeNull()
    // a colour is a flag: the market stays in the own lists
    expect(prefs.tabs).toEqual(['hbar'])
  })

  it('creates, renames and deletes own lists, but always keeps one of them and the colours', () => {
    let prefs = createList(defaultPrefs(), '  Meine   Aktien ')
    const created = prefs.lists[1]
    expect(created).toMatchObject({ name: 'Meine Aktien', color: null, entries: [] })
    expect(prefs.activeList).toBe(created.id)
    expect(prefs.lists[2].id).toBe(colorListId('red'))
    prefs = renameList(prefs, created.id, 'Dividenden')
    expect(prefs.lists[1].name).toBe('Dividenden')
    expect(canDeleteList(prefs, colorListId('red'))).toBe(false)
    expect(deleteList(prefs, colorListId('red'))).toBe(prefs)
    prefs = deleteList(prefs, created.id)
    expect(prefs.lists.some((list) => list.id === created.id)).toBe(false)
    expect(prefs.activeList).toBe(mainListId)
    expect(canDeleteList(prefs, mainListId)).toBe(false)
    expect(deleteList(prefs, mainListId)).toBe(prefs)
  })

  it('stops at the highest number of own lists', () => {
    let prefs = defaultPrefs()
    for (let i = 0; i < maxLists + 3; i += 1) prefs = createList(prefs, `L${i}`)
    expect(prefs.lists.filter((list) => list.color === null)).toHaveLength(maxLists)
  })

  it('renames, folds and deletes a section without losing its markets', () => {
    const { prefs: start, section } = addSection(addToList(defaultPrefs(), mainListId, 'btc'), mainListId, 'Coins')
    let prefs = addToList(start, mainListId, 'eth', section.id)
    prefs = renameSection(prefs, mainListId, section.id, 'Kryptos')
    prefs = toggleSection(prefs, mainListId, section.id)
    expect(entriesOf(prefs, mainListId)?.[2]).toEqual({ id: section.id, name: 'Kryptos', collapsed: true })
    prefs = toggleSection(prefs, mainListId, section.id)
    expect(entriesOf(prefs, mainListId)?.[2]).toEqual({ id: section.id, name: 'Kryptos' })
    prefs = deleteSection(prefs, mainListId, section.id)
    expect(entriesOf(prefs, mainListId)).toEqual(['hbar', 'btc', 'eth'])
  })

  it('moves markets and headings, removes and clears', () => {
    const { prefs: start, section } = addSection(addToList(addToList(defaultPrefs(), mainListId, 'btc'), mainListId, 'eth'), mainListId, 'S')
    let prefs = moveEntry(start, mainListId, 3, 0)
    expect(entriesOf(prefs, mainListId)).toEqual([section, 'hbar', 'btc', 'eth'])
    prefs = moveEntry(prefs, mainListId, 1, 9)
    expect(entriesOf(prefs, mainListId)).toEqual([section, 'btc', 'eth', 'hbar'])
    expect(moveEntry(prefs, mainListId, 7, 0)).toEqual(prefs)
    prefs = removeFromList(prefs, mainListId, 'eth')
    expect(prefs.tabs).toEqual(['btc', 'hbar'])
    prefs = setColor(prefs, 'btc', 'red')
    prefs = clearList(prefs, colorListId('red'))
    expect(colorOf(prefs, 'btc')).toBeNull()
  })

  it('forgets the name of a searched market once it is in no list and not on screen', () => {
    const extras = { 'yf:NESN.SW': { symbol: 'NESN.SW', name: 'Nestlé', group: 'stock' as const } }
    let prefs = addToList(defaultPrefs(), mainListId, 'yf:NESN.SW', null, { extras })
    expect(prefs.extras).toEqual(extras)
    prefs = removeFromList(prefs, mainListId, 'yf:NESN.SW')
    expect(prefs.extras).toEqual({})
  })
})
