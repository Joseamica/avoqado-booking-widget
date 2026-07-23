import { h } from 'preact'
import type { PublicBookingStaff } from '../types'
import type { TFunction } from '../i18n'

interface StaffSelectorProps {
  staff: PublicBookingStaff[]
  selectedStaffId: string | null
  onSelect: (staffId: string | null) => void
  onNext: () => void
  t: TFunction
}

function Initials({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'
  return <span aria-hidden="true">{initials}</span>
}

export function StaffSelector({ staff, selectedStaffId, onSelect, onNext, t }: StaffSelectorProps) {
  const options: Array<PublicBookingStaff | null> = [null, ...staff]
  return (
    <section style={{ maxWidth: '720px', margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 6px', fontSize: '22px', color: 'var(--avq-fg, #111827)' }}>
        {t('staffSelection.title')}
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)' }}>
        {t('staffSelection.subtitle')}
      </p>

      {staff.length === 0 ? (
        <div role="status" style={{ padding: '18px', border: '1px solid var(--avq-border, #e8eaed)', borderRadius: '12px', color: 'var(--avq-muted-fg, #6b7280)' }}>
          {t('staffSelection.noEligible')}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
          {options.map(option => {
            const id = option?.id ?? null
            const selected = selectedStaffId === id
            const label = option?.name ?? t('staffSelection.anyone')
            return (
              <button
                key={option?.id ?? 'anyone'}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', textAlign: 'left',
                  borderRadius: '12px', cursor: 'pointer', fontFamily: 'inherit',
                  border: `2px solid ${selected ? 'var(--avq-accent, #6366f1)' : 'var(--avq-border, #e8eaed)'}`,
                  background: selected ? 'color-mix(in srgb, var(--avq-accent, #6366f1) 7%, var(--avq-bg, #fff))' : 'var(--avq-bg, #fff)',
                  color: 'var(--avq-fg, #111827)',
                }}
              >
                {option?.photoUrl ? (
                  <img src={option.photoUrl} alt="" style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <span style={{ width: '42px', height: '42px', borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, background: 'var(--avq-muted, #f3f4f6)', fontSize: '13px', fontWeight: '700' }}>
                    {option ? <Initials name={label} /> : '✓'}
                  </span>
                )}
                <span style={{ fontSize: '14px', fontWeight: '600' }}>{label}</span>
              </button>
            )
          })}
        </div>
      )}

      <button
        type="button"
        disabled={staff.length === 0}
        onClick={onNext}
        style={{
          width: '100%', marginTop: '20px', padding: '14px', border: 0, borderRadius: 'var(--avq-btn-radius, 12px)',
          background: staff.length === 0 ? '#d1d5db' : 'var(--avq-accent, #6366f1)',
          color: staff.length === 0 ? '#6b7280' : '#fff', cursor: staff.length === 0 ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', fontSize: '15px', fontWeight: '600',
        }}
      >
        {t('summary.next')}
      </button>
    </section>
  )
}
