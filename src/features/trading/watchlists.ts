/** Changes to the lists of markets. Pure functions on the preferences, so they are easy to test and to undo. */
import { cleanName, isSection, maxLists, withLists } from './marketPrefs'
import type { ListColor, ListEntry, ListSection, MarketPrefs, Watchlist } from './marketPrefs'

export function newId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 24)
}

function mapList(prefs: MarketPrefs, listId: string, change: (list: Watchlist) => Watchlist, patch: Partial<MarketPrefs> = {}) {
  return withLists(prefs, prefs.lists.map((list) => (list.id === listId ? change(list) : list)), patch)
}

/** The colour a market carries (the colour list it is in), if any. */
export function colorOf(prefs: MarketPrefs, assetId: string): ListColor | null {
  return prefs.lists.find((list) => list.color !== null && list.entries.includes(assetId))?.color ?? null
}

/** Where a new market goes: at the end of the given section, or at the end of the list. */
function insertAt(entries: ListEntry[], sectionId: string | null | undefined) {
  if (!sectionId) return entries.length
  const start = entries.findIndex((entry) => isSection(entry) && entry.id === sectionId)
  if (start < 0) return entries.length
  const next = entries.findIndex((entry, index) => index > start && isSection(entry))
  return next < 0 ? entries.length : next
}

/**
 * Adds a market to a list. A colour list takes the market away from the other colours (one colour per market).
 * A market that is already in the list stays where it is.
 */
export function addToList(prefs: MarketPrefs, listId: string, assetId: string, sectionId?: string | null, patch: Partial<MarketPrefs> = {}) {
  const target = prefs.lists.find((list) => list.id === listId)
  if (!target) return prefs
  const lists = prefs.lists.map((list) => {
    if (list.id === listId) {
      if (list.entries.includes(assetId)) return list
      const entries = [...list.entries]
      entries.splice(insertAt(entries, sectionId), 0, assetId)
      return { ...list, entries }
    }
    if (target.color !== null && list.color !== null && list.entries.includes(assetId)) return { ...list, entries: list.entries.filter((entry) => entry !== assetId) }
    return list
  })
  return withLists(prefs, lists, patch)
}

export function removeFromList(prefs: MarketPrefs, listId: string, assetId: string) {
  return mapList(prefs, listId, (list) => ({ ...list, entries: list.entries.filter((entry) => entry !== assetId) }))
}

/** Gives a market a colour (or none): it leaves its old colour list and goes to the end of the new one. */
export function setColor(prefs: MarketPrefs, assetId: string, color: ListColor | null) {
  const lists = prefs.lists.map((list) => {
    if (list.color === null) return list
    const without = list.entries.filter((entry) => entry !== assetId)
    if (list.color === color) return list.entries.includes(assetId) ? list : { ...list, entries: [...list.entries, assetId] }
    return without.length === list.entries.length ? list : { ...list, entries: without }
  })
  return withLists(prefs, lists)
}

export function createList(prefs: MarketPrefs, name: string) {
  const custom = prefs.lists.filter((list) => list.color === null)
  if (custom.length >= maxLists) return prefs
  const list: Watchlist = { id: newId('l'), name: cleanName(name), color: null, entries: [] }
  // New lists go after the other own lists and before the colours.
  const lists = [...custom, list, ...prefs.lists.filter((item) => item.color !== null)]
  return withLists(prefs, lists, { activeList: list.id })
}

export function renameList(prefs: MarketPrefs, listId: string, name: string) {
  return mapList(prefs, listId, (list) => ({ ...list, name: cleanName(name) }))
}

/** Own lists can be deleted, as long as one is left; the colour lists always exist (they can only be emptied). */
export function canDeleteList(prefs: MarketPrefs, listId: string) {
  const list = prefs.lists.find((item) => item.id === listId)
  return Boolean(list && list.color === null && prefs.lists.filter((item) => item.color === null).length > 1)
}

export function deleteList(prefs: MarketPrefs, listId: string) {
  if (!canDeleteList(prefs, listId)) return prefs
  const index = prefs.lists.findIndex((list) => list.id === listId)
  const lists = prefs.lists.filter((list) => list.id !== listId)
  const activeList = prefs.activeList === listId ? lists[Math.max(0, index - 1)].id : prefs.activeList
  return withLists(prefs, lists, { activeList })
}

export function clearList(prefs: MarketPrefs, listId: string) {
  return mapList(prefs, listId, (list) => ({ ...list, entries: [] }))
}

export function addSection(prefs: MarketPrefs, listId: string, name: string) {
  const section: ListSection = { id: newId('s'), name: cleanName(name) }
  return { prefs: mapList(prefs, listId, (list) => ({ ...list, entries: [...list.entries, section] })), section }
}

function mapSection(prefs: MarketPrefs, listId: string, sectionId: string, change: (section: ListSection) => ListSection | null) {
  return mapList(prefs, listId, (list) => ({
    ...list,
    entries: list.entries.flatMap((entry) => (isSection(entry) && entry.id === sectionId ? [change(entry)].filter((item): item is ListSection => item !== null) : [entry])),
  }))
}

export function renameSection(prefs: MarketPrefs, listId: string, sectionId: string, name: string) {
  return mapSection(prefs, listId, sectionId, (section) => ({ ...section, name: cleanName(name) }))
}

/** Removes the heading only; its markets stay in the list and join the section above. */
export function deleteSection(prefs: MarketPrefs, listId: string, sectionId: string) {
  return mapSection(prefs, listId, sectionId, () => null)
}

export function toggleSection(prefs: MarketPrefs, listId: string, sectionId: string) {
  return mapSection(prefs, listId, sectionId, (section) => (section.collapsed ? { id: section.id, name: section.name } : { ...section, collapsed: true }))
}

/** Moves an entry (market or heading) of a list to another place; `to` is its index after the move. */
export function moveEntry(prefs: MarketPrefs, listId: string, from: number, to: number) {
  return mapList(prefs, listId, (list) => {
    if (from < 0 || from >= list.entries.length) return list
    const target = Math.max(0, Math.min(list.entries.length - 1, to))
    if (target === from) return list
    const entries = [...list.entries]
    const [moved] = entries.splice(from, 1)
    entries.splice(target, 0, moved)
    return { ...list, entries }
  })
}

