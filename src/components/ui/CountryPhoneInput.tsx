import { h } from 'preact'
import { useState, useRef, useEffect, useMemo } from 'preact/hooks'
import { COUNTRIES, flagEmoji, detectCountryFromFullNumber, type Country } from '../../data/countries'

interface CountryPhoneInputProps {
  dialCode: string
  nationalNumber: string
  onDialCodeChange: (dial: string) => void
  onNationalNumberChange: (num: string) => void
  numberPlaceholder: string
  searchPlaceholder: string
  noResultsText: string
  /** Aspecto de la tienda de pedidos (spec §4 y §10.3): siempre claro y con colores fijos. Sin esto, el de reservas de siempre. */
  look?: 'tienda'
  /** Sólo con `look="tienda"`: el `id` del campo del número, para que una `<label for>` de afuera lo nombre y lo enfoque al tocarla. */
  inputId?: string
}

export function CountryPhoneInput({
  dialCode, nationalNumber, onDialCodeChange, onNationalNumberChange,
  numberPlaceholder, searchPlaceholder, noResultsText, look, inputId,
}: CountryPhoneInputProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  // First country whose dial matches, for the flag shown on the button.
  const selected: Country =
    COUNTRIES.find(c => c.dial === dialCode) ?? COUNTRIES[0]

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COUNTRIES
    // Only match on dial code when the query actually has digits — otherwise
    // `''.includes('')`-style always-true matching would defeat the name filter.
    const digits = q.replace(/\D/g, '')
    return COUNTRIES.filter(
      c => c.name.toLowerCase().includes(q) || (digits !== '' && c.dial.includes(digits)),
    )
  }, [query])

  // Close on outside click. composedPath() is required because this renders
  // inside the widget's Shadow DOM, where event.target retargets to the host.
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const path = e.composedPath()
      if (rootRef.current && !path.includes(rootRef.current)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  // Focus the search box when the panel opens.
  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlight(0)
      // defer so the input exists
      setTimeout(() => searchRef.current?.focus(), 0)
    }
  }, [open])

  function choose(c: Country) {
    onDialCodeChange(c.dial)
    setOpen(false)
  }

  function onSearchKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlight]) choose(filtered[highlight]) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  const borderColor = focused ? 'var(--avq-accent, #6366f1)' : 'var(--avq-border, #e8eaed)'

  // «tienda»: se aplica ENCIMA de los estilos de hoy (sin look no se agrega nada). No lee --avq-fg/--avq-bg/--avq-muted* (un
  // contenedor oscuro dejaría la lada blanca sobre blanco): sólo el acento viene del tema. 16 px en los inputs: iOS no hace
  // zoom al enfocar. El buscador y las filas de la lista miden 44 px (toque mínimo). Botones e inputs no heredan la
  // tipografía si no se pide (fontFamily). El borde de 2 px de acento es el indicador de foco del número (su outline en
  // línea sigue en none); el buscador sí deja el anillo de la tienda.
  const tienda = look === 'tienda' ? {
    field: { height: '52px', boxSizing: 'border-box', border: focused ? '2px solid var(--avq-accent, #000)' : '1px solid #DADADA', background: '#FFFFFF' },
    // Sin divisor: la lada se separa por su fondo ('0', no undefined: vaciar `borderRight` quitaría también lo que `border: none`
    // puso a ese lado y el botón recuperaría su borde nativo). El anillo de foco va adentro: el campo recorta (overflow) lo que sobre.
    dial: { padding: '0 12px', borderRight: '0', background: '#F3F3F3', color: '#000000', fontSize: '16px', fontWeight: '600', fontFamily: 'inherit', outlineOffset: '-4px' },
    number: { fontSize: '16px', fontFamily: 'inherit', color: '#000000' },
    list: { background: '#FFFFFF', border: '1px solid #DADADA' },
    searchBox: { borderBottom: '1px solid #EEEEEE' },
    search: { height: '44px', border: '1px solid #DADADA', outline: undefined, fontSize: '16px', fontFamily: 'inherit', background: '#FFFFFF', color: '#000000' },
    empty: { color: '#5E5E5E' },
    option: (on: boolean) => ({ minHeight: '44px', background: on ? '#F3F3F3' : 'transparent', fontSize: '16px', fontFamily: 'inherit', color: '#000000' }),
    code: { color: '#5E5E5E' },
  } : null

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'stretch', height: '46px',
        borderRadius: '12px', border: `1.5px solid ${borderColor}`,
        background: 'var(--avq-bg, #ffffff)', overflow: 'hidden',
        transition: 'border-color 0.2s ease',
        ...tienda?.field,
      }}>
        {/* Dial-code button */}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '0 10px', border: 'none',
            borderRight: '1.5px solid var(--avq-border, #e8eaed)',
            background: 'var(--avq-muted, #f8f9fb)', cursor: 'pointer',
            fontSize: '15px', color: 'var(--avq-fg, #111827)', whiteSpace: 'nowrap',
            ...tienda?.dial,
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span style={{ fontSize: '18px', lineHeight: 1 }}>{flagEmoji(selected.iso2)}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>+{dialCode}</span>
          <span style={{ fontSize: '10px', opacity: 0.6 }}>▾</span>
        </button>
        {/* National number */}
        <input
          id={look === 'tienda' ? inputId : undefined}
          type="tel"
          inputMode="numeric"
          value={nationalNumber}
          placeholder={numberPlaceholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onInput={e => {
            const raw = (e.target as HTMLInputElement).value
            // Pasting a full "+<country><national>" number auto-selects the
            // country and keeps only the national digits. A paste fires this
            // same input event with the whole string, so no paste handler is
            // needed. Plain digit input (no leading "+") is unchanged.
            const detected = detectCountryFromFullNumber(raw)
            if (detected) {
              onDialCodeChange(detected.dial)
              onNationalNumberChange(detected.national)
            } else {
              onNationalNumberChange(raw.replace(/\D/g, ''))
            }
          }}
          style={{
            flex: 1, minWidth: 0, border: 'none', outline: 'none',
            padding: '0 14px', fontSize: '15px',
            background: 'transparent', color: 'var(--avq-fg, #111827)',
            ...tienda?.number,
          }}
        />
      </div>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', zIndex: 50, top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--avq-bg, #ffffff)',
            border: '1.5px solid var(--avq-border, #e8eaed)', borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
            ...tienda?.list,
          }}
        >
          <div style={{ padding: '8px', borderBottom: '1px solid var(--avq-border, #e8eaed)', ...tienda?.searchBox }}>
            <input
              ref={searchRef}
              type="text"
              value={query}
              placeholder={searchPlaceholder}
              onInput={e => { setQuery((e.target as HTMLInputElement).value); setHighlight(0) }}
              onKeyDown={onSearchKeyDown}
              style={{
                width: '100%', height: '38px', borderRadius: '8px',
                border: '1.5px solid var(--avq-border, #e8eaed)', outline: 'none',
                padding: '0 12px', fontSize: '14px', boxSizing: 'border-box',
                background: 'var(--avq-bg, #ffffff)', color: 'var(--avq-fg, #111827)',
                ...tienda?.search,
              }}
            />
          </div>
          <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', ...tienda?.empty }}>
                {noResultsText}
              </div>
            ) : (
              filtered.map((c, i) => (
                <button
                  key={c.iso2}
                  type="button"
                  role="option"
                  aria-selected={c.dial === dialCode}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(c)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                    padding: '9px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: i === highlight ? 'var(--avq-muted, #f8f9fb)' : 'transparent',
                    fontSize: '14px', color: 'var(--avq-fg, #111827)',
                    ...tienda?.option(i === highlight),
                  }}
                >
                  <span style={{ fontSize: '18px', lineHeight: 1 }}>{flagEmoji(c.iso2)}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <span style={{ color: 'var(--avq-muted-fg, #6b7280)', fontVariantNumeric: 'tabular-nums', ...tienda?.code }}>+{c.dial}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
