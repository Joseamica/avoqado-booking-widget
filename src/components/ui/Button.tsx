import { h } from 'preact'
import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'

interface ButtonProps {
  children: ComponentChildren
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'destructive'
  disabled?: boolean
  class?: string
  fullWidth?: boolean
}

export function Button({ children, onClick, type = 'button', variant = 'primary', disabled, class: cls, fullWidth }: ButtonProps) {
  const [hov, setHov] = useState(false)

  const base: Record<string, string> = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: '12px', padding: '0 20px', height: '46px',
    fontSize: '14px', fontWeight: '600',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? '0.5' : '1',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    border: 'none', outline: 'none',
    width: fullWidth ? '100%' : 'auto',
    letterSpacing: '-0.01em',
  }

  let variantStyle: Record<string, string> = {}

  switch (variant) {
    case 'primary':
      variantStyle = {
        background: hov && !disabled
          ? 'var(--avq-accent, #6366f1)'
          : 'var(--avq-accent, #6366f1)',
        color: '#ffffff',
        boxShadow: hov && !disabled
          ? '0 4px 14px color-mix(in srgb, var(--avq-accent, #6366f1) 40%, transparent)'
          : '0 2px 8px color-mix(in srgb, var(--avq-accent, #6366f1) 25%, transparent)',
        transform: hov && !disabled ? 'translateY(-1px)' : 'translateY(0)',
      }
      break
    case 'secondary':
      variantStyle = {
        background: hov ? 'var(--avq-muted-hover, #eef0f4)' : 'var(--avq-muted, #f8f9fb)',
        color: 'var(--avq-fg, #111827)',
      }
      break
    case 'ghost':
      variantStyle = {
        background: hov ? 'var(--avq-muted, #f8f9fb)' : 'transparent',
        color: 'var(--avq-fg, #111827)',
      }
      break
    case 'outline':
      variantStyle = {
        background: hov ? 'var(--avq-muted, #f8f9fb)' : 'transparent',
        border: '1.5px solid var(--avq-border, #e8eaed)',
        color: hov ? 'var(--avq-accent, #6366f1)' : 'var(--avq-fg, #111827)',
      }
      break
    case 'destructive':
      variantStyle = {
        background: hov ? '#dc2626' : '#ef4444',
        color: '#ffffff',
        boxShadow: hov ? '0 4px 14px rgba(239, 68, 68, 0.3)' : '0 2px 8px rgba(239, 68, 68, 0.2)',
      }
      break
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ ...base, ...variantStyle } as any}
      class={cls ?? ''}
    >
      {children}
    </button>
  )
}
