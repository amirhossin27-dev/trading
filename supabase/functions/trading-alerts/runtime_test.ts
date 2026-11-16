import webpush from 'npm:web-push@3.6.7'
import { createECDH, randomBytes } from 'node:crypto'
import { createHandler } from './handler.mjs'

Deno.test('pinned web-push encrypts an aes128gcm request in the Deno runtime', () => {
  const vapid = webpush.generateVAPIDKeys()
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const subscription = {
    endpoint: 'https://web.push.apple.com/test-not-a-real-device',
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  }
  const details = webpush.generateRequestDetails(subscription, '{"type":"price-alert","eventId":"test"}', {
    vapidDetails: { ...vapid, subject: 'mailto:admin@example.com' },
    contentEncoding: 'aes128gcm', TTL: 86400, urgency: 'high', topic: 'test-event',
  })
  if (details.method !== 'POST' || details.headers['Content-Encoding'] !== 'aes128gcm' || !details.body?.length || !details.headers.Authorization) throw new Error('Invalid encrypted push request')
})

Deno.test('healthy monitoring config exposes only a VAPID public key in Deno', async () => {
  const vapid = webpush.generateVAPIDKeys()
  const env = {
    SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key',
    ALERT_ALLOWED_ORIGINS: 'https://trading.example.com', YAHOO_API_BASE_URL: 'https://api.example.com',
    ALERT_VAPID_PUBLIC_KEY: vapid.publicKey, ALERT_VAPID_PRIVATE_KEY: vapid.privateKey,
    ALERT_VAPID_SUBJECT: 'mailto:admin@example.com', ALERT_SCHEDULER_SECRET: randomBytes(32).toString('base64url'),
  }
  const db = { from() { return { select() { return this }, eq() { return this }, single: async () => ({ data: { last_success_at: new Date().toISOString() } }) } } }
  const response = await createHandler({ env, db, webpush })(new Request('https://project.supabase.co/functions/v1/trading-alerts/config'))
  const config = await response.json()
  if (!config.configured || config.vapidPublicKey !== vapid.publicKey || JSON.stringify(config).includes(vapid.privateKey)) throw new Error('Incorrect server readiness')
})
