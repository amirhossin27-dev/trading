import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { TradingDialog } from './TradingDialog'

afterEach(cleanup)

function openHistoryDialog() {
  render(<TradingDialog open onClose={vi.fn()} label="Price alerts" closeLabel="Close alerts">
    <button type="button">Save alert</button>
    <details>
      <summary>Recent acknowledged notifications</summary>
      <button type="button">Open acknowledged alert in chart</button>
      <details open>
        <summary>Older notifications</summary>
        <button type="button">Open older alert in chart</button>
      </details>
    </details>
    <div hidden><button type="button">Hidden control</button></div>
    <div inert><button type="button">Inactive control</button></div>
  </TradingDialog>)
  return {
    close: screen.getByRole('button', { name: 'Close alerts' }),
    summary: screen.getByText('Recent acknowledged notifications'),
  }
}

it('wraps backward to the visible history summary while its contents are collapsed', () => {
  const { close, summary } = openHistoryDialog()
  expect(document.activeElement).toBe(close)

  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(summary)
})

it('wraps forward from the collapsed history summary to the close button', () => {
  const { close, summary } = openHistoryDialog()
  summary.focus()
  const tab = createEvent.keyDown(summary, { key: 'Tab' })
  fireEvent(summary, tab)
  expect(tab.defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(close)
})

it('includes history actions in the focus loop after the history is expanded', async () => {
  const user = userEvent.setup()
  const { close, summary } = openHistoryDialog()
  await user.click(summary)
  expect(summary.parentElement?.hasAttribute('open')).toBe(true)
  const action = screen.getByRole('button', { name: 'Open older alert in chart' })

  close.focus()
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(action)
  const tab = createEvent.keyDown(action, { key: 'Tab' })
  fireEvent(action, tab)
  expect(tab.defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(close)
})
