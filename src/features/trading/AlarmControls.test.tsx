import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AlarmControls } from './AlarmControls'
import { AlertClient } from './alertService'
import { assetById } from './marketAssets'

const base = 'https://test.supabase.co/functions/v1/trading-alerts'
const id = 'ef218492-b23e-4c59-913a-f4ab522fa6b9'
const asset = assetById('hbar')!
const event = { id, alarmId: id, asset, target: 0.2, currency: 'USD', observedPrice: 0.21, triggeredAt: '2026-11-16T12:00:00Z', acknowledgedAt: null as string | null }
let events = [event]
let configured = true
let subscriptionActive = true
let created: unknown[]
let alarmRows: unknown[] = []

beforeEach(async () => {
  localStorage.clear(); events = [{ ...event, acknowledgedAt: null }]; configured = true; subscriptionActive = true; created = []; alarmRows = []
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/register')) return Response.json({ deviceId: id, deviceToken: 'a'.repeat(43) })
    if (url.endsWith('/config')) return Response.json({ configured, vapidPublicKey: 'key', lastCheckedAt: new Date().toISOString(), checkIntervalSeconds: 60 })
    if (url.endsWith('/ack')) { events = events.map((value) => ({ ...value, acknowledgedAt: new Date().toISOString() })); return Response.json({ event: events[0] }) }
    if (url.endsWith('/events')) return Response.json({ events })
    if (url.endsWith('/alarms') && init?.method === 'POST') { created.push(JSON.parse(String(init.body))); return Response.json({ alarm: { ...created[0] as object, status: 'active' } }) }
    if (url.endsWith('/alarms')) return Response.json({ alarms: alarmRows, subscriptionActive, lastCheckedAt: new Date().toISOString() })
    return new Response('not found', { status: 404 })
  }))
  await new AlertClient(base).register()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('keeps the red bell until explicit acknowledgement, even after opening the target chart', async () => {
  const onOpen = vi.fn()
  render(<AlarmControls asset={asset} currency="USD" language="de" serviceUrl={base} onOpen={onOpen} />)
  const bell = await screen.findByRole('button', { name: 'Alarme, 1 unbestätigte Meldung' })
  fireEvent.click(bell)
  fireEvent.click(screen.getByRole('button', { name: 'HBAR bei 0,2 USD im Chart öffnen' }))
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id, target: 0.2 }))
  expect(screen.getByRole('button', { name: 'Alarme, 1 unbestätigte Meldung' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Alarme, 1 unbestätigte Meldung' }))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Meldung bestätigen' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Meldung bestätigen' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Alarme' })).toBeTruthy())
})

it('does not offer active monitoring while the server heartbeat is missing', async () => {
  configured = false
  render(<AlarmControls asset={asset} currency="USD" language="de" serviceUrl={base} onOpen={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Alarme' }))
  await screen.findByText('Die Hintergrundprüfung ist derzeit nicht bereit. Neue Alarme sind vorübergehend gesperrt.')
  expect((screen.getByRole('button', { name: 'Alarm speichern' }) as HTMLButtonElement).disabled).toBe(true)
})

it('stores a decimal comma target in the displayed currency only after push enrollment', async () => {
  render(<AlarmControls asset={asset} currency="USD" language="de" serviceUrl={base} onOpen={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Alarme' }))
  await screen.findByText('Mitteilungen sind für dieses Gerät verbunden.')
  fireEvent.change(screen.getByLabelText('Zielkurs in USD'), { target: { value: '0,125' } })
  fireEvent.click(screen.getByRole('button', { name: 'Alarm speichern' }))
  await waitFor(() => expect(created).toHaveLength(1))
  expect(created[0]).toMatchObject({ target: 0.125, currency: 'USD', direction: 'above', asset: { id: 'hbar' } })
})

it('shows setup instructions without claiming background alarms work when there is no service', () => {
  render(<AlarmControls asset={asset} currency="USD" language="de" serviceUrl="" onOpen={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Alarme' }))
  expect(screen.getByText('Der Alarmdienst ist noch nicht verbunden.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Alarm speichern' })).toBeNull()
})

it('shows stale market data even while the background worker itself is healthy', async () => {
  alarmRows = [{ id, asset, target: 0.2, currency: 'USD', direction: 'above', status: 'active', lastPrice: null, lastCheckedAt: new Date().toISOString(), lastError: 'price_unavailable_or_stale' }]
  render(<AlarmControls asset={asset} currency="USD" language="de" serviceUrl={base} onOpen={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Alarme' }))
  expect(await screen.findByText('Keine aktuellen Kursdaten. Dieser Alarm wartet auf eine frische Kursbeobachtung.')).toBeTruthy()
})

it('blocks new alarms when notifications were revoked in the phone settings', async () => {
  vi.stubGlobal('Notification', { permission: 'denied' })
  render(<AlarmControls asset={asset} currency="USD" language="de" serviceUrl={base} onOpen={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Alarme' }))
  await screen.findByText('Mitteilungen sind nicht erlaubt. Aktiviere sie in den iPhone-Einstellungen für diese App.')
  fireEvent.change(screen.getByLabelText('Zielkurs in USD'), { target: { value: '0,125' } })
  expect((screen.getByRole('button', { name: 'Alarm speichern' }) as HTMLButtonElement).disabled).toBe(true)
})
