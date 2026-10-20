import { h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

interface OtpInputProps {
  value: string
  onChange: (code: string) => void
  onComplete: (code: string) => void
  disabled?: boolean
  length?: number
  /** Aspecto de la tienda de pedidos (spec §4 y §10.3): siempre claro y con colores fijos. Sin esto, el de reservas de siempre. */
  look?: 'tienda'
}

export function OtpInput({ value, onChange, onComplete, disabled, length = 6, look }: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.split('').slice(0, length)
  const tienda = look === 'tienda'
  const [active, setActive] = useState(-1) // caja con foco; sólo la pinta «tienda»
  // El navegador no siempre avisa con blur cuando el input con foco se deshabilita (verificando el código): sin esto la caja
  // se quedaría resaltada aunque el foco ya se perdió.
  useEffect(() => { if (tienda && disabled) setActive(-1) }, [tienda, disabled])

  // «tienda»: no lee --avq-fg/--avq-bg (un contenedor oscuro dejaría los dígitos blancos sobre blanco); sólo el acento viene del tema.
  // El borde de 2 px de acento ES el indicador de foco: el `outline: none` en línea anula el anillo `:focus-visible` de la tienda.
  const tiendaBox = (i: number) => tienda ? {
    height: '60px', fontSize: '26px', fontWeight: '700', fontFamily: 'inherit', // los inputs no heredan la tipografía de la tienda si no se pide
    border: active === i ? '2px solid var(--avq-accent, #000)' : '1px solid #DADADA',
    background: '#FFFFFF', color: '#000000',
  } : undefined

  function emit(next: string) {
    const clean = next.replace(/\D/g, '').slice(0, length)
    onChange(clean)
    if (clean.length === length) onComplete(clean)
  }

  function setAt(i: number, d: string) {
    const arr = value.split('')
    arr[i] = d
    // rebuild compactly so we never leave holes
    const rebuilt = arr.join('').replace(/\D/g, '').slice(0, length)
    emit(rebuilt)
    if (d && i < length - 1) refs.current[i + 1]?.focus()
  }

  function onInput(i: number, e: Event) {
    const raw = (e.target as HTMLInputElement).value.replace(/\D/g, '')
    if (!raw) { setAt(i, ''); return }
    if (raw.length > 1) {
      // pasted / multiple chars typed into one box → distribute from i
      const merged = (value.slice(0, i) + raw).replace(/\D/g, '').slice(0, length)
      emit(merged)
      const nextIdx = Math.min(merged.length, length - 1)
      refs.current[nextIdx]?.focus()
      return
    }
    setAt(i, raw)
  }

  function onKeyDown(i: number, e: KeyboardEvent) {
    if (e.key === 'Backspace') {
      if (digits[i]) { setAt(i, '') }
      else if (i > 0) { refs.current[i - 1]?.focus(); setAt(i - 1, '') }
    } else if (e.key === 'ArrowLeft' && i > 0) { refs.current[i - 1]?.focus() }
    else if (e.key === 'ArrowRight' && i < length - 1) { refs.current[i + 1]?.focus() }
  }

  function onPaste(e: ClipboardEvent) {
    e.preventDefault()
    const text = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, length)
    if (text) { emit(text); refs.current[Math.min(text.length, length - 1)]?.focus() }
  }

  return (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }} onPaste={onPaste}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digits[i] ?? ''}
          disabled={disabled}
          onInput={e => onInput(i, e)}
          onKeyDown={e => onKeyDown(i, e)}
          onFocus={e => { (e.target as HTMLInputElement).select(); if (tienda) setActive(i) }}
          onBlur={tienda ? () => setActive(-1) : undefined}
          style={{
            width: '100%', height: '52px', textAlign: 'center',
            fontSize: '22px', fontWeight: '600', fontVariantNumeric: 'tabular-nums',
            borderRadius: '12px', border: '1.5px solid var(--avq-border, #e8eaed)',
            background: 'var(--avq-bg, #ffffff)', color: 'var(--avq-fg, #111827)',
            outline: 'none', boxSizing: 'border-box',
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
            ...tiendaBox(i),
          }}
        />
      ))}
    </div>
  )
}
