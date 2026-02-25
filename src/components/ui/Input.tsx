import { h } from 'preact'
import { useState } from 'preact/hooks'

interface InputProps {
  id?: string
  type?: string
  value?: string
  placeholder?: string
  onInput?: (e: Event) => void
  onChange?: (e: Event) => void
  required?: boolean
  min?: string | number
  max?: string | number
  rows?: number
  class?: string
  error?: string
}

export function Input({ id, type = 'text', value, placeholder, onInput, onChange, required, min, max, class: cls, error }: InputProps) {
  const [focused, setFocused] = useState(false)

  return (
    <input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      onInput={onInput}
      onChange={onChange}
      required={required}
      min={min as any}
      max={max as any}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        height: '46px', width: '100%', borderRadius: '12px',
        padding: '0 14px', fontSize: '15px',
        border: error
          ? '1.5px solid #ef4444'
          : focused
            ? '1.5px solid var(--avq-accent, #6366f1)'
            : '1.5px solid var(--avq-border, #e8eaed)',
        background: 'var(--avq-bg, #ffffff)',
        color: 'var(--avq-fg, #111827)',
        outline: 'none',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        boxShadow: focused && !error
          ? '0 0 0 3px color-mix(in srgb, var(--avq-accent, #6366f1) 10%, transparent)'
          : error
            ? '0 0 0 3px rgba(239, 68, 68, 0.08)'
            : 'none',
        boxSizing: 'border-box',
      } as any}
      class={cls ?? ''}
    />
  )
}

export function Textarea({ id, value, placeholder, onInput, rows = 3, class: cls, error }: InputProps & { rows?: number }) {
  const [focused, setFocused] = useState(false)

  return (
    <textarea
      id={id}
      value={value}
      placeholder={placeholder}
      onInput={onInput}
      rows={rows}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: '100%', borderRadius: '12px',
        padding: '12px 14px', fontSize: '15px',
        border: error
          ? '1.5px solid #ef4444'
          : focused
            ? '1.5px solid var(--avq-accent, #6366f1)'
            : '1.5px solid var(--avq-border, #e8eaed)',
        background: 'var(--avq-bg, #ffffff)',
        color: 'var(--avq-fg, #111827)',
        outline: 'none',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        boxShadow: focused && !error
          ? '0 0 0 3px color-mix(in srgb, var(--avq-accent, #6366f1) 10%, transparent)'
          : 'none',
        resize: 'vertical',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
      } as any}
      class={cls ?? ''}
    />
  )
}
