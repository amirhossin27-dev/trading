import { useEffect, useMemo, useRef, useState } from 'react'
import { AssetLogo } from './AssetLogo'
import { assetGroups, searchAssets, yahooAsset } from './marketAssets'
import type { AssetGroup, MarketAsset } from './marketAssets'
import { searchMarkets } from './tradingApi'
import type { MarketSearchResult } from './tradingApi'
import type { tradingCopy } from './tradingCopy'

type Labels = ReturnType<typeof tradingCopy>

interface AssetPickerProps {
  tabs: string[]
  full: boolean
  onPick: (asset: MarketAsset) => void
  onClose: () => void
  labels: Labels
  /** Full-screen layer over the list (phone) instead of a pop-up. */
  sheet?: boolean
}

interface Found {
  asset: MarketAsset
  exchange: string
}

interface SearchState {
  query: string
  found: Found[]
  failed: boolean
}

function groupOf(type: string): AssetGroup {
  if (type === 'INDEX') return 'index'
  if (type === 'CURRENCY') return 'currency'
  if (type === 'FUTURE') return 'commodity'
  return 'stock'
}

function toFound(row: MarketSearchResult): Found {
  return { asset: yahooAsset(row.symbol, row.symbol, row.name, groupOf(row.type)), exchange: row.exchange }
}

/** Searchable list of the quick picks plus a live search over every stock, fund and index; a market that is already open only switches to its tab. */
export function AssetPicker({ tabs, full, onPick, onClose, labels, sheet = false }: AssetPickerProps) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filter, setFilter] = useState<'all' | AssetGroup>('all')
  const [search, setSearch] = useState<SearchState | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (debounced.length < 2) return undefined
    const controller = new AbortController()
    searchMarkets(debounced, controller.signal)
      .then((rows) => setSearch({ query: debounced, found: rows.map(toFound), failed: false }))
      .catch(() => {
        if (!controller.signal.aborted) setSearch({ query: debounced, found: [], failed: true })
      })
    return () => controller.abort()
  }, [debounced])

  const typed = query.trim()
  const searching = typed.length >= 2 && (typed !== debounced || search?.query !== debounced)
  const current = typed.length >= 2 && search?.query === typed ? search : null

  const groups = useMemo(() => {
    const quick = searchAssets(typed)
    const quickIds = new Set(quick.map((asset) => asset.id))
    const more = (current?.found ?? []).filter((item) => !quickIds.has(item.asset.id))
    return assetGroups
      .filter((group) => filter === 'all' || filter === group)
      .map((group) => ({
        group,
        items: [
          ...quick.filter((asset) => asset.group === group).map((asset): Found => ({ asset, exchange: '' })),
          ...more.filter((item) => item.asset.group === group),
        ],
      }))
      .filter((entry) => entry.items.length > 0)
  }, [typed, current, filter])

  const visible = groups.flatMap((entry) => entry.items)
  const pickable = (asset: MarketAsset) => !full || tabs.includes(asset.id)

  return (
    <div className={`mk-picker${sheet ? ' is-sheet' : ''}`} role="dialog" aria-label={labels.searchLabel} onKeyDown={(event) => {
      if (event.key !== 'Escape' || !sheet) return
      // Escape leaves the search, not the whole list.
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation()
      onClose()
    }}>
      {sheet && <div className="mk-picker-head"><h4>{labels.addTab}</h4><button type="button" onClick={onClose}>{labels.done}</button></div>}
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder={labels.searchPlaceholder}
        aria-label={labels.searchLabel}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !sheet) onClose()
          if (event.key === 'Enter' && visible.length > 0 && pickable(visible[0].asset)) onPick(visible[0].asset)
        }}
      />
      <div className="mk-picker-filters" role="group" aria-label={labels.searchLabel}>
        {(['all', ...assetGroups] as const).map((item) => (
          <button key={item} type="button" className={filter === item ? 'active' : ''} aria-pressed={filter === item} onClick={() => setFilter(item)}>{labels.filters[item]}</button>
        ))}
      </div>
      {full && <p className="mk-picker-note">{labels.maxTabs}</p>}
      <div className="mk-picker-list">
        {groups.map(({ group, items }) => (
          <div key={group}>
            <h3>{labels.groups[group]}</h3>
            <ul>
              {items.map(({ asset, exchange }) => {
                const open = tabs.includes(asset.id)
                return (
                  <li key={asset.id}>
                    <button type="button" className={open ? 'is-open' : ''} disabled={!pickable(asset)} onClick={() => onPick(asset)}>
                      <AssetLogo asset={asset} size={30} />
                      <span className="mk-picker-text">
                        <b>{asset.symbol}</b>{' '}
                        <span>{asset.name}</span>
                      </span>
                      {exchange && <small>{exchange}</small>}
                      {open && <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        {searching && <p className="mk-picker-empty" role="status">{labels.searching}</p>}
        {!searching && current?.failed && <p className="mk-picker-empty" role="status">{labels.searchFailed}</p>}
        {!searching && visible.length === 0 && !current?.failed && <p className="mk-picker-empty">{labels.noResults}</p>}
        {typed.length < 2 && filter !== 'crypto' && <p className="mk-picker-empty">{labels.searchHint}</p>}
      </div>
    </div>
  )
}
