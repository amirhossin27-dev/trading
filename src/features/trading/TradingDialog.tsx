import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** A modal layer outside the app root keeps the underlying chart mounted and its box unchanged. */
export function TradingDialog({ open, onClose, label, closeLabel, className = '', children }: {
  open: boolean
  onClose: () => void
  label: string
  closeLabel: string
  className?: string
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = document.getElementById('root')
    const previousInert = root?.inert ?? false
    const previousOverflow = document.body.style.overflow
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    const panel = panelRef.current!
    panel.querySelector<HTMLElement>('[data-dialog-close]')?.focus({ preventScroll: true })
    const focusable = () => [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], details > summary:first-of-type, [tabindex="0"]')]
      .filter((element) => {
        if (element.closest('[inert], [hidden], [aria-hidden="true"]')) return false
        // A closed disclosure only exposes its first direct summary; an open nested disclosure can still be hidden by it.
        for (let ancestor = element.parentElement; ancestor && ancestor !== panel; ancestor = ancestor.parentElement) {
          if (ancestor.tagName !== 'DETAILS' || ancestor.hasAttribute('open')) continue
          const summary = [...ancestor.children].find((child) => child.tagName === 'SUMMARY')
          if (!summary?.contains(element)) return false
        }
        return true
      })
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
      } else if (event.key === 'Tab') {
        const elements = focusable()
        const first = elements[0]
        const last = elements[elements.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    function onFocus(event: FocusEvent) {
      if (event.target instanceof Node && !panel.contains(event.target)) focusable()[0]?.focus()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocus)
      if (root) root.inert = previousInert
      document.body.style.overflow = previousOverflow
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open])

  return createPortal(
    <div className={`tr-overlay ${open ? 'is-open' : ''} ${className}`} aria-hidden={!open} inert={!open}>
      <div className="mk-watch-backdrop" onClick={onClose} />
      <div ref={panelRef} className="tr-overlay-panel" role={open ? 'dialog' : undefined} aria-modal={open ? true : undefined} aria-label={label}>
        <button type="button" data-dialog-close className="tr-dialog-close" aria-label={closeLabel} onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {children}
      </div>
    </div>, document.body,
  )
}
