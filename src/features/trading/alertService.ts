import { assetById, assetGroups } from './marketAssets'
import type { MarketAsset } from './marketAssets'

export interface AlertConfig {
  configured: boolean
  vapidPublicKey: string | null
  checkIntervalSeconds: number
  lastCheckedAt: string | null
  code?: string | null
}
export interface PriceAlarm {
  id: string
  asset: MarketAsset
  direction: 'above' | 'below'
  target: number
  currency: string
  status: 'active' | 'triggered' | 'acked'
  createdAt: string
  lastCheckedAt: string | null
  lastPrice: number | null
  lastError?: 'price_unavailable_or_stale' | 'currency_mismatch' | null
}
export interface DeviceCredentials { deviceId: string; deviceToken: string }
export interface CreateAlarm { id: string; asset: MarketAsset; direction: 'above' | 'below'; target: number; currency: string }

export interface AlertEvent {
  id: string
  alarmId: string
  asset: MarketAsset
  target: number
  currency: string
  observedPrice: number
  triggeredAt: string
  acknowledgedAt: string | null
}

export const alertIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e15
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

function readAsset(value: unknown): MarketAsset | null {
  if (!record(value) || typeof value.id !== 'string') return null
  const known = assetById(value.id)
  if (known) return known
  if (value.source !== 'yahoo' || typeof value.yahoo !== 'string' || !/^[A-Z0-9.^=_-]{1,24}$/i.test(value.yahoo) || value.id !== `yf:${value.yahoo}`) return null
  if (typeof value.symbol !== 'string' || !value.symbol || value.symbol.length > 24 || typeof value.name !== 'string' || value.name.length > 80 || !assetGroups.includes(value.group as never)) return null
  return { id: value.id, source: 'yahoo', yahoo: value.yahoo, symbol: value.symbol, name: value.name, group: value.group as MarketAsset['group'] }
}

export function readAlertEvent(value: unknown): AlertEvent | null {
  if (!record(value) || typeof value.id !== 'string' || !alertIdPattern.test(value.id) || typeof value.alarmId !== 'string' || !alertIdPattern.test(value.alarmId)) return null
  const asset = readAsset(value.asset)
  if (!asset || !positive(value.target) || !positive(value.observedPrice) || typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency) || !timestamp(value.triggeredAt) || (value.acknowledgedAt !== null && !timestamp(value.acknowledgedAt))) return null
  return { id: value.id, alarmId: value.alarmId, asset, target: value.target, observedPrice: value.observedPrice, currency: value.currency, triggeredAt: value.triggeredAt, acknowledgedAt: value.acknowledgedAt as string | null }
}

export function parseAlarmTarget(value: string): number | null {
  const text = value.trim()
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) return null
  const target = Number(text.replace(',', '.'))
  return positive(target) ? target : null
}

export class AlertServiceError extends Error {
  code: string
  constructor(code: string) { super(code); this.code = code }
}

export function alertServiceUrl(): string { return window.APP_CONFIG?.alertServiceUrl ?? import.meta.env.VITE_ALERT_SERVICE_URL ?? '' }

export class AlertClient {
  readonly base: string
  private readonly storageKey: string
  private pendingRegistration: Promise<DeviceCredentials> | null = null
  constructor(base: string) {
    const url = new URL(base)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new AlertServiceError('invalid_service_url')
    this.base = url.href.replace(/\/$/, '')
    this.storageKey = `trading.alert-device.v1:${this.base}`
  }
  device(): DeviceCredentials | null {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(this.storageKey) ?? 'null')
      if (record(value) && typeof value.deviceId === 'string' && alertIdPattern.test(value.deviceId) && typeof value.deviceToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.deviceToken)) return { deviceId: value.deviceId, deviceToken: value.deviceToken }
    } catch { /* No identity until browser storage works. */ }
    return null
  }
  private async request<T>(path: string, method = 'GET', body?: unknown, publicRequest = false): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (!publicRequest) {
      const device = this.device()
      if (!device) throw new AlertServiceError('device_required')
      headers['X-Device-Id'] = device.deviceId
      headers['X-Device-Token'] = device.deviceToken
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal })
      const result = await response.json()
      if (!response.ok) throw new AlertServiceError(typeof result.code === 'string' ? result.code : 'service_unavailable')
      return result as T
    } finally { clearTimeout(timer) }
  }
  async config(): Promise<AlertConfig> {
    const value = await this.request<AlertConfig>('/config', 'GET', undefined, true)
    if (typeof value.configured !== 'boolean') throw new AlertServiceError('invalid_response')
    return value
  }
  async register(): Promise<DeviceCredentials> {
    const existing = this.device()
    if (existing) return existing
    if (this.pendingRegistration) return this.pendingRegistration
    this.pendingRegistration = (async () => {
      try {
        const probeKey = `${this.storageKey}:probe`
        localStorage.setItem(probeKey, '1')
        if (localStorage.getItem(probeKey) !== '1') throw new Error('blocked')
        localStorage.removeItem(probeKey)
      } catch { throw new AlertServiceError('storage_unavailable') }
      const value = await this.request<DeviceCredentials>('/register', 'POST', {}, true)
      if (!value || !alertIdPattern.test(value.deviceId) || !/^[A-Za-z0-9_-]{43}$/.test(value.deviceToken)) throw new AlertServiceError('invalid_response')
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(value))
        if (!this.device()) throw new Error('blocked')
      } catch { throw new AlertServiceError('storage_unavailable') }
      return value
    })()
    try { return await this.pendingRegistration } finally { this.pendingRegistration = null }
  }
  async events(): Promise<AlertEvent[]> {
    const value = await this.request<{ events: unknown[] }>('/events')
    if (!Array.isArray(value.events)) throw new AlertServiceError('invalid_response')
    return value.events.map(readAlertEvent).filter((event): event is AlertEvent => event !== null)
  }
  async alarms(): Promise<{ alarms: PriceAlarm[]; lastCheckedAt: string | null; subscriptionActive: boolean }> { return this.request('/alarms') }
  async create(value: CreateAlarm): Promise<PriceAlarm> { return (await this.request<{ alarm: PriceAlarm }>('/alarms', 'POST', value)).alarm }
  async acknowledge(eventId: string): Promise<AlertEvent> { return (await this.request<{ event: AlertEvent }>('/ack', 'POST', { eventId })).event }
  async remove(id: string): Promise<void> { await this.request(`/alarms/${encodeURIComponent(id)}`, 'DELETE') }
  async rearm(id: string): Promise<PriceAlarm> { return (await this.request<{ alarm: PriceAlarm }>(`/alarms/${encodeURIComponent(id)}/rearm`, 'POST', {})).alarm }
  async subscribe(subscription: PushSubscriptionJSON): Promise<void> { await this.request('/subscribe', 'POST', { subscription }) }
  async testPush(): Promise<void> { await this.request('/test-push', 'POST', {}) }
}

export function supportsPush(): boolean { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext }

/** Called directly by a button: iOS requires the permission prompt to start in the user's gesture. */
export async function enableAlarmNotifications(client: AlertClient, vapidPublicKey: string): Promise<void> {
  if (!supportsPush()) throw new AlertServiceError('push_not_supported')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new AlertServiceError('permission_denied')
  await client.register()
  const registration = await navigator.serviceWorker.getRegistration(new URL(import.meta.env.BASE_URL, location.href).href)
  if (!registration?.active) throw new AlertServiceError('reload_required')
  const binary = atob(vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/'))
  const key = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  let subscription = await registration.pushManager.getSubscription()
  const existingKey = subscription?.options.applicationServerKey
  if (subscription && existingKey && (existingKey.byteLength !== key.length || new Uint8Array(existingKey).some((byte, index) => byte !== key[index]))) {
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  await client.subscribe(subscription.toJSON())
}
