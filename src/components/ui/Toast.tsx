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
  const isError = type === 'error'

  // `--avq-toast-offset` lo pone la página propia (book.avoqado.io) con el alto de su barra fija de abajo en el celular, para
  // que el aviso no quede debajo de ella; sin la variable (computadora, widget pegado en otro sitio) queda a 16 px como siempre.
  return (
    <div
      class="avq-animate-in"
      style={{
        position: 'fixed', bottom: 'calc(16px + var(--avq-toast-offset, 0px))', left: '50%', transform: 'translateX(-50%)',
        zIndex: 50, maxWidth: '90vw',
        borderRadius: '12px', padding: '12px 20px',
        fontSize: '13px', fontWeight: '500', color: '#ffffff',
        background: isError ? '#ef4444' : 'var(--avq-accent, #6366f1)',
        boxShadow: isError
          ? '0 8px 24px rgba(239, 68, 68, 0.3)'
          : '0 8px 24px color-mix(in srgb, var(--avq-accent, #6366f1) 35%, transparent)',
      }}
    >
      {text}
    </div>
  )
}
