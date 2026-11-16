import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
 base: './', plugins: [react(), {name:'offline-shell', generateBundle(_options,bundle) {
 const assets=['./','./index.html','./manifest.webmanifest','./alert-worker.js','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png',...Object.keys(bundle).filter(p=>p.startsWith('assets/')).map(p=>'./'+p)];
 const version=process.env.GITHUB_SHA ?? String(Date.now());
 this.emitFile({type:'asset',fileName:'sw.js',source:`importScripts(new URL('alert-worker.js',self.registration.scope).href);
const CACHE='${pkgName}-${version}'; const ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('${pkgName}-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url); if(e.request.method!=='GET'||u.origin!==self.location.origin||!u.pathname.startsWith(new URL(self.registration.scope).pathname)||u.pathname.includes('/api/')||u.pathname.endsWith('/config.js'))return; if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match(new URL('index.html',self.registration.scope)).then(r=>r||Response.error())));return;} if(ASSETS.some(a=>new URL(a,self.registration.scope).href===u.href))e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});`})
 }}], test: {environment:'jsdom',globals:true,include:['src/**/*.test.{ts,tsx}']}, server:{port:5190}
})
const pkgName='trading'
