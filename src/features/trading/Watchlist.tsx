import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { AssetLogo } from './AssetLogo'
import { AssetPicker } from './AssetPicker'
import { priceFormatter } from './chartMath'
import { assetById, assetDigits } from './marketAssets'
import type { MarketAsset } from './marketAssets'
import type { Quote } from './marketData'
import { isSection, listColors, listMarkets, maxTabs, updateMarketPrefs } from './marketPrefs'
import type { ListColor, ListSection, MarketPrefs, Watchlist as WatchlistData } from './marketPrefs'
import type { tradingCopy } from './tradingCopy'
import { addSection, addToList, canDeleteList, clearList, colorOf, createList, deleteList, deleteSection, moveEntry, removeFromList, renameList, renameSection, setColor, toggleSection } from './watchlists'

type Labels = ReturnType<typeof tradingCopy>

/** How many rows get prices when the browser cannot tell which rows are on screen. */
const fallbackVisible = 40
/** Rows drawn at first; more follow while scrolling, so a list of thousands stays quick. */
const pageSize = 120
const longPressMs = 450

interface WatchlistProps {
  prefs: MarketPrefs
  setPrefs: (update: (current: MarketPrefs) => MarketPrefs) => void
  quotes: Record<string, Quote>
  activeId: string
  /** Opens the chart of a market. */
  onSelect: (id: string) => void
  /** The markets whose rows are on screen, for the price requests. */
  onVisibleChange: (ids: string[]) => void
  labels: Labels
  locale: string
  /** Full-screen list on the phone: adding keeps the list, rows are sorted with handles. */
  overlay: boolean
  /** Shown at the bottom of the full-screen list (the market of the chart). */
  footer?: ReactNode
}

type SheetState =
  | { kind: 'list' }
  | { kind: 'market'; id: string }
  | { kind: 'name'; mode: 'new-list' | 'rename-list' | 'new-section' | 'rename-section'; sectionId?: string; value: string }
  | { kind: 'delete-list' }

function signed(format: Intl.NumberFormat, value: number) {
  return `${value < 0 ? '−' : '+'}${format.format(Math.abs(value))}`
}

export function listName(list: WatchlistData, labels: Labels) {
  if (list.name) return list.name
  return list.color ? labels.colors[list.color] : labels.watchlist
}

function FlagIcon({ color }: { color: ListColor }) {
  return <svg className={`mk-flag-icon is-${color}`} viewBox="0 0 14 16" aria-hidden="true" focusable="false"><path d="M1 1h12l-4 7 4 7H1z" /></svg>
}

function Sheet({ title, onClose, children, labels }: { title: string; onClose: () => void; children: ReactNode; labels: Labels }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('input, button:not([data-sheet-close])')
    first?.focus({ preventScroll: true })
  }, [])
  return (
    <div className="mk-sheet-layer" onKeyDown={(event) => {
      if (event.key !== 'Escape') return
      // Only the sheet closes, not the list behind it.
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation()
      onClose()
    }}>
      <div className="mk-sheet-backdrop" onClick={onClose} />
      <div ref={ref} className="mk-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mk-sheet-head">
          <h4>{title}</h4>
          <button type="button" data-sheet-close className="mk-sheet-close" aria-label={labels.close} onClick={onClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        {children}
      </div>
    </div>
  )
}

interface Group {
  section: ListSection | null
  index: number
  items: Array<{ asset: MarketAsset; index: number }>
}

export function Watchlist({ prefs, setPrefs, quotes, activeId, onSelect, onVisibleChange, labels: t, locale, overlay, footer }: WatchlistProps) {
  const list = prefs.lists.find((item) => item.id === prefs.activeList) ?? prefs.lists[0]
  const name = listName(list, t)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSection, setPickerSection] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [highlight, setHighlight] = useState<{ id: string; key: number } | null>(null)
  const [drag, setDrag] = useState<{ index: number; overIndex: number | null; after: boolean } | null>(null)
  const [touchDrag, setTouchDrag] = useState<{ index: number; dy: number; overIndex: number | null; after: boolean } | null>(null)
  const [note, setNote] = useState('')
  const [limit, setLimit] = useState({ list: '', count: pageSize })
  const scrollRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const chipsRef = useRef<HTMLDivElement>(null)
  const pressRef = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null)
  const touchDragRef = useRef<{ index: number; startY: number; pointerId: number } | null>(null)
  const visibleRef = useRef(onVisibleChange)
  useEffect(() => { visibleRef.current = onVisibleChange })

  const percent = useMemo(() => new Intl.NumberFormat(locale, { style: 'percent', signDisplay: 'always', minimumFractionDigits: 2, maximumFractionDigits: 2 }), [locale])
  const markets = listMarkets(list)

  // Another list starts again with the first rows.
  const rowLimit = limit.list === list.id ? limit.count : pageSize
  const { groups, hidden } = useMemo(() => {
    const result: Group[] = [{ section: null, index: -1, items: [] }]
    let rows = 0
    let rest = 0
    list.entries.forEach((entry, index) => {
      if (rows >= rowLimit) {
        if (!isSection(entry)) rest += 1
        return
      }
      if (isSection(entry)) result.push({ section: entry, index, items: [] })
      else {
        const asset = assetById(entry, prefs.extras)
        if (!asset) return
        result[result.length - 1].items.push({ asset, index })
        if (!result[result.length - 1].section?.collapsed) rows += 1
      }
    })
    return { groups: result, hidden: rest }
  }, [list, prefs.extras, rowLimit])
  const colors = useMemo(() => {
    const map = new Map<string, ListColor>()
    for (const item of prefs.lists) if (item.color) for (const entry of item.entries) if (typeof entry === 'string') map.set(entry, item.color)
    return map
  }, [prefs.lists])
  const moreRef = useRef<HTMLButtonElement>(null)
  const showMore = () => setLimit({ list: list.id, count: rowLimit + pageSize })
  const showMoreRef = useRef(showMore)
  useEffect(() => { showMoreRef.current = showMore })
  useEffect(() => {
    const button = moreRef.current
    if (!button || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) showMoreRef.current() }, { root: scrollRef.current, rootMargin: '400px 0px' })
    observer.observe(button)
    return () => observer.disconnect()
  }, [hidden, rowLimit])

  // Prices are only requested for rows on screen (the list can hold thousands of markets).
  const shownIds = useMemo(() => groups.flatMap((group) => (group.section?.collapsed ? [] : group.items.map((item) => item.asset.id))), [groups])
  const shownKey = shownIds.join(',')
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      visibleRef.current(shownIds.slice(0, fallbackVisible))
      return undefined
    }
    const seen = new Set<string>()
    let timer = 0
    const flush = () => { window.clearTimeout(timer); timer = window.setTimeout(() => visibleRef.current([...seen]), 120) }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.marketRow
        if (!id) continue
        if (entry.isIntersecting) seen.add(id)
        else seen.delete(id)
      }
      flush()
    }, { root, rootMargin: '160px 0px' })
    root.querySelectorAll<HTMLElement>('[data-market-row]').forEach((element) => observer.observe(element))
    return () => { observer.disconnect(); window.clearTimeout(timer) }
    // The rows are looked up again whenever the shown markets change (the key stands for the ids).
  }, [shownKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // The new market is scrolled into view and lights up once.
  useEffect(() => {
    if (!highlight) return undefined
    const row = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[data-market-row]') ?? [])].find((item) => item.dataset.marketRow === highlight.id)
    row?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    const timer = window.setTimeout(() => setHighlight(null), 1800)
    return () => window.clearTimeout(timer)
  }, [highlight])

  useEffect(() => {
    const chip = chipsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    chip?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [prefs.activeList])

  // Closes the search pop-up (wide layout) on a click outside or on Escape.
  useEffect(() => {
    if (!pickerOpen || overlay) return undefined
    const onPointer = (event: PointerEvent) => {
      if (headRef.current && event.target instanceof Node && !headRef.current.contains(event.target)) setPickerOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [pickerOpen, overlay])

  function chooseList(id: string) {
    setEditing(false)
    setPrefs((current) => (current.activeList === id ? current : { ...current, activeList: id }))
  }

  function pick(asset: MarketAsset) {
    const listId = list.id
    const section = pickerSection
    setPrefs((current) => {
      if (current.tabs.length >= maxTabs && !current.tabs.includes(asset.id)) return current
      // A market from the search is remembered with its name; the quick picks are known anyway.
      const extras = asset.source === 'yahoo' && assetById(asset.id) === undefined
        ? { ...current.extras, [asset.id]: { symbol: asset.symbol, name: asset.name, group: asset.group } }
        : current.extras
      return addToList(current, listId, asset.id, section, { extras })
    })
    setPickerOpen(false)
    setPickerSection(null)
    // The new row has to be drawn to be shown, also at the end of a long list.
    if (markets.length + 1 > rowLimit) setLimit({ list: listId, count: markets.length + 1 })
    setNote(t.added(asset.name, name))
    setHighlight({ id: asset.id, key: Date.now() })
    // Beside the chart the new market opens right away; on the phone the list stays (the chart is one tap away).
    if (!overlay) onSelect(asset.id)
  }

  function openPicker(sectionId: string | null = null) {
    setPickerSection(sectionId)
    setPickerOpen((open) => !open || sectionId !== pickerSection)
    setSheet(null)
  }

  function remove(id: string) {
    const listId = list.id
    setPrefs((current) => {
      const next = removeFromList(current, listId, id)
      if (current.active !== id || next.tabs.includes(id)) return next
      // The chart moves on to the neighbour once its market is in no list any more.
      const before = listMarkets(current.lists.find((item) => item.id === listId) ?? list)
      const left = listMarkets(next.lists.find((item) => item.id === listId) ?? list)
      const neighbour = left[Math.min(before.indexOf(id), left.length - 1)] ?? next.tabs[0]
      return neighbour ? updateMarketPrefs(next, { active: neighbour }) : next
    })
  }

  function move(from: number, to: number) {
    setPrefs((current) => moveEntry(current, list.id, from, to))
  }

  /** Index (in the entries) the dragged entry lands on, from its own place and the row it was dropped on. */
  function dropIndex(from: number, over: number, after: boolean) {
    const insertAt = over + (after ? 1 : 0)
    return insertAt > from ? insertAt - 1 : insertAt
  }

  function dragOverRow(event: DragEvent<HTMLElement>, index: number) {
    if (!drag || drag.index === index) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const after = event.clientY > rect.top + rect.height / 2
    if (drag.overIndex !== index || drag.after !== after) setDrag({ ...drag, overIndex: index, after })
  }

  function dropRow() {
    if (drag && drag.overIndex !== null && drag.overIndex !== drag.index) move(drag.index, dropIndex(drag.index, drag.overIndex, drag.after))
    setDrag(null)
  }

  /** Alt + arrow keys move the focused market, so the order can be changed without a mouse. */
  function keyMove(event: ReactKeyboardEvent<HTMLButtonElement>, asset: MarketAsset, index: number) {
    const step = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : 0
    if (!event.altKey || step === 0) return
    event.preventDefault()
    const to = Math.max(0, Math.min(list.entries.length - 1, index + step))
    if (to === index) return
    move(index, to)
    const order = [...list.entries]
    const [moved] = order.splice(index, 1)
    order.splice(to, 0, moved)
    const place = order.filter((entry) => typeof entry === 'string').indexOf(asset.id) + 1
    setNote(t.moved(asset.name, place, markets.length))
    window.requestAnimationFrame(() => {
      const button = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[data-market]') ?? [])].find((item) => item.dataset.market === asset.id)
      button?.focus()
    })
  }

  // ---- touch: long press opens the actions of a market, the handle in edit mode sorts ----
  function pressStart(event: ReactPointerEvent<HTMLElement>, id: string) {
    if (event.pointerType === 'mouse' || editing) return
    window.clearTimeout(pressRef.current?.timer)
    const timer = window.setTimeout(() => {
      if (pressRef.current) pressRef.current.fired = true
      setSheet({ kind: 'market', id })
    }, longPressMs)
    pressRef.current = { timer, x: event.clientX, y: event.clientY, fired: false }
  }

  function pressMove(event: ReactPointerEvent<HTMLElement>) {
    const press = pressRef.current
    if (press && !press.fired && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) {
      window.clearTimeout(press.timer)
      pressRef.current = null
    }
  }

  function pressEnd() {
    if (pressRef.current && !pressRef.current.fired) {
      window.clearTimeout(pressRef.current.timer)
      pressRef.current = null
    }
  }

  function rowClick(id: string) {
    // The click that ends a long press only opened the actions.
    if (pressRef.current?.fired) { pressRef.current = null; return }
    if (!editing) onSelect(id)
  }

  function targetAt(clientY: number, from: number) {
    const rows = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[data-entry]') ?? [])]
    let over: number | null = null
    let after = false
    for (const row of rows) {
      const index = Number(row.dataset.entry)
      if (index === from) continue
      const rect = row.getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) { over = index; after = false; break }
      over = index
      after = true
    }
    return { over, after }
  }

  function handleDown(event: ReactPointerEvent<HTMLElement>, index: number) {
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* capture is optional */ }
    touchDragRef.current = { index, startY: event.clientY, pointerId: event.pointerId }
    setTouchDrag({ index, dy: 0, overIndex: null, after: false })
  }

  function handleMove(event: ReactPointerEvent<HTMLElement>) {
    const state = touchDragRef.current
    if (!state || state.pointerId !== event.pointerId) return
    const root = scrollRef.current
    if (root) {
      const box = root.getBoundingClientRect()
      if (event.clientY < box.top + 48) root.scrollTop -= 10
      else if (event.clientY > box.bottom - 48) root.scrollTop += 10
    }
    const { over, after } = targetAt(event.clientY, state.index)
    setTouchDrag({ index: state.index, dy: event.clientY - state.startY, overIndex: over, after })
  }

  function handleUp(event: ReactPointerEvent<HTMLElement>) {
    const state = touchDragRef.current
    if (!state || state.pointerId !== event.pointerId) return
    const { over, after } = targetAt(event.clientY, state.index)
    touchDragRef.current = null
    setTouchDrag(null)
    if (over !== null) move(state.index, dropIndex(state.index, over, after))
  }

  function handleCancel() {
    touchDragRef.current = null
    setTouchDrag(null)
  }

  // ---- sheets ----
  function submitName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sheet?.kind !== 'name') return
    const value = sheet.value.trim()
    const listId = list.id
    if (sheet.mode === 'new-list') {
      if (!value) return
      setPrefs((current) => createList(current, value))
    } else if (sheet.mode === 'rename-list') {
      setPrefs((current) => renameList(current, listId, value))
    } else if (sheet.mode === 'new-section') {
      setPrefs((current) => addSection(current, listId, value || t.untitledSection).prefs)
    } else if (sheet.sectionId) {
      const sectionId = sheet.sectionId
      setPrefs((current) => renameSection(current, listId, sectionId, value || t.untitledSection))
    }
    setSheet(null)
  }

  const indicatorClass = (index: number) => {
    const target = drag ?? touchDrag
    if (!target || target.overIndex !== index) return ''
    return target.after ? ' drop-after' : ' drop-before'
  }

  function renderRow({ asset, index }: { asset: MarketAsset; index: number }) {
    const row = quotes[asset.id]
    const active = asset.id === activeId
    const tone = row ? (row.changePct >= 0 ? 'up' : 'down') : 'flat'
    const format = row ? priceFormatter(locale, row.price, {}, assetDigits(asset, row.price)) : null
    // the change in price terms follows from the price and the percentage
    const absolute = row ? row.price - row.price / (1 + row.changePct / 100) : null
    const color = colors.get(asset.id) ?? null
    const dragging = drag?.index === index || touchDrag?.index === index
    return (
      <div
        key={asset.id}
        data-entry={index}
        data-market-row={asset.id}
        className={`mk-row${active ? ' active' : ''}${dragging ? ' is-dragging' : ''}${highlight?.id === asset.id ? ' is-new' : ''}${indicatorClass(index)}`}
        style={touchDrag?.index === index ? { transform: `translateY(${touchDrag.dy}px)` } : undefined}
        draggable={!overlay && markets.length > 1}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          // Firefox only starts a drag when some data is set.
          event.dataTransfer.setData('text/plain', asset.id)
          setDrag({ index, overIndex: null, after: false })
        }}
        onDragOver={(event) => dragOverRow(event, index)}
        onDrop={(event) => { event.preventDefault(); dropRow() }}
        onDragEnd={() => setDrag(null)}
        onContextMenu={(event) => { if (!editing) { event.preventDefault(); setSheet({ kind: 'market', id: asset.id }) } }}
      >
        {color && <span className={`mk-row-flag is-${color}`} aria-hidden="true" />}
        {editing && <button type="button" className="mk-row-remove" aria-label={t.closeTab(asset.symbol)} onClick={() => remove(asset.id)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg></button>}
        <button
          type="button"
          role="tab"
          data-market={asset.id}
          aria-selected={active}
          aria-keyshortcuts={markets.length > 1 ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
          aria-label={`${asset.name} (${asset.symbol})${row ? ` ${percent.format(row.changePct / 100)}` : ''}`}
          title={`${asset.name} · ${t.dayChange}${markets.length > 1 ? ` · ${t.reorderHint}` : ''}`}
          onClick={() => rowClick(asset.id)}
          onKeyDown={(event) => keyMove(event, asset, index)}
          onPointerDown={(event) => pressStart(event, asset.id)}
          onPointerMove={pressMove}
          onPointerUp={pressEnd}
          onPointerCancel={pressEnd}
          onPointerLeave={pressEnd}
        >
          <AssetLogo asset={asset} />
          <span className="mk-row-text"><b className="mk-row-symbol">{asset.symbol}</b><span className="mk-row-name">{asset.name}</span></span>
          <span className="mk-row-values">
            <span className="mk-row-price">{row && format ? format.format(row.price) : '–'}</span>
            <span className={`mk-row-change is-${tone}`}><span className="mk-row-abs">{absolute !== null && format ? signed(format, absolute) : ''}</span> <span className="mk-row-pct">{row ? percent.format(row.changePct / 100) : ''}</span></span>
          </span>
        </button>
        {editing
          ? <span className="mk-row-handle" role="button" tabIndex={-1} aria-label={t.moveHandle(asset.symbol)} onPointerDown={(event) => handleDown(event, index)} onPointerMove={handleMove} onPointerUp={handleUp} onPointerCancel={handleCancel}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14M5 15h14" /></svg></span>
          : !overlay && <button type="button" className="mk-row-close" aria-label={t.closeTab(asset.symbol)} title={t.closeTab(asset.symbol)} onClick={() => remove(asset.id)}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7L7 17" /></svg></button>}
      </div>
    )
  }

  function renderSection(group: Group) {
    const section = group.section as ListSection
    const label = section.name || t.untitledSection
    const dragging = touchDrag?.index === group.index
    return (
      <div
        className={`mk-section-head${editing ? ' is-editing' : ''}${dragging ? ' is-dragging' : ''}${indicatorClass(group.index)}`}
        data-entry={group.index}
        style={dragging ? { transform: `translateY(${touchDrag.dy}px)` } : undefined}
        onDragOver={(event) => { if (drag) { event.preventDefault(); setDrag({ ...drag, overIndex: group.index, after: true }) } }}
        onDrop={(event) => { event.preventDefault(); dropRow() }}
      >
        {editing ? (
          <>
            <button type="button" className="mk-row-remove" aria-label={t.deleteSection(label)} onClick={() => setPrefs((current) => deleteSection(current, list.id, section.id))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg></button>
            <button type="button" className="mk-section-name" aria-label={`${t.renameSection}: ${label}`} onClick={() => setSheet({ kind: 'name', mode: 'rename-section', sectionId: section.id, value: section.name })}>{label}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19l4-1 10-10-3-3L6 15l-1 4z" /></svg></button>
            <button type="button" className="mk-section-add" aria-label={t.addToSection(label)} onClick={() => openPicker(section.id)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
            <span className="mk-row-handle" role="button" tabIndex={-1} aria-label={t.moveHandle(label)} onPointerDown={(event) => handleDown(event, group.index)} onPointerMove={handleMove} onPointerUp={handleUp} onPointerCancel={handleCancel}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14M5 15h14" /></svg></span>
          </>
        ) : (
          <button type="button" className="mk-section-toggle" aria-expanded={!section.collapsed} onClick={() => setPrefs((current) => toggleSection(current, list.id, section.id))}>
            <span>{label}</span>
            {section.collapsed && <small>{group.items.length}</small>}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        )}
      </div>
    )
  }

  const marketSheet = sheet?.kind === 'market' ? assetById(sheet.id, prefs.extras) : undefined
  const customLists = prefs.lists.filter((item) => item.color === null)
  const colorLists = prefs.lists.filter((item) => item.color !== null)
  const empty = markets.length === 0

  return (
    <aside className={`mk-watch${editing ? ' is-editing' : ''}`}>
      <div className="mk-watch-head" ref={headRef}>
        {editing
          ? <button type="button" className="mk-watch-done" onClick={() => setEditing(false)}>{t.done}</button>
          : <button type="button" className="mk-watch-menu" aria-label={t.listMenu} aria-haspopup="dialog" onClick={() => setSheet({ kind: 'list' })}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg></button>}
        <h3 className="mk-watch-title">
          {list.color && <FlagIcon color={list.color} />}
          <span>{name}</span>
          <small>{t.count(markets.length)}</small>
        </h3>
        <button type="button" className="mk-add-button" aria-haspopup="dialog" aria-expanded={pickerOpen} aria-label={t.addTab} title={t.addTab} onClick={() => openPicker(null)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        {pickerOpen && <AssetPicker tabs={markets} full={prefs.tabs.length >= maxTabs} onPick={pick} onClose={() => { setPickerOpen(false); setPickerSection(null) }} labels={t} sheet={overlay} />}
      </div>

      <div className="mk-lists" ref={chipsRef} role="group" aria-label={t.lists}>
        {customLists.map((item) => (
          <button key={item.id} type="button" className="mk-list-chip" aria-pressed={item.id === list.id} onClick={() => chooseList(item.id)}>{listName(item, t)}</button>
        ))}
        {colorLists.map((item) => (
          <button key={item.id} type="button" className="mk-list-chip is-color" aria-pressed={item.id === list.id} aria-label={item.name ? `${item.name} · ${t.colorList(t.colors[item.color as ListColor], listMarkets(item).length)}` : t.colorList(t.colors[item.color as ListColor], listMarkets(item).length)} title={listName(item, t)} onClick={() => chooseList(item.id)}>
            <FlagIcon color={item.color as ListColor} />
            {listMarkets(item).length > 0 && <small>{listMarkets(item).length}</small>}
          </button>
        ))}
        <button type="button" className="mk-list-chip is-new" aria-label={t.newList} title={t.newList} onClick={() => setSheet({ kind: 'name', mode: 'new-list', value: '' })}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
      </div>

      <div className="mk-watch-list" ref={scrollRef} onDragLeave={(event) => {
        // Leaving the list: no row is the target any more.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrag((current) => (current ? { ...current, overIndex: null } : current))
      }}>
        {groups.map((group) => {
          if (!group.section && group.items.length === 0) return null
          const label = group.section ? group.section.name || t.untitledSection : t.tabsLabel
          return (
            <section key={group.section?.id ?? 'top'} className="mk-watch-group">
              {group.section && renderSection(group)}
              {!group.section?.collapsed && group.items.length > 0 && (
                <div className="mk-watch-rows" role="tablist" aria-orientation="vertical" aria-label={label}>
                  {group.items.map(renderRow)}
                </div>
              )}
            </section>
          )
        })}
        {hidden > 0 && <button ref={moreRef} type="button" className="mk-watch-more" onClick={showMore}>{t.showMore(hidden)}</button>}
        {empty && <p className="mk-watch-empty">{list.color ? t.emptyColorList : t.emptyList}</p>}
      </div>

      {footer}
      <p className="mk-visually-hidden" aria-live="polite">{note}</p>

      {sheet?.kind === 'list' && (
        <Sheet title={name} onClose={() => setSheet(null)} labels={t}>
          <div className="mk-sheet-actions">
            <button type="button" disabled={list.entries.length === 0} onClick={() => { setEditing(true); setSheet(null) }}>{t.editList}</button>
            <button type="button" onClick={() => setSheet({ kind: 'name', mode: 'new-section', value: '' })}>{t.addSection}</button>
            <button type="button" onClick={() => setSheet({ kind: 'name', mode: 'rename-list', value: list.name || name })}>{t.renameList}</button>
            <button type="button" onClick={() => setSheet({ kind: 'name', mode: 'new-list', value: '' })}>{t.newList}</button>
            {canDeleteList(prefs, list.id) && <button type="button" className="is-danger" onClick={() => setSheet({ kind: 'delete-list' })}>{t.deleteList}</button>}
            {list.color && list.entries.length > 0 && <button type="button" className="is-danger" onClick={() => { setPrefs((current) => clearList(current, list.id)); setSheet(null) }}>{t.clearList}</button>}
          </div>
        </Sheet>
      )}

      {sheet?.kind === 'delete-list' && (
        <Sheet title={t.deleteListQuestion(name)} onClose={() => setSheet(null)} labels={t}>
          <p className="mk-sheet-text">{t.deleteListHint}</p>
          <div className="mk-sheet-actions is-row">
            <button type="button" onClick={() => setSheet(null)}>{t.cancel}</button>
            <button type="button" className="is-danger" onClick={() => { setPrefs((current) => deleteList(current, list.id)); setSheet(null); setEditing(false) }}>{t.deleteList}</button>
          </div>
        </Sheet>
      )}

      {sheet?.kind === 'name' && (
        <Sheet title={sheet.mode === 'new-list' ? t.newList : sheet.mode === 'rename-list' ? t.renameList : sheet.mode === 'new-section' ? t.addSection : t.renameSection} onClose={() => setSheet(null)} labels={t}>
          <form className="mk-sheet-form" onSubmit={submitName}>
            <input type="text" aria-label={sheet.mode.endsWith('list') ? t.listName : t.sectionName} placeholder={sheet.mode.endsWith('list') ? t.listName : t.sectionName} maxLength={40} value={sheet.value} enterKeyHint="done" onChange={(event) => setSheet({ ...sheet, value: event.target.value })} />
            <div className="mk-sheet-actions is-row">
              <button type="button" onClick={() => setSheet(null)}>{t.cancel}</button>
              <button type="submit" className="is-primary" disabled={sheet.mode === 'new-list' && !sheet.value.trim()}>{t.save}</button>
            </div>
          </form>
        </Sheet>
      )}

      {marketSheet && (
        <Sheet title={t.marketActions(marketSheet.symbol)} onClose={() => setSheet(null)} labels={t}>
          <div className="mk-sheet-market">
            <AssetLogo asset={marketSheet} size={44} />
            <div><b>{marketSheet.symbol}</b><span>{marketSheet.name}</span></div>
          </div>
          <div className="mk-sheet-colors" role="group" aria-label={t.color}>
            <button type="button" className="is-none" aria-label={t.noColor} aria-pressed={colorOf(prefs, marketSheet.id) === null} onClick={() => setPrefs((current) => setColor(current, marketSheet.id, null))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12" /></svg></button>
            {listColors.map((color) => (
              <button key={color} type="button" className={`is-${color}`} aria-label={t.colors[color]} aria-pressed={colorOf(prefs, marketSheet.id) === color} onClick={() => setPrefs((current) => setColor(current, marketSheet.id, color))}><FlagIcon color={color} /></button>
            ))}
          </div>
          {customLists.length > 0 && (
            <fieldset className="mk-sheet-lists">
              <legend>{t.inLists}</legend>
              {customLists.map((item) => {
                const inside = item.entries.includes(marketSheet.id)
                return (
                  <label key={item.id} className="mk-check">
                    <input type="checkbox" checked={inside} onChange={() => setPrefs((current) => (inside ? removeFromList(current, item.id, marketSheet.id) : addToList(current, item.id, marketSheet.id)))} />
                    <span>{listName(item, t)}</span>
                  </label>
                )
              })}
            </fieldset>
          )}
          <div className="mk-sheet-actions">
            <button type="button" onClick={() => { setSheet(null); onSelect(marketSheet.id) }}>{t.openChart}</button>
            {list.entries.includes(marketSheet.id) && <button type="button" className="is-danger" onClick={() => { remove(marketSheet.id); setSheet(null) }}>{t.removeFrom(name)}</button>}
          </div>
        </Sheet>
      )}
    </aside>
  )
}
