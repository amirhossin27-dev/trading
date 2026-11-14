/**
 * Markets that can be opened as tab. Crypto comes straight from Binance (CoinGecko as fallback), everything else from Yahoo
 * Finance through the platform API. The lists below are the quick picks; every other stock, fund or index is found with the search
 * and then remembered in the browser (see `marketPrefs.ts`).
 */
export type AssetGroup = 'stock' | 'index' | 'currency' | 'commodity' | 'crypto'

interface BaseAsset {
  /** Stable id, also stored in the browser. */
  id: string
  /** Short name shown in the tab. */
  symbol: string
  name: string
  group: AssetGroup
}

export interface CryptoAsset extends BaseAsset {
  source: 'binance'
  /** Binance spot pair in USDT. */
  pair: string
  coingecko: string
}

export interface YahooAsset extends BaseAsset {
  source: 'yahoo'
  /** Symbol at Yahoo Finance, e.g. `AAPL`, `SAP.DE`, `^GDAXI`, `EURUSD=X`, `GC=F`. */
  yahoo: string
}

export type MarketAsset = CryptoAsset | YahooAsset

/** What the browser remembers about a market that is not one of the quick picks. */
export interface StoredAsset {
  symbol: string
  name: string
  group: AssetGroup
}

type CryptoRow = [symbol: string, name: string, coingecko: string]
type YahooRow = [yahoo: string, symbol: string, name: string]

const crypto: CryptoRow[] = [
  ['HBAR', 'Hedera', 'hedera-hashgraph'],
  ['BTC', 'Bitcoin', 'bitcoin'],
  ['ETH', 'Ethereum', 'ethereum'],
  ['BNB', 'BNB', 'binancecoin'],
  ['SOL', 'Solana', 'solana'],
  ['XRP', 'XRP', 'ripple'],
  ['ADA', 'Cardano', 'cardano'],
  ['DOGE', 'Dogecoin', 'dogecoin'],
  ['TRX', 'TRON', 'tron'],
  ['AVAX', 'Avalanche', 'avalanche-2'],
  ['LINK', 'Chainlink', 'chainlink'],
  ['DOT', 'Polkadot', 'polkadot'],
  ['LTC', 'Litecoin', 'litecoin'],
  ['BCH', 'Bitcoin Cash', 'bitcoin-cash'],
  ['XLM', 'Stellar', 'stellar'],
  ['SUI', 'Sui', 'sui'],
  ['SHIB', 'Shiba Inu', 'shiba-inu'],
  ['UNI', 'Uniswap', 'uniswap'],
  ['ATOM', 'Cosmos', 'cosmos'],
  ['NEAR', 'NEAR Protocol', 'near'],
  ['APT', 'Aptos', 'aptos'],
  ['ICP', 'Internet Computer', 'internet-computer'],
  ['ETC', 'Ethereum Classic', 'ethereum-classic'],
  ['FIL', 'Filecoin', 'filecoin'],
  ['ARB', 'Arbitrum', 'arbitrum'],
  ['OP', 'Optimism', 'optimism'],
  ['INJ', 'Injective', 'injective-protocol'],
  ['AAVE', 'Aave', 'aave'],
  ['ALGO', 'Algorand', 'algorand'],
  ['VET', 'VeChain', 'vechain'],
  ['POL', 'Polygon', 'polygon-ecosystem-token'],
  ['PEPE', 'Pepe', 'pepe'],
  ['RENDER', 'Render', 'render-token'],
  ['QNT', 'Quant', 'quant-network'],
  ['IOTA', 'IOTA', 'iota'],
  ['EGLD', 'MultiversX', 'elrond-erd-2'],
  ['XTZ', 'Tezos', 'tezos'],
  ['SAND', 'The Sandbox', 'the-sandbox'],
  ['MANA', 'Decentraland', 'decentraland'],
  ['GRT', 'The Graph', 'the-graph'],
  ['CRV', 'Curve', 'curve-dao-token'],
  ['TAO', 'Bittensor', 'bittensor'],
  ['ONDO', 'Ondo', 'ondo-finance'],
  ['SEI', 'Sei', 'sei-network'],
  ['TIA', 'Celestia', 'celestia'],
  ['WLD', 'Worldcoin', 'worldcoin-wld'],
  ['JUP', 'Jupiter', 'jupiter-exchange-solana'],
  ['ENA', 'Ethena', 'ethena'],
  ['BONK', 'Bonk', 'bonk'],
  ['WIF', 'dogwifhat', 'dogwifcoin'],
  ['FLOKI', 'Floki', 'floki'],
  ['THETA', 'Theta Network', 'theta-token'],
  ['AXS', 'Axie Infinity', 'axie-infinity'],
  ['CHZ', 'Chiliz', 'chiliz'],
  ['LDO', 'Lido DAO', 'lido-dao'],
  ['RUNE', 'THORChain', 'thorchain'],
]

const stocks: YahooRow[] = [
  ['AAPL', 'AAPL', 'Apple'],
  ['MSFT', 'MSFT', 'Microsoft'],
  ['NVDA', 'NVDA', 'NVIDIA'],
  ['AMZN', 'AMZN', 'Amazon'],
  ['GOOGL', 'GOOGL', 'Alphabet (Google)'],
  ['META', 'META', 'Meta Platforms'],
  ['TSLA', 'TSLA', 'Tesla'],
  ['BRK-B', 'BRK-B', 'Berkshire Hathaway'],
  ['JPM', 'JPM', 'JPMorgan Chase'],
  ['V', 'V', 'Visa'],
  ['WMT', 'WMT', 'Walmart'],
  ['NFLX', 'NFLX', 'Netflix'],
  ['AMD', 'AMD', 'AMD'],
  ['DIS', 'DIS', 'Walt Disney'],
  ['KO', 'KO', 'Coca-Cola'],
  ['SAP.DE', 'SAP.DE', 'SAP'],
  ['SIE.DE', 'SIE.DE', 'Siemens'],
  ['ALV.DE', 'ALV.DE', 'Allianz'],
  ['DTE.DE', 'DTE.DE', 'Deutsche Telekom'],
  ['VOW3.DE', 'VOW3.DE', 'Volkswagen Vz.'],
  ['BMW.DE', 'BMW.DE', 'BMW'],
  ['MBG.DE', 'MBG.DE', 'Mercedes-Benz'],
  ['BAS.DE', 'BAS.DE', 'BASF'],
  ['ADS.DE', 'ADS.DE', 'Adidas'],
  ['DBK.DE', 'DBK.DE', 'Deutsche Bank'],
  ['IFX.DE', 'IFX.DE', 'Infineon'],
  ['MUV2.DE', 'MUV2.DE', 'Münchener Rück'],
  ['RWE.DE', 'RWE.DE', 'RWE'],
]

const indices: YahooRow[] = [
  ['^GDAXI', 'DAX', 'DAX'],
  ['^GSPC', 'S&P 500', 'S&P 500'],
  ['^IXIC', 'Nasdaq', 'Nasdaq Composite'],
  ['^DJI', 'Dow Jones', 'Dow Jones Industrial Average'],
  ['^STOXX50E', 'STOXX 50', 'EURO STOXX 50'],
  ['^FTSE', 'FTSE 100', 'FTSE 100'],
  ['^N225', 'Nikkei', 'Nikkei 225'],
  ['^MDAXI', 'MDAX', 'MDAX'],
]

const currencies: YahooRow[] = [
  ['EURUSD=X', 'EUR/USD', 'Euro / US dollar'],
  ['EURGBP=X', 'EUR/GBP', 'Euro / British pound'],
  ['EURCHF=X', 'EUR/CHF', 'Euro / Swiss franc'],
  ['USDJPY=X', 'USD/JPY', 'US dollar / Japanese yen'],
  ['GBPUSD=X', 'GBP/USD', 'British pound / US dollar'],
]

const commodities: YahooRow[] = [
  ['GC=F', 'Gold', 'Gold'],
  ['SI=F', 'Silver', 'Silver'],
  ['CL=F', 'WTI oil', 'Crude oil (WTI)'],
  ['BZ=F', 'Brent oil', 'Crude oil (Brent)'],
  ['NG=F', 'Gas', 'Natural gas'],
]

export function yahooId(symbol: string) {
  return `yf:${symbol.toUpperCase()}`
}

export function yahooAsset(yahoo: string, symbol: string, name: string, group: AssetGroup): YahooAsset {
  return { id: yahooId(yahoo), source: 'yahoo', yahoo: yahoo.toUpperCase(), symbol, name, group }
}

function fromRows(rows: YahooRow[], group: AssetGroup) {
  return rows.map(([yahoo, symbol, name]) => yahooAsset(yahoo, symbol, name, group))
}

export const marketAssets: MarketAsset[] = [
  ...fromRows(stocks, 'stock'),
  ...fromRows(indices, 'index'),
  ...fromRows(currencies, 'currency'),
  ...fromRows(commodities, 'commodity'),
  ...crypto.map(([symbol, name, coingecko]): CryptoAsset => ({
    id: symbol.toLowerCase(), source: 'binance', symbol, name, group: 'crypto', pair: `${symbol}USDT`, coingecko,
  })),
]

export const defaultAssetId = 'hbar'

const byId = new Map(marketAssets.map((asset) => [asset.id, asset]))

/** A quick pick, or a market the user found with the search (then `extras` knows its name). */
export function assetById(id: string, extras: Record<string, StoredAsset> = {}): MarketAsset | undefined {
  const known = byId.get(id)
  if (known) return known
  const stored = extras[id]
  return stored && id.startsWith('yf:') ? yahooAsset(id.slice(3), stored.symbol, stored.name, stored.group) : undefined
}

export function searchAssets(query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return marketAssets
  return marketAssets.filter((asset) => asset.symbol.toLowerCase().includes(needle) || asset.name.toLowerCase().includes(needle))
}

export const assetGroups: AssetGroup[] = ['stock', 'index', 'currency', 'commodity', 'crypto']

/** Number of decimals for prices of one kind of market; `undefined` lets the price decide. */
export function assetDigits(asset: MarketAsset, reference: number) {
  if (asset.group !== 'currency') return undefined
  return reference >= 20 ? 3 : 5
}
