import type { IndicatorId } from './marketPrefs'

/** Line colours of the indicators; they read on the light and the dark theme. */
export const indicatorColors: Record<IndicatorId, string> = {
  sma20: '#f59f00',
  sma50: '#8b7cf6',
  ema21: '#12b886',
  bollinger: '#7b8aa3',
  volume: '#7b8aa3',
  rsi: '#c084fc',
}
