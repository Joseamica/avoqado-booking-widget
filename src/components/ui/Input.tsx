import { h } from 'preact'

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
      class={`h-12 w-full rounded-lg border px-3 text-base transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--avq-accent,#6366f1)] ${error ? 'border-red-500' : 'border-[var(--avq-border,#e5e7eb)]'} bg-[var(--avq-bg,#ffffff)] text-[var(--avq-fg,#111827)] placeholder-[var(--avq-muted-fg,#6b7280)] ${cls ?? ''}`}
    />
  )
}

export function Textarea({ id, value, placeholder, onInput, rows = 3, class: cls, error }: InputProps & { rows?: number }) {
  return (
    <textarea
      id={id}
      value={value}
      placeholder={placeholder}
      onInput={onInput}
      rows={rows}
      class={`w-full rounded-lg border px-3 py-2 text-base transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--avq-accent,#6366f1)] ${error ? 'border-red-500' : 'border-[var(--avq-border,#e5e7eb)]'} bg-[var(--avq-bg,#ffffff)] text-[var(--avq-fg,#111827)] placeholder-[var(--avq-muted-fg,#6b7280)] ${cls ?? ''}`}
    />
  )
}
