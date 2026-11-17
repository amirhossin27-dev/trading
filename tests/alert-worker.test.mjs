import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../public/alert-worker.js', import.meta.url), 'utf8')
const id = 'ef218492-b23e-4c59-913a-f4ab522fa6b9'
function worker(windows = []) {
  const listeners = {}; const shown = []; const opened = []
  const self = { registration: { scope: 'https://example.com/trading/', showNotification: async (...args) => shown.push(args) }, clients: { matchAll: async () => windows, openWindow: async (url) => opened.push(url) }, addEventListener: (name, handler) => { listeners[name] = handler } }
  vm.runInNewContext(source, { self, URL, console })
  const dispatch = async (type, event) => { assert.equal(typeof listeners[type], 'function'); let pending; listeners[type]({ ...event, waitUntil: (work) => { pending = work } }); await pending }
  return { shown, opened, dispatch }
}

test('push shows a system notification with a stable event tag and a safe target', async () => {
  const w = worker()
  await w.dispatch('push', { data: { json: () => ({ type: 'price-alert', eventId: id, asset: { symbol: 'HBAR' }, target: 0.2, observedPrice: 0.21, currency: 'USD', url: 'https://evil.example' }) } })
  assert.equal(w.shown.length, 1)
  assert.match(w.shown[0][0], /HBAR/)
  assert.equal(w.shown[0][1].tag, `price-alert:${id}`)
  assert.equal(w.shown[0][1].data.eventId, id)
  assert.equal(w.shown[0][1].data.url, undefined)
})

test('click opens only the installed app scope even when payload includes a foreign URL', async () => {
  const w = worker()
  await w.dispatch('notificationclick', { notification: { close() {}, data: { eventId: id, url: 'https://evil.example' } } })
  assert.equal(w.opened[0], `https://example.com/trading/?alert=${id}`)
})

test('click focuses the existing standalone window and sends only the event identifier', async () => {
  let focused = false; let message
  const window = { url: 'https://example.com/trading/', focus: async () => { focused = true }, postMessage: (value) => { message = value } }
  const w = worker([window])
  await w.dispatch('notificationclick', { notification: { close() {}, data: { eventId: id } } })
  assert.equal(focused, true); assert.equal(w.opened.length, 0)
  assert.equal(message.type, 'price-alert:open'); assert.equal(message.eventId, id)
})

test('a malformed push still displays a generic visible notification', async () => {
  const w = worker()
  await w.dispatch('push', { data: { json: () => { throw new Error('malformed') } } })
  assert.equal(w.shown.length, 1)
  assert.equal(w.shown[0][1].data.eventId, undefined)
})

test('a test push tells the open app that it arrived, without any market data', async () => {
  const messages = []
  const w = worker([{ url: 'https://example.com/trading/', postMessage: (value) => messages.push(value) }])
  await w.dispatch('push', { data: { json: () => ({ type: 'push-test', title: 'x', body: 'y' }) } })
  assert.equal(w.shown.length, 1)
  assert.equal(w.shown[0][1].tag, 'trading-push-test')
  assert.deepEqual(messages.map((message) => message.type), ['push-test:received'])
})

test('a price alert does not send the test arrival message', async () => {
  const messages = []
  const w = worker([{ url: 'https://example.com/trading/', postMessage: (value) => messages.push(value) }])
  await w.dispatch('push', { data: { json: () => ({ type: 'price-alert', eventId: id, asset: { symbol: 'HBAR' }, target: 0.2, observedPrice: 0.21, currency: 'USD' }) } })
  assert.deepEqual(messages, [])
})
