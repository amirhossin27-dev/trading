import { resolveApiUrl } from '../runtime.mjs'
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || window.APP_CONFIG?.apiBaseUrl || (import.meta.env.DEV ? 'http://localhost:5182' : '')
const pending = new Map<string, Promise<unknown>>()
export async function fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
 const url = resolveApiUrl(apiBaseUrl, path)
 const load = async () => {
  const timeout = AbortSignal.timeout(75_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const response = await fetch(url, {...options, signal, credentials:'omit', headers:{Accept:'application/json',...options.headers}})
  if (!response.ok) {
   const body = await response.json().catch(() => null)
   throw new Error(body?.error || `Datenquelle antwortet mit HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
 }
 // A caller with its own abort signal owns its request. Never let another caller cancel it.
 if (options.signal) return load()
 const existing = pending.get(url)
 if (existing) return existing as Promise<T>
 const request = load().finally(()=>pending.delete(url))
 pending.set(url,request)
 return request
}
