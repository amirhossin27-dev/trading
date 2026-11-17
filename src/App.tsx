import { useEffect, useState } from 'react'
import { Trading } from './features/trading/Trading'
import { TradingDialog } from './features/trading/TradingDialog'
import { TradingTile } from './features/overview/TradingTile'
import { apiBaseUrl } from './services/platformApi'
import { readViewOptions, readSetting, writeSetting } from './runtime.mjs'
import type { Language } from './types/platform'
import './app.css'
const options = readViewOptions(window.location.href)
export function App() {
 const { embedded,compact } = options
 const [language,setLanguage] = useState<Language>(()=>embedded ? options.language : readSetting('trading.language','de',['de','en']))
 const [theme,setTheme] = useState(()=>embedded ? options.theme : readSetting('trading.theme','auto',['auto','dark','light']))
 const [help,setHelp] = useState(false)
 const [settingsOpen,setSettingsOpen] = useState(false)
 const [installed] = useState(() => Boolean(window.matchMedia?.('(display-mode: standalone)').matches || (window.navigator as Navigator & { standalone?: boolean }).standalone))
 const de = language === 'de'
 useEffect(()=>{document.documentElement.lang=language; if(!embedded)writeSetting('trading.language',language)},[language,embedded])
 useEffect(()=>{if(theme==='auto')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme; if(!embedded)writeSetting('trading.theme',theme)},[theme,embedded])
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
  {!embedded && <TradingDialog open={settingsOpen} onClose={()=>setSettingsOpen(false)} label={de?'Einstellungen':'Settings'} closeLabel={de?'Einstellungen schließen':'Close settings'} className="app-settings-dialog">
   <h2>{de?'Einstellungen':'Settings'}</h2>
   <div className="app-settings-controls"><button type="button" aria-label={de?'Sprache wechseln':'Change language'} onClick={()=>setLanguage(language==='de'?'en':'de')}><span>{de?'Sprache':'Language'}</span><strong>{language.toUpperCase()}</strong></button><button type="button" aria-label={de?'Darstellung wechseln':'Change appearance'} onClick={()=>setTheme(theme==='dark'?'light':theme==='light'?'auto':'dark')}><span>{de?'Darstellung':'Appearance'}</span><strong>{theme==='dark'?(de?'Dunkel':'Dark'):theme==='light'?(de?'Hell':'Light'):(de?'Automatisch':'Automatic')}</strong></button>{!installed && <button type="button" onClick={()=>setHelp(v=>!v)} aria-expanded={help}>{de?'Aufs iPhone':'Install'}</button>}</div>
   {help && <aside className="install-tip"><strong>{de?'Als eigene App öffnen':'Open as an app'}</strong><p>{de?'Öffne diese Seite auf deinem iPhone in Safari. Tippe auf Teilen → Zum Home-Bildschirm und aktiviere „Als Web-App öffnen“, falls angeboten.':'Open this page in Safari on your iPhone. Tap Share → Add to Home Screen and enable Open as Web App if offered.'}</p><button type="button" onClick={()=>setHelp(false)}>{de?'Verstanden':'Got it'}</button></aside>}
  </TradingDialog>}
  {!apiBaseUrl && <aside className="connection-notice" role="status">{de?'Die Verbindung für vollständige Live-Daten ist noch nicht eingerichtet.':'The connection for complete live data has not been configured yet.'} Krypto-Kurse können bereits direkt geladen werden.</aside>}
  <main>{compact ? <TradingTile language={language} onOpen={()=>{try{if(options.parentOrigin && new URL(document.referrer).origin===options.parentOrigin){window.parent.postMessage({type:'standalone-app:open'},options.parentOrigin);return}}catch{}window.open(new URL('./',window.location.href).href,'_blank','noopener,noreferrer')}} /> : <Trading language={language} embedded={embedded} settingsControl={!embedded && <button type="button" className="app-settings-trigger" aria-label={de?'Einstellungen':'Settings'} aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={()=>setSettingsOpen(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.5"/><circle cx="15" cy="17" r="2.5"/></svg><span className="app-settings-label" aria-hidden="true">{de?'Einstellungen':'Settings'}</span></button>} />}</main>
 </div>
}
