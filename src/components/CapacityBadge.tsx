import { h } from 'preact'
import type { TFunction } from '../i18n'

interface CapacityBadgeProps {
  capacity: number | null | undefined
  enrolled: number | null | undefined
  /** Threshold below which the badge switches to "low stock" styling. */
  lowThreshold?: number
  /** Smaller variant for tight cards (e.g. session list rows). */
  size?: 'sm' | 'md'
  t: TFunction
}

/**
 * Reusable capacity indicator for class/session cards.
 * - Full → red "Lleno"
 * - <= lowThreshold → amber "X disponibles"
 * - Otherwise → muted "X disponibles"
 *
 * Returns null when capacity is unknown so callers can render unconditionally.
 */
export function CapacityBadge({ capacity, enrolled, lowThreshold = 3, size = 'md', t }: CapacityBadgeProps) {
  if (capacity == null || capacity <= 0) return null
  const used = Math.max(0, enrolled ?? 0)
  const remaining = Math.max(0, capacity - used)
  const isFull = remaining === 0
  const isLow = !isFull && remaining <= lowThreshold

  const variant: 'full' | 'low' | 'normal' = isFull ? 'full' : isLow ? 'low' : 'normal'
  const label = isFull
    ? t('classList.fullClass')
    : t('classList.spotsLeftBadge', { count: remaining })

  return (
    <span style={badgeStyle(variant, size)} aria-label={label}>
      {!isFull && <Dot variant={variant} />}
      <span>{label}</span>
    </span>
  )
}

function Dot({ variant }: { variant: 'full' | 'low' | 'normal' }) {
  const color =
    variant === 'low' ? '#d97706' : variant === 'normal' ? '#10b981' : '#dc2626'
  return (
    <span
      aria-hidden="true"
      style={{
        width: '6px', height: '6px', borderRadius: '50%',
        background: color, flexShrink: 0,
      }}
    />
  )
}

function badgeStyle(variant: 'full' | 'low' | 'normal', size: 'sm' | 'md'): h.JSX.CSSProperties {
  const palette = {
    full: { bg: '#fee2e2', fg: '#b91c1c' },
    low: { bg: '#fef3c7', fg: '#92400e' },
    normal: { bg: 'var(--avq-muted, #f3f4f6)', fg: 'var(--avq-muted-fg, #4b5563)' },
  }[variant]
  const fontSize = size === 'sm' ? '11px' : '12px'
  const padding = size === 'sm' ? '3px 8px' : '4px 10px'
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding,
    borderRadius: '999px',
    background: palette.bg,
    color: palette.fg,
    fontSize,
    fontWeight: '600',
    whiteSpace: 'nowrap',
  }
}
