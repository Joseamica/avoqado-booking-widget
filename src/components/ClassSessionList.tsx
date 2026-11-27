import { h } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Product, PublicClassSessionSlot } from '../types'
import type { TFunction } from '../i18n'
import * as api from '../api/booking'
import { branding } from '../state/booking'
import { Spinner } from './ui/Spinner'
import { CalendarView } from './CalendarView'
import { ListaDelHorario } from './ListaDelHorario'
import type { CubreSesion, MiReserva, PrecioDeLaFila } from './ListaDelHorario'
import { etiquetaDePrecio } from '../lib/paquetes'

/** La vista que eligió la clienta («calendar» es la Semana); se guarda con la misma llave de siempre. */
const VIEW_STORAGE_KEY = 'avq_classes_view'
type ClassesView = 'list' | 'calendar'

/** Desde este ancho el horario abre en Semana si no hay preferencia guardada. */
const SEMANA_DESDE = '(min-width: 768px)'
/** En el celular (≤ 640 px) no caben siete columnas: siempre la lista con tira de días, sin «Semana | Lista». */
const CELULAR = '(max-width: 640px)'

function consultar(consulta: string): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(consulta).matches
  } catch { return false }
}

function getStoredView(): ClassesView | null {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY)
    return v === 'calendar' || v === 'list' ? v : null
  } catch { return null }
}
function setStoredView(v: ClassesView) {
  try { localStorage.setItem(VIEW_STORAGE_KEY, v) } catch { /* */ }
}
/** La preferencia guardada gana; sin ella, Semana en pantallas de 768 px o más y Lista en las demás. */
function vistaInicial(): ClassesView {
  return getStoredView() ?? (consultar(SEMANA_DESDE) ? 'calendar' : 'list')
}

/** Sigue una media query (al girar el teléfono o cambiar el tamaño de la ventana). */
function useConsulta(consulta: string): boolean {
  const [coincide, setCoincide] = useState(() => consultar(consulta))
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(consulta)
    const cambio = () => setCoincide(mq.matches)
    cambio()
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', cambio)
    else mq.addListener?.(cambio)
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', cambio)
      else mq.removeListener?.(cambio)
    }
  }, [consulta])
  return coincide
}

interface ClassSessionListProps {
  /** Venue slug — required to fetch the range. */
  venueSlug: string
  /** Venue timezone — used to label days in customer's expected zone. */
  timezone: string
  /** Called when the customer taps a session to book. */
  onSelect: (slot: PublicClassSessionSlot) => void
  /** Called when the customer wants to leave the class listing (e.g. on error). */
  onExit?: () => void
  /** Optional venue phone — surfaced as "Contactar al estudio" in the empty state. */
  venuePhone?: string | null
  /** Optional handler — when provided, the empty state shows a "Comprar paquete" CTA. */
  onBuyPack?: () => void
  /** All venue products — used to resolve price/credit cost per row, since the
   *  range availability endpoint doesn't include them. */
  products?: Product[]
  /** ¿Un paquete de la clienta cubre la sesión? Entonces la fila dice «Incluida en tu paquete». Por default, no. */
  cubreSesion?: CubreSesion
  /** Su reserva en la sesión: «Reservada · lugar N», y una clase llena suya se puede tocar. Por default, ninguna. */
  miReserva?: MiReserva
  t: TFunction
}

/** Default lookahead window for the initial fetch. */
const INITIAL_DAYS = 30
/** How many additional days to fetch on each "Load more" click. */
const PAGE_DAYS = 30
/** Hard cap to match the server-side cap (60 days from today). */
const MAX_DAYS = 60

/**
 * Horario de las clases de un negocio (diseño 27-nov, `portada-v3`): en pantallas anchas, la semana tipo calendario
 * (`CalendarView`); en el celular, la lista con tira de días (`ListaDelHorario`). Tocar una clase la abre (`onSelect`);
 * una llena sólo si ya es suya. Used when flowType=classes.
 */
export function ClassSessionList({
  venueSlug, timezone, onSelect, onExit, venuePhone, onBuyPack, products, cubreSesion, miReserva, t,
}: ClassSessionListProps) {
  const [slots, setSlots] = useState<PublicClassSessionSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState(INITIAL_DAYS)
  const [refetchKey, setRefetchKey] = useState(0)
  /** Último día que de verdad llegó (no el pedido): sólo hasta ahí un día vacío es «Sin clases». */
  const [cargadoHasta, setCargadoHasta] = useState<string | null>(null)
  const [view, setView] = useState<ClassesView>(vistaInicial)
  function pickView(v: ClassesView) { setView(v); setStoredView(v) }
  const celular = useConsulta(CELULAR)
  const vista: ClassesView = celular ? 'list' : view

  // Filter state — per-chip dropdown selection. Empty = "all".
  const [classFilter, setClassFilter] = useState<string>('')
  const [instructorFilter, setInstructorFilter] = useState<string>('')
  const [openChip, setOpenChip] = useState<null | 'class' | 'instructor' | 'rooms'>(null)

  // Compute the date range based on the window. Today's date in the venue tz.
  const { dateFrom, dateTo, atMaxWindow } = useMemo(() => {
    const todayVenue = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
    const fromDate = new Date(`${todayVenue}T00:00:00Z`)
    const toDate = new Date(fromDate)
    toDate.setUTCDate(toDate.getUTCDate() + Math.min(windowDays, MAX_DAYS))
    return {
      dateFrom: todayVenue,
      dateTo: toDate.toISOString().slice(0, 10),
      atMaxWindow: windowDays >= MAX_DAYS,
    }
  }, [timezone, windowDays])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.getClassSessionsRange(venueSlug, { dateFrom, dateTo })
      .then(res => {
        if (cancelled) return
        setSlots(res.slots)
        // Si el SERVIDOR recortó el rango, cuenta lo que dice que mandó.
        setCargadoHasta(res.dateTo && res.dateTo < dateTo ? res.dateTo : dateTo)
      })
      .catch(err => {
        if (cancelled) return
        // Show a friendly message but keep the empty state visible.
        setError(err?.data?.message ?? 'Error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [venueSlug, dateFrom, dateTo, refetchKey])

  // Available filter options — derived from the slots themselves so the
  // dropdowns only show what actually exists this week.
  const classOptions = useMemo(() => {
    return Array.from(new Set(slots.map(s => s.productName).filter((v): v is string => Boolean(v)))).sort()
  }, [slots])
  const instructorOptions = useMemo(() => {
    const names = slots
      .map(s => s.instructor ? `${s.instructor.firstName} ${s.instructor.lastName}`.trim() : null)
      .filter((v): v is string => Boolean(v))
    return Array.from(new Set(names)).sort()
  }, [slots])

  // Apply filters to the slot list before grouping. Empty filter = no constraint.
  const filteredSlots = useMemo(() => {
    return slots.filter(s => {
      if (classFilter && s.productName !== classFilter) return false
      if (instructorFilter) {
        const name = s.instructor ? `${s.instructor.firstName} ${s.instructor.lastName}`.trim() : ''
        if (name !== instructorFilter) return false
      }
      return true
    })
  }, [slots, classFilter, instructorFilter])

  const nowMs = Date.now()
  const masDias = atMaxWindow ? undefined : () => setWindowDays(w => Math.min(w + PAGE_DAYS, MAX_DAYS))

  // Look up Product by id so each row can render price + duration without a
  // separate fetch. The range availability endpoint intentionally returns the
  // slim PublicClassSessionSlot shape; price lives on the Product.
  const productById = useMemo(() => {
    const m = new Map<string, Product>()
    if (products) for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  /** «$325 · clase suelta», «Incluida en tu paquete» o nada (sin precios, o sin monto). */
  function precioDe(slot: PublicClassSessionSlot): PrecioDeLaFila | null {
    const product = productById.get(slot.productId)
    const incluida = cubreSesion ? cubreSesion(slot) : false
    const texto = etiquetaDePrecio(t, {
      precio: product?.price != null ? Number(product.price) : null,
      showPrices: branding.value.showPrices,
      incluida,
    })
    return texto ? { texto, incluida } : null
  }

  if (loading && slots.length === 0) {
    return (
      <div style={{ padding: '64px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <Spinner size={28} />
        <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #9ca3af)' }}>{t('classList.loading')}</p>
      </div>
    )
  }

  if (error && slots.length === 0) {
    return (
      <div class="avq-animate-in" style={{ padding: '48px 0', textAlign: 'center' }}>
        <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', marginBottom: '12px' }}>{error}</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px' }}>
          <button
            type="button"
            onClick={() => setRefetchKey(k => k + 1)}
            style={{
              fontSize: '13px', color: 'var(--avq-accent, #6366f1)',
              background: 'none', border: 'none', cursor: 'pointer',
              textDecoration: 'underline', textUnderlineOffset: '2px',
            }}
          >
            {t('actions.retry')}
          </button>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              style={{
                fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)',
                background: 'none', border: 'none', cursor: 'pointer',
                textDecoration: 'underline', textUnderlineOffset: '2px',
              }}
            >
              {t('actions.goBack')}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (slots.length === 0) {
    return (
      <div class="avq-animate-in" style={{ padding: '64px 24px', textAlign: 'center', maxWidth: '420px', margin: '0 auto' }}>
        <div style={{
          width: '64px', height: '64px', borderRadius: '50%',
          background: 'var(--avq-muted, #f8f9fb)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--avq-muted-fg, #6b7280)" stroke-width="1.8">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <h2 style={{ fontSize: '17px', fontWeight: '600', color: 'var(--avq-fg, #111827)', margin: '0 0 8px', letterSpacing: '-0.01em' }}>
          {t('classList.emptyTitle')}
        </h2>
        <p style={{ fontSize: '14px', lineHeight: '1.5', color: 'var(--avq-muted-fg, #6b7280)', margin: '0 0 24px' }}>
          {t('classList.emptySubtitle')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'stretch' }}>
          {onBuyPack && (
            <button
              type="button"
              onClick={onBuyPack}
              style={{
                padding: '12px 20px', borderRadius: '10px',
                background: 'var(--avq-accent, #6366f1)',
                color: '#ffffff', border: 'none', cursor: 'pointer',
                fontSize: '14px', fontWeight: '600',
              }}
            >
              {t('classList.emptyBuyPack')}
            </button>
          )}
          {venuePhone && (
            <a
              href={`tel:${venuePhone}`}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                padding: '12px 20px', borderRadius: '10px',
                background: 'transparent',
                color: 'var(--avq-fg, #111827)',
                border: '1px solid var(--avq-border, #e8eaed)',
                fontSize: '14px', fontWeight: '500', textDecoration: 'none',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              {t('classList.emptyContact')}
            </a>
          )}
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              style={{
                marginTop: '4px',
                fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', fontWeight: '500',
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px',
              }}
            >
              {t('actions.goBack')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div class="avq-horario avq-animate-in">
      {/* Diseño 27-nov (portada-v3): título y «Semana | Lista»; en el celular sólo la lista con su tira de días. */}
      <div class="avq-horario-cabeza">
        <h2 class="avq-horario-titulo">{t('classList.title')}</h2>
        {!celular && (
          <div class="avq-horario-vistas" role="group" aria-label={t('reservaClases.horario.vista')}>
            <VistaBtn activa={vista === 'calendar'} onClick={() => pickView('calendar')} etiqueta={t('reservaClases.horario.semana')} />
            <VistaBtn activa={vista === 'list'} onClick={() => pickView('list')} etiqueta={t('reservaClases.horario.lista')} />
          </div>
        )}
      </div>

      {/* Filter chips with dropdowns. Container used to have overflowX:auto
       * for horizontal scroll on narrow viewports, but the CSS spec quirk
       * "any non-visible overflow on one axis also clips the other axis"
       * was clipping the dropdown menu below each chip. Switched to
       * flex-wrap so chips wrap on small widths and the dropdown is free
       * to render outside the row. */}
      <div class="avq-horario-filtros" style={{ position: 'relative' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '0 0 4px' }}>
          <FilterChip
            label={classFilter || t('classList.filterClasses')}
            active={Boolean(classFilter)}
            open={openChip === 'class'}
            onToggle={() => setOpenChip(openChip === 'class' ? null : 'class')}
            options={classOptions}
            allLabel={t('classList.filterClasses')}
            onPick={(v) => { setClassFilter(v); setOpenChip(null) }}
          />
          <FilterChip
            label={instructorFilter || t('classList.filterInstructors')}
            active={Boolean(instructorFilter)}
            open={openChip === 'instructor'}
            onToggle={() => setOpenChip(openChip === 'instructor' ? null : 'instructor')}
            options={instructorOptions}
            allLabel={t('classList.filterInstructors')}
            onPick={(v) => { setInstructorFilter(v); setOpenChip(null) }}
          />
          {/* Rooms filter stays placeholder until Venue.rooms is in the schema */}
          <span
            class="avq-filtro"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '7px 12px', borderRadius: '999px',
              background: 'var(--avq-bg, #ffffff)',
              border: '1px solid var(--avq-border, #e8eaed)',
              fontSize: '12px', fontWeight: '500',
              color: 'var(--avq-muted-fg, #9ca3af)',
              whiteSpace: 'nowrap', flexShrink: 0,
              cursor: 'not-allowed',
            }}
            title="Próximamente"
          >
            {t('classList.filterRooms')}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </div>
      </div>

      {/* Las fechas de más no llegaron (sin red, error): lo que ya estaba se sigue viendo, y se puede reintentar. */}
      {error && slots.length > 0 && (
        <div class="avq-horario-error" role="alert">
          <span>{t('reservaClases.horario.noSeCargaron')}</span>
          <button type="button" onClick={() => setRefetchKey(k => k + 1)}>{t('actions.retry')}</button>
        </div>
      )}

      {vista === 'calendar' ? (
        <CalendarView
          slots={filteredSlots}
          timezone={timezone}
          onSelect={onSelect}
          nowMs={nowMs}
          miReserva={miReserva}
          mostrarDuracion={branding.value.showDuration}
          ultimoDia={cargadoHasta ?? undefined}
          pedidoHasta={dateTo}
          cargando={loading}
          onNecesitaMasDias={masDias}
          t={t}
        />
      ) : (
        <ListaDelHorario
          slots={filteredSlots}
          timezone={timezone}
          nowMs={nowMs}
          onSelect={onSelect}
          precioDe={precioDe}
          miReserva={miReserva}
          mostrarDuracion={branding.value.showDuration}
          onMasFechas={masDias}
          cargando={loading}
          t={t}
        />
      )}
      <style>{`
        .avq-horario-cabeza { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
        .avq-horario-titulo { margin: 0; font-size: 20px; font-weight: 700; color: var(--avq-fg, #111827); letter-spacing: -0.01em; }
        .avq-horario-vistas { display: inline-flex; gap: 6px; }
        .avq-horario-vista { min-height: 36px; padding: 7px 14px; border-radius: 999px; border: 0; font: inherit; font-size: 13px;
          font-weight: 600; cursor: pointer; background: var(--avq-muted, #f5f5f4); color: var(--avq-muted-fg, #78716c);
          transition: background 0.15s ease, color 0.15s ease; }
        .avq-horario-vista[aria-pressed="true"] { background: var(--avq-fg, #1c1917); color: var(--avq-bg, #ffffff); }
        .avq-horario-filtros { margin: 0 0 18px; }
        .avq-horario-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
          margin: 0 0 16px; padding: 12px 14px; border-radius: 12px; font-size: 14px;
          border: 1px solid var(--avq-warning-border, #fde68a); background: var(--avq-warning-bg, #fffbeb); color: var(--avq-warning-fg, #92400e); }
        .avq-horario-error button { min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid currentColor;
          background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
        /* Celular (≤ 640 px): título de 26 px, controles de 52 px y bloques separados 24 px. */
        @media (max-width: 640px) {
          .avq-horario-cabeza { margin-bottom: 16px; }
          .avq-horario-titulo { font-size: 26px; }
          .avq-horario-filtros { margin-bottom: 24px; }
          .avq-horario-filtros .avq-filtro { min-height: 52px !important; font-size: 16px !important; padding: 0 16px !important; }
          .avq-horario-error { margin-bottom: 24px; font-size: 16px; }
          .avq-horario-error button { min-height: 52px; }
        }
      `}</style>
    </div>
  )
}

function FilterChip({
  label,
  active,
  open,
  onToggle,
  options,
  allLabel,
  onPick,
}: {
  label: string
  active: boolean
  open: boolean
  onToggle: () => void
  options: string[]
  allLabel: string
  onPick: (value: string) => void
}) {
  return (
    <span style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        class="avq-filtro"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '7px 12px', borderRadius: '999px',
          background: active ? 'var(--avq-fg, #111827)' : 'var(--avq-bg, #ffffff)',
          border: '1px solid ' + (active ? 'var(--avq-fg, #111827)' : 'var(--avq-border, #e8eaed)'),
          fontSize: '12px', fontWeight: active ? '600' : '500',
          color: active ? '#ffffff' : 'var(--avq-fg, #111827)',
          whiteSpace: 'nowrap', cursor: 'pointer',
        }}
      >
        {label}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: '200px',
            maxHeight: '280px',
            overflowY: 'auto',
            background: 'var(--avq-bg, #ffffff)',
            border: '1px solid var(--avq-border, #e8eaed)',
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(15,15,16,0.12)',
            padding: '6px',
            zIndex: 10,
          }}
        >
          <DropdownItem label={allLabel} active={!active} onClick={() => onPick('')} />
          {options.map(o => (
            <DropdownItem key={o} label={o} active={false} onClick={() => onPick(o)} />
          ))}
          {options.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--avq-muted-fg, #9ca3af)' }}>—</div>
          )}
        </div>
      )}
    </span>
  )
}

function DropdownItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        background: active ? 'var(--avq-muted, #f8f9fb)' : 'transparent',
        border: 0,
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: active ? '600' : '500',
        color: 'var(--avq-fg, #111827)',
        cursor: 'pointer',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--avq-muted, #f8f9fb)' }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.background = active ? 'var(--avq-muted, #f8f9fb)' : 'transparent'
      }}
    >
      {label}
    </button>
  )
}

/** «Semana» / «Lista»: botones con `aria-pressed`, como «Clases | Citas». */
function VistaBtn({ activa, onClick, etiqueta }: { activa: boolean; onClick: () => void; etiqueta: string }) {
  return (
    <button type="button" class="avq-horario-vista" aria-pressed={activa} onClick={onClick}>
      {etiqueta}
    </button>
  )
}
