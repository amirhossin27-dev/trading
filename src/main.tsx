import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'
createRoot(document.getElementById('root')!).render(<App />)
// Embedded views follow their parent and do not install a service worker.
if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('embed')) {
 window.addEventListener('load',()=>{navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`,{scope:import.meta.env.BASE_URL,updateViaCache:'none'}).catch(()=>{})})
}
