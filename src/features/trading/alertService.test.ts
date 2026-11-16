import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AlertClient, readAlertEvent, parseAlarmTarget } from './alertService'

const base = 'https://project.supabase.co/functions/v1/trading-alerts'
const device = { deviceId: 'ef218492-b23e-4c59-913a-f4ab522fa6b9', deviceToken: 'a'.repeat(43) }
const asset = { id: 'hbar', source: 'binance', symbol: 'HBAR', name: 'Hedera', group: 'crypto', pair: 'HBARUSDT', coingecko: 'hedera-hashgraph' }
const event = { id: device.deviceId, alarmId: device.deviceId, asset, target: 0.2, currency: 'USD', observedPrice: 0.21, triggeredAt: '2026-11-16T12:00:00Z', acknowledgedAt: null }

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('alarm client', () => {
  it('keeps device credentials across reloads and sends them only to the configured service', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(device)))
    const first = new AlertClient(base)
    await first.register()
    const reloaded = new AlertClient(base)
    expect(reloaded.device()).toEqual(device)
    expect(new AlertClient('https://another.supabase.co/functions/v1/trading-alerts').device()).toBeNull()
    const requests: Request[] = []
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      requests.push(new Request(input, init))
      return Response.json({ events: [event] })
    }))
    expect(await reloaded.events()).toEqual([event])
    expect(requests[0].headers.get('X-Device-Token')).toBe(device.deviceToken)
    expect(requests[0].url).toBe(`${base}/events`)
    expect(requests[0].credentials).toBe('omit')
  })

  it('never pretends alarms can survive closing when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('blocked') })
    await expect(new AlertClient(base).register()).rejects.toMatchObject({ code: 'storage_unavailable' })
  })

  it('reports a stopped monitor as unavailable and keeps the server error code', async () => {
    const client = new AlertClient(base)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(device)))
    await client.register()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Monitor stopped', code: 'monitoring_not_ready' }, { status: 503 })))
    await expect(client.create({ id: device.deviceId, asset: asset as never, direction: 'above', target: 0.2, currency: 'USD' })).rejects.toMatchObject({ code: 'monitoring_not_ready' })
  })

  it('rejects remote insecure endpoints and credentials in the service URL', () => {
    expect(() => new AlertClient('http://remote.example/alerts')).toThrow()
    expect(() => new AlertClient('https://user:secret@example.com/alerts')).toThrow()
  })

  it('validates events before they can switch the chart', () => {
    expect(readAlertEvent(event)).toEqual(event)
    expect(readAlertEvent({ ...event, asset: { ...asset, id: 'javascript:evil' } })).toBeNull()
    expect(readAlertEvent({ ...event, target: -1 })).toBeNull()
    expect(readAlertEvent({ ...event, id: '../../settings' })).toBeNull()
  })

  it('accepts decimal comma and rejects ambiguous or nonpositive alarm values', () => {
    expect(parseAlarmTarget('0,125')).toBe(0.125)
    expect(parseAlarmTarget('84000.50')).toBe(84000.5)
    for (const value of ['1.000,20', '0', '-1', 'Infinity', '1e99', '']) expect(parseAlarmTarget(value)).toBeNull()
  })
})
