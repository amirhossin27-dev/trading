export function readViewOptions(href) {
 const q = new URL(href).searchParams;
 const embedded = q.get('embed') === '1';
 let parentOrigin = null;
 try { const u = new URL(q.get('parentOrigin')); if (['http:','https:'].includes(u.protocol) && !u.username && !u.password) parentOrigin = u.origin; } catch {}
 return { embedded, compact: embedded && q.get('view') === 'compact', language: q.get('lang') === 'en' ? 'en' : 'de', theme: ['light','dark'].includes(q.get('theme')) ? q.get('theme') : 'auto', parentOrigin };
}
export function resolveApiUrl(base, path) {
 if (!base || !path.startsWith('/api/') || path.startsWith('//')) throw new Error('Bitte zuerst die Daten-API einrichten.');
 const u = new URL(base);
 if (u.username || u.password || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)))) throw new Error('Die Daten-API muss HTTPS verwenden.');
 if (u.search || u.hash) throw new Error('Die API-Adresse darf keine Parameter enthalten.');
 return u.href.replace(/\/$/,'') + path;
}
export function validFrameMessage(value) {
 return value !== null && typeof value === 'object' && value.type === 'standalone-app:resize' && Number.isFinite(value.height) && value.height >= 240 && value.height <= 2200;
}

export function readSetting(key,fallback,allowed) { try { const value=globalThis.localStorage.getItem(key); return allowed.includes(value)?value:fallback; } catch { return fallback; } }
export function writeSetting(key,value) { try { globalThis.localStorage.setItem(key,value); } catch { /* Session state still works when storage is blocked. */ } }
