import { memo, useState } from 'react'
import type { ReactNode } from 'react'
import type { MarketAsset } from './marketAssets'

/**
 * Round logo in front of a market. Crypto, the quick-pick stocks and the currencies come with the app (public/logos, see LICENSES.md
 * there); other US stocks are loaded from the jsDelivr copy of the us-stock-logos package. Whatever cannot be shown falls back to
 * the initials on a colour derived from the name, so a missing logo never leaves a gap.
 */
const base = import.meta.env.BASE_URL ?? './'

const cryptoLogos = new Set('aave ada algo apt arb atom avax axs bch bnb btc chz crv doge dot egld etc eth fil grt hbar icp inj iota jup ldo link ltc mana near op pepe pol qnt render rune sand sei shib sol sui tao theta tia trx uni vet xlm xrp xtz'.split(' '))
const stockLogos: Record<string, string> = Object.fromEntries([
  ...'AAPL MSFT NVDA AMZN GOOGL META TSLA BRK-B JPM V WMT NFLX AMD DIS KO SAP.DE DBK.DE'.split(' ').map((symbol) => [symbol, `${symbol.toLowerCase()}.webp`]),
  ...'SIE.DE DTE.DE VOW3.DE BMW.DE ADS.DE'.split(' ').map((symbol) => [symbol, `${symbol.toLowerCase()}.svg`]),
])
const usStockCdn = 'https://cdn.jsdelivr.net/npm/us-stock-logos@1.0.0/dist/webp/'
const fiat = new Set(['EUR', 'USD', 'GBP', 'CHF', 'JPY'])

type Country = 'de' | 'us' | 'eu' | 'gb' | 'jp'
const indexCountries: Record<string, Country> = { '^GDAXI': 'de', '^MDAXI': 'de', '^GSPC': 'us', '^IXIC': 'us', '^DJI': 'us', '^STOXX50E': 'eu', '^FTSE': 'gb', '^N225': 'jp' }

const brandColors: Record<string, string> = {
  ONDO: '#121212', WLD: '#111111', ENA: '#111111', BONK: '#f8a300', WIF: '#a9785c', FLOKI: '#d6a33b',
}

function fallbackColor(asset: MarketAsset) {
  const brand = brandColors[asset.symbol]
  if (brand) return brand
  let hash = 0
  for (const character of asset.symbol) hash = (hash * 31 + character.charCodeAt(0)) % 360
  return `hsl(${hash} 48% 38%)`
}

function initials(asset: MarketAsset) {
  const letters = asset.symbol.replace(/\.[A-Z]+$/, '').replace(/[^A-Za-z0-9]/g, '')
  return (letters.length > 3 ? letters.slice(0, 2) : letters).toUpperCase() || '?'
}

function Flag({ country }: { country: Country }) {
  let shapes: ReactNode
  if (country === 'de') shapes = <><rect width="24" height="8" fill="#000" /><rect y="8" width="24" height="8" fill="#dd0000" /><rect y="16" width="24" height="8" fill="#ffce00" /></>
  else if (country === 'jp') shapes = <><rect width="24" height="24" fill="#fff" /><circle cx="12" cy="12" r="5.4" fill="#bc002d" /></>
  else if (country === 'eu') shapes = <><rect width="24" height="24" fill="#003399" />{Array.from({ length: 12 }, (_, i) => <circle key={i} cx={12 + 6.4 * Math.cos((i * Math.PI) / 6)} cy={12 + 6.4 * Math.sin((i * Math.PI) / 6)} r="1.05" fill="#ffcc00" />)}</>
  else if (country === 'gb') shapes = <><rect width="24" height="24" fill="#012169" /><path d="M0 0l24 24M24 0L0 24" stroke="#fff" strokeWidth="4.5" /><path d="M0 0l24 24M24 0L0 24" stroke="#c8102e" strokeWidth="1.6" /><path d="M12 0v24M0 12h24" stroke="#fff" strokeWidth="7" /><path d="M12 0v24M0 12h24" stroke="#c8102e" strokeWidth="4" /></>
  else shapes = <><rect width="24" height="24" fill="#fff" />{[0, 2, 4, 6, 8, 10, 12].map((row) => <rect key={row} y={row * 1.85} width="24" height="0.95" fill="#b22234" />)}<rect width="11" height="10.2" fill="#3c3b6e" /><circle cx="3" cy="3" r="0.7" fill="#fff" /><circle cx="6" cy="3" r="0.7" fill="#fff" /><circle cx="9" cy="3" r="0.7" fill="#fff" /><circle cx="4.5" cy="5.6" r="0.7" fill="#fff" /><circle cx="7.5" cy="5.6" r="0.7" fill="#fff" /><circle cx="3" cy="8" r="0.7" fill="#fff" /><circle cx="6" cy="8" r="0.7" fill="#fff" /><circle cx="9" cy="8" r="0.7" fill="#fff" /></>
  return <svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">{shapes}</svg>
}

function Commodity({ yahoo }: { yahoo: string }) {
  if (yahoo === 'GC=F' || yahoo === 'SI=F') {
    const gold = yahoo === 'GC=F'
    return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect width="24" height="24" fill={gold ? '#3b2f0b' : '#2b2f36'} /><path d="M5 16.5l2.2-5h9.6l2.2 5z" fill={gold ? '#f5c542' : '#d3d7de'} /><path d="M8.2 11l1.6-3.6h4.4L15.8 11z" fill={gold ? '#ffd966' : '#eef1f5'} /></svg>
  }
  if (yahoo === 'NG=F') return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect width="24" height="24" fill="#10243f" /><path d="M12 4.5c.6 3-2.6 4.4-2.6 7.6a2.6 2.6 0 0 0 5.2.2c0-1.2-.5-2-1-2.6 2.6 1 4 3.2 4 5.3a5.6 5.6 0 0 1-11.2 0c0-4.6 4.6-6.6 5.6-10.5z" fill="#4da3ff" /></svg>
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect width="24" height="24" fill="#1f1f24" /><path d="M12 4.5c2.8 4 5 6.6 5 9.4a5 5 0 0 1-10 0c0-2.8 2.2-5.4 5-9.4z" fill="#e8e8ec" /></svg>
}

function Initials({ asset }: { asset: MarketAsset }) {
  return <span className="mk-logo-initials" style={{ background: fallbackColor(asset) }}>{initials(asset)}</span>
}

function Picture({ sources, asset, padded }: { sources: string[]; asset: MarketAsset; padded: boolean }) {
  const [failed, setFailed] = useState(0)
  if (failed >= sources.length) return <Initials asset={asset} />
  return <img key={sources[failed]} src={sources[failed]} alt="" loading="lazy" decoding="async" draggable={false} className={padded ? 'is-padded' : undefined} onError={() => setFailed((count) => count + 1)} />
}

function logoContent(asset: MarketAsset): { node: ReactNode; tone: 'full' | 'light' | 'pair' } {
  if (asset.source === 'binance') {
    const key = asset.symbol.toLowerCase()
    return { node: cryptoLogos.has(key) ? <Picture sources={[`${base}logos/crypto/${key}.svg`]} asset={asset} padded={false} /> : <Initials asset={asset} />, tone: 'full' }
  }
  const yahoo = asset.yahoo
  if (asset.group === 'index') {
    const country = indexCountries[yahoo]
    return { node: country ? <Flag country={country} /> : <Initials asset={asset} />, tone: 'full' }
  }
  if (asset.group === 'commodity' && /^(GC|SI|CL|BZ|NG)=F$/.test(yahoo)) return { node: <Commodity yahoo={yahoo} />, tone: 'full' }
  if (asset.group === 'currency') {
    const pair = /^([A-Z]{3})([A-Z]{3})=X$/.exec(yahoo)
    if (pair && fiat.has(pair[1]) && fiat.has(pair[2])) {
      return {
        node: <><img src={`${base}logos/fiat/${pair[1].toLowerCase()}.svg`} alt="" draggable={false} /><img src={`${base}logos/fiat/${pair[2].toLowerCase()}.svg`} alt="" draggable={false} /></>,
        tone: 'pair',
      }
    }
    return { node: <Initials asset={asset} />, tone: 'full' }
  }
  const sources: string[] = []
  if (stockLogos[yahoo]) sources.push(`${base}logos/stocks/${stockLogos[yahoo]}`)
  // Only plain US tickers: an exchange suffix (SAP.DE) could name another company with the same letters in the US.
  else if (/^[A-Z]{1,5}(-[A-Z])?$/.test(yahoo)) sources.push(`${usStockCdn}${yahoo}.webp`)
  return { node: sources.length > 0 ? <Picture sources={sources} asset={asset} padded /> : <Initials asset={asset} />, tone: sources.length > 0 ? 'light' : 'full' }
}

export const AssetLogo = memo(function AssetLogo({ asset, size = 40, className = '' }: { asset: MarketAsset; size?: number; className?: string }) {
  const { node, tone } = logoContent(asset)
  return <span className={`mk-logo is-${tone} ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }} aria-hidden="true">{node}</span>
}, (before, after) => before.asset.id === after.asset.id && before.size === after.size && before.className === after.className)
