import { h } from 'preact'
import { useState, useMemo } from 'preact/hooks'
import type { LayoutConfig, LayoutSpot } from '../types'
import type { TFunction } from '../i18n'
import { Button } from './ui/Button'

interface SeatPickerProps {
  layout: LayoutConfig
  takenSpotIds: string[]
  selectedSpotIds: string[]
  onToggleSpot: (spotId: string) => void
  onConfirm: () => void
  t: TFunction
}

function SpotIcon({ type, size = 18 }: { type: string; size?: number }) {
  switch (type) {
    case 'bike':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="5" cy="18" r="3" /><circle cx="19" cy="18" r="3" />
          <path d="M12 18V8l-3 3m3-3 3 3" /><circle cx="12" cy="5" r="2" />
        </svg>
      )
    case 'mat':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <line x1="3" y1="12" x2="21" y2="12" />
        </svg>
      )
    case 'reformer':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="2" y="8" width="20" height="8" rx="1.5" />
          <line x1="7" y1="8" x2="7" y2="16" /><line x1="17" y1="8" x2="17" y2="16" />
          <circle cx="4" cy="19" r="1" /><circle cx="20" cy="19" r="1" />
        </svg>
      )
    case 'bed':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M2 4v16" /><path d="M22 4v16" />
          <path d="M2 8h20" /><path d="M2 16h20" />
          <path d="M6 8v8" />
        </svg>
      )
    case 'chair':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M6 19v-3" /><path d="M18 19v-3" />
          <rect x="5" y="10" width="14" height="6" rx="2" />
          <path d="M5 10V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" />
        </svg>
      )
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
        </svg>
      )
  }
}

export function SeatPicker({ layout, takenSpotIds, selectedSpotIds, onToggleSpot, onConfirm, t }: SeatPickerProps) {
  const [hoveredSpot, setHoveredSpot] = useState<string | null>(null)

  const takenSet = useMemo(() => new Set(takenSpotIds), [takenSpotIds])
  const selectedSet = useMemo(() => new Set(selectedSpotIds), [selectedSpotIds])

  const spotGrid = useMemo(() => {
    const grid: Record<string, LayoutSpot> = {}
    for (const spot of layout.spots) {
      grid[`${spot.row}-${spot.col}`] = spot
    }
    return grid
  }, [layout.spots])

  const cellSize = layout.cols <= 6 ? 44 : layout.cols <= 10 ? 38 : 32
  const gap = 6

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '6px', color: 'var(--avq-fg, #111827)' }}>
        {t('seats.title')}
      </h2>
      <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', marginBottom: '20px' }}>
        {t('seats.description')}
      </p>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)' }}>
          <div style={{ width: '14px', height: '14px', borderRadius: '4px', border: '1.5px solid var(--avq-border, #e8eaed)', background: 'var(--avq-bg, #fff)' }} />
          {t('seats.available')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)' }}>
          <div style={{ width: '14px', height: '14px', borderRadius: '4px', background: 'var(--avq-accent, #6366f1)' }} />
          {t('seats.selected')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)' }}>
          <div style={{ width: '14px', height: '14px', borderRadius: '4px', background: 'var(--avq-muted, #f1f3f5)', border: '1.5px solid var(--avq-border, #e8eaed)' }} />
          {t('seats.taken')}
        </div>
      </div>

      {/* Grid area */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
        padding: '16px',
        background: 'var(--avq-muted, #f8f9fb)', borderRadius: '14px',
        border: '1px solid var(--avq-border, #e8eaed)',
        overflowX: 'auto',
      }}>
        {/* Instructor — at the front, separate from the grid */}
        {layout.showInstructor && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
            marginBottom: '4px',
          }}>
            <div style={{
              width: '44px', height: '44px', borderRadius: '50%',
              background: 'color-mix(in srgb, var(--avq-accent, #6366f1) 10%, var(--avq-bg, #fff))',
              border: '2px solid var(--avq-accent, #6366f1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--avq-accent, #6366f1)" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--avq-accent, #6366f1)' }}>
              {t('seats.instructor')}
            </span>
          </div>
        )}

        {/* Student spots */}
        <div style={{
          display: 'inline-grid',
          gridTemplateColumns: `repeat(${layout.cols}, ${cellSize}px)`,
          gap: `${gap}px`,
        }}>
          {Array.from({ length: layout.rows }).map((_, row) =>
            Array.from({ length: layout.cols }).map((_, col) => {
              const spot = spotGrid[`${row}-${col}`]

              if (!spot || !spot.enabled) {
                return (
                  <div
                    key={`${row}-${col}`}
                    style={{
                      width: `${cellSize}px`, height: `${cellSize}px`,
                      borderRadius: '10px',
                    }}
                  />
                )
              }

              const isTaken = takenSet.has(spot.id)
              const isSelected = selectedSet.has(spot.id)
              const isHov = hoveredSpot === spot.id

              return (
                <button
                  key={`${row}-${col}`}
                  type="button"
                  disabled={isTaken}
                  onClick={() => !isTaken && onToggleSpot(spot.id)}
                  onMouseEnter={() => setHoveredSpot(spot.id)}
                  onMouseLeave={() => setHoveredSpot(null)}
                  style={{
                    width: `${cellSize}px`, height: `${cellSize}px`,
                    borderRadius: '10px',
                    border: isSelected
                      ? '2px solid var(--avq-accent, #6366f1)'
                      : isTaken
                        ? '1.5px solid var(--avq-border, #e8eaed)'
                        : isHov
                          ? '1.5px solid var(--avq-muted-fg, #9ca3af)'
                          : '1.5px solid var(--avq-border, #e8eaed)',
                    background: isSelected
                      ? 'color-mix(in srgb, var(--avq-accent, #6366f1) 12%, var(--avq-bg, #fff))'
                      : isTaken
                        ? 'var(--avq-muted, #f1f3f5)'
                        : isHov
                          ? 'var(--avq-muted, #f8f9fb)'
                          : 'var(--avq-bg, #fff)',
                    color: isSelected
                      ? 'var(--avq-accent, #6366f1)'
                      : isTaken
                        ? 'var(--avq-muted-fg, #c4c9cf)'
                        : 'var(--avq-fg, #111827)',
                    cursor: isTaken ? 'not-allowed' : 'pointer',
                    opacity: isTaken ? 0.5 : 1,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: '1px',
                    transition: 'all 0.15s ease',
                    boxShadow: isSelected
                      ? '0 0 0 3px color-mix(in srgb, var(--avq-accent, #6366f1) 12%, transparent)'
                      : 'none',
                    padding: 0,
                    fontSize: 0,
                    lineHeight: 1,
                  }}
                  title={isTaken ? t('seats.spotTaken') : `${t('seats.spot')} ${spot.label}`}
                >
                  <SpotIcon type={layout.iconType} size={cellSize <= 34 ? 14 : 16} />
                  <span style={{
                    fontSize: cellSize <= 34 ? '9px' : '10px',
                    fontWeight: '600',
                    lineHeight: 1,
                  }}>
                    {spot.label}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Selection info + confirm */}
      <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>
          {selectedSpotIds.length > 0
            ? t('seats.selectedCount', { count: selectedSpotIds.length })
            : t('seats.noSelection')}
        </p>
        <Button
          onClick={onConfirm}
          disabled={selectedSpotIds.length === 0}
        >
          {t('seats.confirm')}
        </Button>
      </div>
    </div>
  )
}
