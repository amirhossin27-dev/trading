// Shared, dependency-free rules run in Node tests and in the Deno Edge Function.
export class InputError extends Error {
  constructor(message, code = 'invalid_input', status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const price = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e15
function text(value, max, pattern) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || (pattern && !pattern.test(value))) throw new InputError('Invalid text field.')
  return value
}

export function base64urlBytes(value, length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length !== Math.ceil(length * 4 / 3)) throw new InputError('Invalid encoded key.')
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0))
  if (bytes.length !== length || btoa(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== value) throw new InputError('Invalid encoded key.')
  return bytes
}

export function validateDeviceCredentials(deviceId, deviceToken) {
  if (typeof deviceId !== 'string' || !UUID.test(deviceId)) throw new InputError('Device authentication required.', 'unauthorized', 401)
  try { base64urlBytes(deviceToken, 32) } catch { throw new InputError('Device authentication required.', 'unauthorized', 401) }
  return { deviceId, deviceToken }
}

export function validateAlarmInput(value) {
  if (!object(value) || !object(value.asset) || !price(value.target) || !['above', 'below'].includes(value.direction)) throw new InputError('Send a positive target and an above/below direction.')
  if (value.id !== undefined && (typeof value.id !== 'string' || !UUID.test(value.id))) throw new InputError('Invalid alarm id.')
  const a = value.asset
  const common = { id: text(a.id, 80, /^[a-zA-Z0-9:^=._-]+$/), source: a.source, symbol: text(a.symbol, 40), name: text(a.name, 120), group: a.group }
  if (!['stock', 'index', 'currency', 'commodity', 'crypto'].includes(a.group)) throw new InputError('Invalid asset group.')
  let asset
  if (a.source === 'binance') {
    const pair = text(a.pair, 24, /^[A-Z0-9]{2,20}USDT$/)
    if (a.group !== 'crypto' || !/^[a-z0-9-]{1,64}$/.test(a.id)) throw new InputError('Invalid crypto asset.')
    asset = { ...common, pair, coingecko: text(a.coingecko, 100, /^[a-z0-9-]+$/) }
    if (value.currency !== 'USD') throw new InputError('Crypto alarm prices use USD/USDT.')
  } else if (a.source === 'yahoo') {
    const yahoo = text(a.yahoo, 40, /^[A-Z0-9^=._-]+$/)
    if (a.id !== `yf:${yahoo}` || a.group === 'crypto') throw new InputError('Invalid Yahoo asset identity.')
    asset = { ...common, yahoo }
  } else throw new InputError('Unsupported data source.')
  return { id: value.id, asset, target: value.target, currency: text(value.currency, 8, /^[A-Za-z]{3,8}$/), direction: value.direction }
}

export function validatePushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 4096) throw new InputError('Invalid push endpoint.')
  let url
  try { url = new URL(endpoint) } catch { throw new InputError('Invalid push endpoint.') }
  // Exact provider hosts prevent user-supplied subscription URLs becoming SSRF.
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.pathname === '/' || !['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'].includes(url.hostname)) throw new InputError('Unsupported push endpoint.')
  return url.href
}

export function validateSubscription(value, now = Date.now()) {
  if (!object(value) || !object(value.keys)) throw new InputError('Invalid push subscription.')
  const endpoint = validatePushEndpoint(value.endpoint)
  const key = base64urlBytes(value.keys.p256dh, 65)
  base64urlBytes(value.keys.auth, 16)
  if (key[0] !== 4) throw new InputError('Push encryption key must be an uncompressed P-256 point.')
  const expirationTime = value.expirationTime ?? null
  if (expirationTime !== null && (typeof expirationTime !== 'number' || !Number.isFinite(expirationTime) || expirationTime <= now)) throw new InputError('Push subscription has expired.')
  return { endpoint, expirationTime, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } }
}

export function isFreshObservation(quote, now = Date.now()) {
  return !!quote && price(quote.price) && typeof quote.observedAt === 'number' && Number.isFinite(quote.observedAt)
    && typeof quote.maxAgeMs === 'number' && quote.maxAgeMs > 0 && quote.maxAgeMs <= 1_200_000
    && quote.observedAt <= now + 30_000 && quote.observedAt >= now - quote.maxAgeMs
}

export function evaluateAlarm(alarm, quote, now = Date.now()) {
  if (alarm.status !== 'active' || !isFreshObservation(quote, now) || quote.currency !== alarm.currency || !price(alarm.target)) return false
  const previous = alarm.lastPrice ?? alarm.last_price ?? null
  if (alarm.direction === 'above') return quote.price >= alarm.target && (previous === null || previous < alarm.target)
  if (alarm.direction === 'below') return quote.price <= alarm.target && (previous === null || previous > alarm.target)
  return false
}

export function notificationPayload(event) {
  return { type: 'price-alert', eventId: event.id, asset: event.asset, target: Number(event.target), currency: event.currency, observedPrice: Number(event.observed_price), triggeredAt: event.triggered_at, range: '1W', mode: 'candles' }
}

export function alarmDto(row) {
  return { id: row.id, asset: row.asset, direction: row.direction, target: Number(row.target), currency: row.currency, status: row.status, createdAt: row.created_at, lastCheckedAt: row.last_checked_at, lastPrice: row.last_price === null ? null : Number(row.last_price), lastError: row.last_error ?? null }
}

export function eventDto(row) {
  return { id: row.id, alarmId: row.alarm_id, asset: row.asset, target: Number(row.target), currency: row.currency, observedPrice: Number(row.observed_price), triggeredAt: row.triggered_at, acknowledgedAt: row.acknowledged_at, deliveryStatus: row.delivery_status }
}
