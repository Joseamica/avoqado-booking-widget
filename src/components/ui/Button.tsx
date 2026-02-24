import { h } from 'preact'
import type { ComponentChildren } from 'preact'

interface ButtonProps {
  children: ComponentChildren
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'destructive'
  disabled?: boolean
  class?: string
  fullWidth?: boolean
}

const variantClass: Record<string, string> = {
  primary: 'bg-[var(--avq-accent,#6366f1)] text-white hover:opacity-90',
  secondary: 'bg-[var(--avq-muted,#f3f4f6)] text-[var(--avq-fg,#111827)] hover:bg-[var(--avq-muted-hover,#e5e7eb)]',
  ghost: 'text-[var(--avq-fg,#111827)] hover:bg-[var(--avq-muted,#f3f4f6)]',
  outline: 'border border-[var(--avq-border,#e5e7eb)] text-[var(--avq-fg,#111827)] hover:border-[var(--avq-accent,#6366f1)] hover:text-[var(--avq-accent,#6366f1)]',
  destructive: 'bg-red-600 text-white hover:bg-red-700',
}

export function Button({ children, onClick, type = 'button', variant = 'primary', disabled, class: cls, fullWidth }: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      class={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-[var(--avq-accent,#6366f1)] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${variantClass[variant] ?? variantClass.primary} ${fullWidth ? 'w-full' : ''} ${cls ?? ''}`}
    >
      {children}
    </button>
  )
}
