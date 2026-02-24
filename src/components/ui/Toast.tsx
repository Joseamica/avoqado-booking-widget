import { h } from 'preact'
import { useSignal, useSignalEffect } from '@preact/signals'
import { toastMessage } from '../../state/booking'

export function Toast() {
  const visible = useSignal(false)

  useSignalEffect(() => {
    if (toastMessage.value) {
      visible.value = true
    } else {
      visible.value = false
    }
  })

  if (!visible.value || !toastMessage.value) return null

  const { text, type } = toastMessage.value
  const bgClass = type === 'error' ? 'bg-red-600' : 'bg-[var(--avq-accent,#6366f1)]'

  return (
    <div
      class={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg transition-all ${bgClass}`}
      style={{ maxWidth: '90vw' }}
    >
      {text}
    </div>
  )
}
