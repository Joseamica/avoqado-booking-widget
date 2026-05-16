import { h } from 'preact'
import type { ModifierGroup, ModifierSelection } from '../types'
import type { TFunction } from '../i18n'

function formatPriceMXN(amount: number): string {
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `$${Math.round(amount).toLocaleString('es-MX')}`
  }
}

interface ModifierPickerProps {
  productId: string
  group: ModifierGroup
  selections: ModifierSelection[]
  onChange: (next: ModifierSelection[]) => void
  t: TFunction
}

export function ModifierPicker({ productId, group, selections, onChange, t }: ModifierPickerProps) {
  const inputName = `avq-mg-${productId}-${group.id}`
  const groupModifierIds = new Set(group.modifiers.map(m => m.id))

  const selectionsForGroup = selections.filter(
    s => s.productId === productId && groupModifierIds.has(s.modifierId),
  )
  const totalSelectedQty = selectionsForGroup.reduce((acc, s) => acc + s.quantity, 0)

  const selectedFor = (modifierId: string) =>
    selections.find(s => s.productId === productId && s.modifierId === modifierId)

  const toggle = (modifierId: string) => {
    const existing = selectedFor(modifierId)
    if (group.allowMultiple) {
      if (existing) {
        onChange(selections.filter(s => !(s.productId === productId && s.modifierId === modifierId)))
      } else {
        if (group.maxSelections != null && totalSelectedQty >= group.maxSelections) return
        onChange([...selections, { productId, modifierId, quantity: 1 }])
      }
    } else {
      // single-select: replace any existing pick in this group
      const filtered = selections.filter(
        s => !(s.productId === productId && groupModifierIds.has(s.modifierId)),
      )
      if (existing) {
        onChange(filtered)
      } else {
        onChange([...filtered, { productId, modifierId, quantity: 1 }])
      }
    }
  }

  const setQuantity = (modifierId: string, qty: number) => {
    if (qty < 1) {
      onChange(selections.filter(s => !(s.productId === productId && s.modifierId === modifierId)))
      return
    }
    if (group.maxSelections != null) {
      // Account for other selected modifiers in the same group
      const others = totalSelectedQty - (selectedFor(modifierId)?.quantity ?? 0)
      const cap = group.maxSelections - others
      if (qty > cap) qty = cap
    }
    const exists = selectedFor(modifierId)
    if (exists) {
      onChange(
        selections.map(s =>
          s.productId === productId && s.modifierId === modifierId ? { ...s, quantity: qty } : s,
        ),
      )
    } else {
      onChange([...selections, { productId, modifierId, quantity: qty }])
    }
  }

  const subtitle = group.required
    ? t('modifiers.required')
    : group.allowMultiple
      ? group.maxSelections
        ? t('modifiers.pickUpTo', { n: group.maxSelections })
        : t('modifiers.optional')
      : t('modifiers.pickOne')

  return (
    <fieldset
      style={{
        border: '1px solid var(--avq-border, #e8eaed)',
        borderRadius: '10px',
        padding: '12px 14px',
        margin: '0 0 12px 0',
      }}
    >
      <legend
        style={{
          padding: '0 6px',
          fontSize: '13px',
          color: 'var(--avq-muted-fg, #6b7280)',
          fontWeight: 600,
        }}
      >
        <span style={{ color: 'var(--avq-fg, #111827)' }}>{group.name}</span>
        <span style={{ marginLeft: '8px', fontWeight: 400 }}>· {subtitle}</span>
      </legend>
      {group.description && (
        <p style={{ margin: '6px 0 10px', fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)' }}>
          {group.description}
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {group.modifiers.map(m => {
          const selected = selectedFor(m.id)
          const isQuantityVisible =
            group.allowMultiple && group.maxSelections != null && group.maxSelections > 1 && !!selected
          return (
            <li key={m.id}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  cursor: 'pointer',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: selected ? 'var(--avq-muted, #f8f9fb)' : 'transparent',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type={group.allowMultiple ? 'checkbox' : 'radio'}
                    name={inputName}
                    checked={!!selected}
                    onChange={() => toggle(m.id)}
                  />
                  <span>{m.name}</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {m.price > 0 && (
                    <span style={{ fontWeight: 500 }}>+{formatPriceMXN(m.price)}</span>
                  )}
                  {isQuantityVisible && (
                    <input
                      type="number"
                      min={1}
                      max={group.maxSelections ?? undefined}
                      value={selected?.quantity ?? 1}
                      onClick={(e: any) => e.stopPropagation()}
                      onInput={(e: any) => setQuantity(m.id, Number(e.currentTarget.value))}
                      style={{
                        width: '56px',
                        padding: '4px 6px',
                        border: '1px solid var(--avq-border, #e8eaed)',
                        borderRadius: '6px',
                        fontFamily: 'inherit',
                      }}
                    />
                  )}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}
