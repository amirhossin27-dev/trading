import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Language } from '../../types/platform'
import type { MarketAsset } from './marketAssets'
import { AlertClient, AlertServiceError, alertIdPattern, alertServiceUrl, enableAlarmNotifications, parseAlarmTarget, supportsPush } from './alertService'
import type { AlertConfig, AlertEvent, PriceAlarm } from './alertService'
import { TradingDialog } from './TradingDialog'
import './AlarmControls.css'

const messages: Record<string, [string, string]> = {
  permission_denied: ['Mitteilungen sind nicht erlaubt. Aktiviere sie in den iPhone-Einstellungen für diese App.', 'Notifications are not allowed. Enable them in your phone settings for this app.'],
  push_not_supported: ['Öffne die App über das Home-Bildschirm-Symbol auf einem aktuellen iPhone und erlaube Mitteilungen.', 'Open the installed Home Screen app on an up-to-date iPhone and allow notifications.'],
  reload_required: ['Bitte lade die App einmal neu und aktiviere Mitteilungen erneut.', 'Reload the app once and enable notifications again.'],
  storage_unavailable: ['Der Browser kann den Gerätezugang nicht speichern. Erlaube Website-Speicher, bevor du Alarme aktivierst.', 'The browser cannot save this device connection. Allow website storage before enabling alarms.'],
  monitoring_not_ready: ['Die Hintergrundprüfung ist derzeit nicht bereit. Neue Alarme sind vorübergehend gesperrt.', 'Background monitoring is not ready. New alarms are temporarily disabled.'],
  server_not_configured: ['Der Alarmdienst wird noch eingerichtet.', 'The alarm service is still being configured.'],
  subscription_required: ['Aktiviere zuerst Mitteilungen für dieses Gerät.', 'Enable notifications for this device first.'],
  subscription_conflict: ['Diese Mitteilungen gehören zu einer anderen Geräteverbindung.', 'This subscription belongs to a different device connection.'],
  push_unavailable: ['Die Testmitteilung konnte nicht versendet werden. Bitte prüfe die Mitteilungseinstellungen und versuche es erneut.', 'The test notification could not be sent. Check notification settings and try again.'],
  unauthorized: ['Die Geräteverbindung konnte nicht bestätigt werden. Deine Alarme wurden nicht verändert.', 'This device connection could not be verified. Your alarms were not changed.'],
  alarm_limit: ['Für dieses Gerät sind bereits 100 Alarme gespeichert. Entferne zuerst einen alten Alarm.', 'This device already has 100 alarms. Remove an old alarm first.'],
  rate_limited: ['Zu viele Anfragen. Bitte warte kurz und versuche es erneut.', 'Too many requests. Wait briefly and try again.'],
}

export function AlarmControls({ asset, currency, language, serviceUrl = alertServiceUrl(), onOpen }: {
  asset: MarketAsset; currency: string; language: Language; serviceUrl?: string; onOpen: (event: AlertEvent) => void
}) {
  const de = language === 'de'
  const client = useMemo(() => { try { return serviceUrl ? new AlertClient(serviceUrl) : null } catch { return null } }, [serviceUrl])
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState<AlertConfig | null>(null)
  const [alarms, setAlarms] = useState<PriceAlarm[]>([])
  const [events, setEvents] = useState<AlertEvent[]>([])
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [target, setTarget] = useState('')
  const [direction, setDirection] = useState<'above' | 'below'>('above')
  const draftId = useRef<string | null>(null)
  const openRef = useRef(onOpen)
  const alive = useRef(true)
  useEffect(() => { openRef.current = onOpen }, [onOpen])
  useEffect(() => { draftId.current = null }, [asset.id, target, direction, currency])
  const textError = useCallback((value: unknown) => {
    const pair = messages[value instanceof AlertServiceError ? value.code : '']
    return pair?.[de ? 0 : 1] ?? (de ? 'Der Alarmdienst ist nicht erreichbar. Bitte erneut versuchen.' : 'The alarm service is unreachable. Please try again.')
  }, [de])

  const refresh = useCallback(async () => {
    if (!client) return
    const nextConfig = await client.config()
    if (!alive.current) return
    setConfig(nextConfig)
    if (client.device()) {
      const [nextAlarms, nextEvents] = await Promise.all([client.alarms(), client.events()])
      if (!alive.current) return
      setAlarms(nextAlarms.alarms)
      setEvents(nextEvents)
      setSubscribed(nextAlarms.subscriptionActive)
    }
  }, [client])

  useEffect(() => {
    alive.current = true
    let loading = false
    const load = async () => {
      if (loading || document.visibilityState === 'hidden') return
      loading = true
      try { await refresh(); if (alive.current) setError('') }
      catch (value) { if (alive.current) { setError(textError(value)); setConfig((current) => current ? { ...current, configured: false } : null) } }
      finally { loading = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', load)
    return () => { alive.current = false; clearInterval(timer); window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', load) }
  }, [refresh, textError])

  useEffect(() => {
    if (!client) return
    let cancelled = false
    const openEvent = async (id: unknown) => {
      if (typeof id !== 'string' || !alertIdPattern.test(id)) return
      try {
        const inbox = await client.events()
        if (cancelled) return
        setEvents(inbox)
        const found = inbox.find((event) => event.id === id)
        if (found) { setOpen(false); openRef.current(found) }
        else { setOpen(true); setError(de ? 'Diese Meldung ist nicht mehr verfügbar.' : 'This notification is no longer available.') }
      } catch (value) { if (!cancelled) { setOpen(true); setError(textError(value)) } }
    }
    const message = (event: MessageEvent) => { if (event.data?.type === 'price-alert:open') void openEvent(event.data.eventId) }
    navigator.serviceWorker?.addEventListener('message', message)
    const url = new URL(location.href)
    const id = url.searchParams.get('alert')
    if (id) { url.searchParams.delete('alert'); history.replaceState(history.state, '', url); void openEvent(id) }
    return () => { cancelled = true; navigator.serviceWorker?.removeEventListener('message', message) }
  }, [client, de, textError])

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (value) { setError(textError(value)) } finally { if (alive.current) setBusy(false) }
  }
  const enable = () => {
    if (!client || !config?.vapidPublicKey) return
    // Start before the first await in run: notification permission must originate from this tap.
    const enrollment = enableAlarmNotifications(client, config.vapidPublicKey)
    void run(async () => { await enrollment; await refresh() })
  }
  const create = (event: FormEvent) => {
    event.preventDefault()
    const price = parseAlarmTarget(target)
    if (!client || !price || !config?.configured || !subscribed || (typeof Notification !== 'undefined' && Notification.permission === 'denied')) return
    draftId.current ??= crypto.randomUUID()
    const id = draftId.current
    void run(async () => {
      await client.create({ id, asset, currency, direction, target: price })
      setTarget(''); draftId.current = null
      setNotice(de ? 'Alarm gespeichert.' : 'Alarm saved.')
      await refresh()
    })
  }
  const pending = events.filter((event) => !event.acknowledgedAt)
  const permissionDenied = typeof Notification !== 'undefined' && Notification.permission === 'denied'
  const canNotify = subscribed && !permissionDenied
  const historyEvents = events.filter((event) => event.acknowledgedAt).slice(0, 10)
  const bellLabel = pending.length ? (de ? `Alarme, ${pending.length} unbestätigte ${pending.length === 1 ? 'Meldung' : 'Meldungen'}` : `Alerts, ${pending.length} unacknowledged`) : (de ? 'Alarme' : 'Alerts')
  const price = (value: number) => new Intl.NumberFormat(de ? 'de-DE' : 'en-US', { maximumFractionDigits: 8 }).format(value)
  const date = (value: string) => new Date(value).toLocaleString(de ? 'de-DE' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })
  const openTarget = (event: AlertEvent) => { setOpen(false); onOpen(event) }
  const showEvent = (event: AlertEvent) => <article className="alarm-event" key={event.id}>
    <strong>{event.asset.symbol} · {price(event.target)} {event.currency}</strong>
    <p>{de ? 'Beobachtet' : 'Observed'}: {price(event.observedPrice)} {event.currency} · {date(event.triggeredAt)}</p>
    <div className="alarm-row"><button type="button" aria-label={de ? `${event.asset.symbol} bei ${price(event.target)} ${event.currency} im Chart öffnen` : `Open ${event.asset.symbol} at ${price(event.target)} ${event.currency} in chart`} onClick={() => openTarget(event)}>{de ? 'Im Chart öffnen · 1W' : 'Open chart · 1W'}</button>
      {!event.acknowledgedAt && <button type="button" disabled={busy} onClick={() => void run(async () => { await client!.acknowledge(event.id); await refresh() })}>{de ? 'Meldung bestätigen' : 'Acknowledge'}</button>}
      {event.acknowledgedAt && <span>{de ? 'Bestätigt' : 'Acknowledged'}</span>}</div>
  </article>

  return <>
    <button type="button" className={`mk-action alarm-trigger ${pending.length ? 'has-alerts' : ''}`} aria-label={bellLabel} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(true); if (client) void run(refresh) }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      <span className="alarm-trigger-label">{de ? 'Alarme' : 'Alerts'}</span>{pending.length > 0 && <span className="alarm-count" aria-hidden="true">{pending.length > 99 ? '99+' : pending.length}</span>}
    </button>
    <TradingDialog open={open} onClose={() => setOpen(false)} label={de ? 'Kursalarme' : 'Price alerts'} closeLabel={de ? 'Alarme schließen' : 'Close alerts'} className="alarm-dialog">
      <h2>{de ? 'Kursalarme' : 'Price alerts'}</h2>
      {error && <p role="alert" className="alarm-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!client ? <p>{de ? 'Der Alarmdienst ist noch nicht verbunden.' : 'The alert service is not connected yet.'}</p> : <>
        {pending.length > 0 && <section aria-label={de ? 'Neue Meldungen' : 'New notifications'}><h3>{de ? 'Noch zu bestätigen' : 'Awaiting acknowledgement'}</h3>{pending.map(showEvent)}</section>}
        <section className="alarm-connection">
          <h3>{de ? 'Mitteilungen auf diesem Gerät' : 'Notifications on this device'}</h3>
          <p>{permissionDenied ? messages.permission_denied[de ? 0 : 1] : subscribed ? (de ? 'Mitteilungen sind für dieses Gerät verbunden.' : 'Notifications are connected for this device.') : (de ? 'Erlaube Mitteilungen, damit Alarme auch bei geschlossener App erscheinen.' : 'Allow notifications to receive alerts while the app is closed.')}</p>
          {!subscribed && <p>{de ? 'Auf dem iPhone: App über das Home-Bildschirm-Symbol öffnen.' : 'On iPhone: open the app from its Home Screen icon.'}</p>}
          <div className="alarm-row"><button type="button" disabled={busy || !config?.vapidPublicKey || !supportsPush()} onClick={enable}>{subscribed ? (de ? 'Mitteilungen neu verbinden' : 'Reconnect notifications') : (de ? 'Mitteilungen aktivieren' : 'Enable notifications')}</button>
            {subscribed && <button type="button" disabled={busy} onClick={() => void run(async () => { await client.testPush(); setNotice(de ? 'Testmitteilung wurde zum Versand angenommen.' : 'Test notification accepted for delivery.') })}>{de ? 'Testmitteilung senden' : 'Send test notification'}</button>}</div>
        </section>
        {config && !config.configured && <p className="alarm-error">{messages[config.code === 'server_not_configured' ? 'server_not_configured' : 'monitoring_not_ready'][de ? 0 : 1]}</p>}
        {config?.lastCheckedAt && <p className="alarm-small">{de ? 'Letzter abgeschlossener Prüflauf' : 'Last completed monitoring cycle'}: {date(config.lastCheckedAt)}</p>}
        <form className="alarm-form" onSubmit={create}>
          <h3>{de ? 'Neuer Alarm für' : 'New alert for'} {asset.symbol}</h3>
          <label>{de ? 'Auslösen bei' : 'Trigger at'}<select value={direction} onChange={(event) => setDirection(event.target.value as 'above' | 'below')}><option value="above">{de ? 'Ziel erreicht oder überschritten' : 'Target reached or exceeded'}</option><option value="below">{de ? 'Ziel erreicht oder unterschritten' : 'Target reached or undercut'}</option></select></label>
          <label>{de ? `Zielkurs in ${currency}` : `Target price in ${currency}`}<input inputMode="decimal" autoComplete="off" value={target} placeholder="0,00" required onChange={(event) => setTarget(event.target.value)} /></label>
          <button type="submit" disabled={busy || !config?.configured || !canNotify || !parseAlarmTarget(target) || !/^[A-Z]{3}$/.test(currency)}>{de ? 'Alarm speichern' : 'Save alert'}</button>
          <p className="alarm-small">{de ? 'Prüfung ungefähr jede Minute. Marktdaten und Zustellung können verzögert sein. Ein Alarm löst einmal aus.' : 'Checks approximately every minute. Market data and delivery may be delayed. Each alarm triggers once.'}</p>
        </form>
        {alarms.length > 0 && <section><h3>{de ? 'Gespeicherte Alarme' : 'Saved alerts'} ({alarms.length}/100)</h3>{alarms.map((alarm) => <article className="alarm-event" key={alarm.id}>
          <strong>{alarm.asset.symbol} {alarm.direction === 'above' ? '≥' : '≤'} {price(alarm.target)} {alarm.currency}</strong>
          <p>{alarm.status === 'active' ? (de ? 'Aktiv' : 'Active') : alarm.status === 'triggered' ? (de ? 'Ausgelöst · Meldung bestätigen' : 'Triggered · acknowledge notification') : (de ? 'Bestätigt · pausiert' : 'Acknowledged · paused')}{alarm.lastCheckedAt ? ` · ${date(alarm.lastCheckedAt)}` : ''}</p>
          {alarm.lastError && <p className="alarm-error">{alarm.lastError === 'currency_mismatch' ? (de ? 'Die Währung der Kursquelle stimmt nicht mit dem Alarm überein. Bitte neu anlegen.' : 'The market currency differs from the alert. Please recreate it.') : (de ? 'Keine aktuellen Kursdaten. Dieser Alarm wartet auf eine frische Kursbeobachtung.' : 'No current market data. This alert is waiting for a fresh observation.')}</p>}
          <div className="alarm-row">{alarm.status === 'acked' && <button type="button" disabled={busy || !config?.configured || !canNotify} onClick={() => void run(async () => { await client.rearm(alarm.id); await refresh() })}>{de ? 'Erneut aktivieren' : 'Rearm'}</button>}
            {alarm.status !== 'triggered' && <button type="button" disabled={busy} aria-label={de ? `Alarm für ${alarm.asset.symbol} löschen` : `Delete alert for ${alarm.asset.symbol}`} onClick={() => void run(async () => { await client.remove(alarm.id); await refresh() })}>{de ? 'Löschen' : 'Delete'}</button>}</div>
        </article>)}</section>}
        {historyEvents.length > 0 && <details><summary>{de ? 'Letzte bestätigte Meldungen' : 'Recent acknowledged notifications'}</summary>{historyEvents.map(showEvent)}</details>}
      </>}
    </TradingDialog>
  </>
}
