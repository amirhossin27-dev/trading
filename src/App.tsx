import { useEffect, useState } from 'react'
import { Trading } from './features/trading/Trading'
import { TradingTile } from './features/overview/TradingTile'
import { apiBaseUrl } from './services/platformApi'
import { readViewOptions } from './runtime.mjs'
import type { Language } from './types/platform'
import './app.css'
const options = readViewOptions(window.location.href)
export function App() {
 const { embedded,compact } = options
 const [language,setLanguage] = useState<Language>(()=>embedded ? options.language : localStorage.getItem('trading.language') === 'en' ? 'en' : 'de')
 const [theme,setTheme] = useState(()=>embedded ? options.theme : localStorage.getItem('trading.theme') || 'auto')
 const [help,setHelp] = useState(false)
 const de = language === 'de'
 useEffect(()=>{document.documentElement.lang=language; if(!embedded)localStorage.setItem('trading.language',language)},[language,embedded])
 useEffect(()=>{if(theme==='auto')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme; if(!embedded)localStorage.setItem('trading.theme',theme)},[theme,embedded])
 useEffect(()=>{
  if(!embedded || !options.parentOrigin || window.parent===window)return
  // Referrer must agree with the explicitly supplied parent. No wildcard messages.
  try { if(new URL(document.referrer).origin!==options.parentOrigin)return } catch {return}
  const parentOrigin=options.parentOrigin
  const report=()=>{const dialog=Boolean(document.querySelector('[role="dialog"]')); const height=dialog?1000:Math.max(240,Math.min(2200,Math.ceil(document.getElementById('root')?.scrollHeight || 600))); window.parent.postMessage({type:'standalone-app:resize',height},parentOrigin)}
  const resize=new ResizeObserver(report);resize.observe(document.getElementById('root')!);
  const mutations=new MutationObserver(report);mutations.observe(document.body,{subtree:true,childList:true});report()
  return()=>{resize.disconnect();mutations.disconnect()}
 },[embedded])
 return <div className={`standalone ${embedded?'is-embedded':''} ${compact?'is-compact':''}`}>
  {!embedded && <header className="app-header"><div className="brand"><img src="./icons/icon-192.png" alt=""/><div><span className="app-eyebrow">{de?'DEINE ÜBERSICHT':'YOUR OVERVIEW'}</span><h1>Trading</h1></div></div><div className="app-actions"><button type="button" aria-label={de?'Sprache wechseln':'Change language'} onClick={()=>setLanguage(language==='de'?'en':'de')}>{language.toUpperCase()}</button><button type="button" aria-label={de?'Darstellung wechseln':'Change appearance'} onClick={()=>setTheme(theme==='dark'?'light':theme==='light'?'auto':'dark')}>{theme==='dark'?'☾':theme==='light'?'☀':'◐'}</button><button type="button" onClick={()=>setHelp(v=>!v)} aria-expanded={help}>{de?'Aufs iPhone':'Install'}</button></div></header>}
  {help && <aside className="install-tip"><strong>{de?'Als eigene App öffnen':'Open as an app'}</strong><p>{de?'Öffne diese Seite auf deinem iPhone in Safari. Tippe auf Teilen → Zum Home-Bildschirm und aktiviere „Als Web-App öffnen“, falls angeboten.':'Open this page in Safari on your iPhone. Tap Share → Add to Home Screen and enable Open as Web App if offered.'}</p><button type="button" onClick={()=>setHelp(false)}>{de?'Verstanden':'Got it'}</button></aside>}
  {!apiBaseUrl && <aside className="connection-notice" role="status">{de?'Die Verbindung für vollständige Live-Daten ist noch nicht eingerichtet.':'The connection for complete live data has not been configured yet.'} Krypto-Kurse können bereits direkt geladen werden.</aside>}
  <main>{compact ? <TradingTile language={language} onOpen={()=>{try{if(options.parentOrigin && new URL(document.referrer).origin===options.parentOrigin){window.parent.postMessage({type:'standalone-app:open'},options.parentOrigin);return}}catch{}window.open(new URL('./',window.location.href).href,'_blank','noopener,noreferrer')}} /> : <Trading language={language} />}</main>
  {!embedded && <footer className="app-footer"><span>{de?'Einstellungen bleiben auf diesem Gerät.':'Settings stay on this device.'}</span><span>{de?'Live-Daten benötigen Internet.':'Live data requires internet.'}</span></footer>}
 </div>
}
