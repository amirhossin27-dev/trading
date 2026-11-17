/* Imported by sw.js. Never fetch or cache market data here. */
(() => {
  const validId = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0
  self.addEventListener('push', (event) => {
    event.waitUntil((async () => {
      let data
      try { data = event.data?.json() } catch { /* Always show a visible fallback notification. */ }
      const priceAlert = data?.type === 'price-alert' && validId(data.eventId) && typeof data.asset?.symbol === 'string' && data.asset.symbol.length <= 24 && positive(data.target) && positive(data.observedPrice) && /^[A-Z]{3}$/.test(data.currency)
      const test = data?.type === 'push-test'
      const title = priceAlert ? `Trading · ${data.asset.symbol}` : 'Trading'
      const body = priceAlert ? `Zielkurs ${data.target} ${data.currency} erreicht. Beobachtet: ${data.observedPrice} ${data.currency}.` : test ? 'Die Testmitteilung ist angekommen.' : 'Eine neue Mitteilung ist verfügbar. Öffne die App für Details.'
      await self.registration.showNotification(title, {
        body,
        tag: priceAlert ? `price-alert:${data.eventId}` : test ? 'trading-push-test' : 'trading-message',
        icon: new URL('icons/icon-192.png', self.registration.scope).href,
        badge: new URL('icons/icon-192.png', self.registration.scope).href,
        data: priceAlert ? { eventId: data.eventId } : {},
      })
      // The open app learns that the test really arrived on this device, whatever the server answered.
      if (test) {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const client of windows) client.postMessage({ type: 'push-test:received' })
      }
    })())
  })
  self.addEventListener('notificationclick', (event) => {
    event.notification.close()
    const eventId = validId(event.notification.data?.eventId) ? event.notification.data.eventId : null
    event.waitUntil((async () => {
      const target = new URL(self.registration.scope)
      if (eventId) target.searchParams.set('alert', eventId)
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = windows.find((client) => {
        try { const url = new URL(client.url); return url.origin === target.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname) && !url.searchParams.has('embed') } catch { return false }
      })
      if (existing) {
        await existing.focus()
        if (eventId) existing.postMessage({ type: 'price-alert:open', eventId })
      } else await self.clients.openWindow(target.href)
    })())
  })
})()
