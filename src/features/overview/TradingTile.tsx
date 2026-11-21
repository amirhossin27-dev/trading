import { useEffect, useMemo, useState } from 'react'
import './startWidgets.css'
import type { Language } from '../../types/platform'
import { assetById, assetDigits } from '../trading/marketAssets'
import type { MarketAsset } from '../trading/marketAssets'
import { loadQuotes } from '../trading/marketData'
import type { Quote } from '../trading/marketData'
import { moneyFormatter } from '../trading/money'
import { readPrefs } from '../trading/marketPrefs'
import { localeFor } from './overviewCopy'

const refreshMs = 30_000

const copy = {
  de: { title: 'Trading', open: 'Trading-Modul öffnen', separate: 'Trading in neuem Tab öffnen', list: 'Top 6 deiner Watchlist', day: 'Tagesänderung', empty: 'Füge im Trading-Modul Kryptos oder Aktien hinzu.' },
  en: { title: 'Trading', open: 'Open the Trading module', separate: 'Open Trading in a new tab', list: 'Top 6 of your watchlist', day: 'Day change', empty: 'Add crypto or stocks in the Trading module.' },
}

/** The first six crypto/stock entries in the user's Trading watchlist, in their saved order. */
export function TradingTile({ language, onOpen }: { language: Language; onOpen: () => void }) {
  const t = copy[language === 'de' ? 'de' : 'en']
  const locale = localeFor(language)
  const [assets] = useState(() => {
    const prefs = readPrefs()
    return prefs.tabs
      .map((id) => assetById(id, prefs.extras))
      .filter((asset): asset is MarketAsset => asset !== undefined && (asset.group === 'crypto' || asset.group === 'stock'))
      .slice(0, 6)
  })
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})

  useEffect(() => {
    if (assets.length === 0) return undefined
    const controller = new AbortController()
    const run = () => loadQuotes(assets, controller.signal)
      .then((next) => { if (!controller.signal.aborted) setQuotes((current) => ({ ...current, ...next })) })
      .catch(() => undefined)
    run()
    const timer = window.setInterval(run, refreshMs)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [assets])

  const percent = useMemo(() => new Intl.NumberFormat(locale, { style: 'percent', signDisplay: 'always', minimumFractionDigits: 2, maximumFractionDigits: 2 }), [locale])

  return (
    <article className="start-cal start-trade" aria-label={`${t.title} · ${t.list}`}>
      <header className="start-cal-band">
        <button type="button" className="start-trade-open" aria-label={t.open} title={t.open} onClick={onOpen}>{t.title}</button>
        <a href="./" target="_blank" rel="noopener noreferrer" aria-label={t.separate} title={t.separate}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
        </a>
      </header>
      {assets.length > 0 ? (
        <ol className="start-trade-list" aria-label={t.list}>
          {assets.map((asset) => {
            const quote = quotes[asset.id]
            const trend = quote ? (quote.changePct >= 0 ? 'up' : 'down') : 'flat'
            const money = moneyFormatter(locale, quote?.currency ?? 'USD', quote?.price ?? 1, assetDigits(asset, quote?.price ?? 1))
            return (
              <li key={asset.id} className="start-trade-row">
                <span className="start-trade-symbol" title={asset.name}>{asset.symbol}</span>
                <span className="start-trade-price">{quote ? money.format(quote.price) : '—'}</span>
                <span className={`start-trade-change is-${trend}`} title={t.day}>{quote ? percent.format(quote.changePct / 100) : '—'}</span>
              </li>
            )
          })}
        </ol>
      ) : <p className="start-trade-empty">{t.empty}</p>}
    </article>
  )
}
