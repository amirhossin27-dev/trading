import { priceDigits } from './chartMath'

/** Currency format for a price; small prices get more decimals. Unknown currency codes fall back to a plain number. */
export function moneyFormatter(locale: string, currency: string, reference: number, fixedDigits?: number) {
  const digits = fixedDigits ?? priceDigits(reference)
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits })
  } catch {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  }
}
