import { createClient } from 'npm:@supabase/supabase-js@2.100.0'
import webpush from 'npm:web-push@3.6.7'
import { createHandler } from './handler.mjs'

const env = Deno.env.toObject()
const db = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) }) },
  })
  : null

Deno.serve(createHandler({ env, db, webpush }))
