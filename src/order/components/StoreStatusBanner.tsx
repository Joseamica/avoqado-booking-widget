import { h } from 'preact'
import { useContext } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { formatTime, todayRanges } from '../hours'
import type { StoreInfo } from '../types'

// Íconos de trazo de los avisos (spec §9.6), del estilo de la maqueta: 24×24, trazo de 2 con puntas redondas y `currentColor`.
const ICONS = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, // pausa y cerrado
  cloudOff: <><path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 17.9 9 4.5 4.5 0 0 1 17.5 18H7z" /><path d="M4 4l16 16" /></>, // sin conexión
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></>, // error
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>, // apagado
}
export type NoticeIcon = keyof typeof ICONS

/**
 * Aviso de la tienda: tarjeta de radio 16 con el color de su tono, ícono (sin voz: el título ya lo dice), título corto, la
 * frase y, si lo lleva, un botón. Lo usan el estado de la tienda, el aviso general, «Tienes un pedido en curso» y el estado del envío
 * (`CheckoutStatus`, que avisa con `role="alert"` lo que falló o pide decidir ya).
 */
export function Notice({ tone, icon, title, text, action, role = 'status' }: {
  tone: 'neutral' | 'warn' | 'error'
  icon?: NoticeIcon
  title?: string
  text: string
  action?: { label: string; onClick: () => void }
  role?: 'status' | 'alert'
}) {
  return (
    <div role={role} class={`avq-o-notice avq-o-notice--${tone}`}>
      {icon && (
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          {ICONS[icon]}
        </svg>
      )}
      <div class="avq-o-notice__body">
        {title && <span class="avq-o-notice__title">{title}</span>}
        <span>{text}</span>
      </div>
      {action && <button type="button" class="avq-o-notice__action" onClick={action.onClick}>{action.label}</button>}
    </div>
  )
}

/**
 * Lo que la tienda dice cuando no se puede pedir ahora: la frase de hoy (literal) y, si lleva, su título, el ícono y el tono. Lo
 * usan el aviso de arriba y el motivo de la barra del carrito. Con la tienda abierta no hay nada que decir: no se llama.
 */
export function storeStatus(info: StoreInfo, t: ReturnType<typeof createOrderT>, locale: 'es' | 'en') {
  const tz = info.venue.timezone ?? 'America/Mexico_City'
  let text: string
  // CLOSED y OFFLINE no llevan título: su frase de hoy ya empieza con él («Cerrado ahora. Hoy: …», «El restaurante no está
  // conectado. …») y se leería dos veces. `store.closedTitle` y `store.offlineTitle` quedan en el JSON por si se acortan esas frases.
  let title: string | undefined
  let icon: NoticeIcon = 'clock'
  let tone: 'neutral' | 'warn' = 'warn'
  if (info.status === 'CLOSED') {
    const ranges = todayRanges(info.hours, new Date(), tz)
    const label = (r: { open: string; close: string; overnight: boolean }) =>
      // «02:00» se dice «2:00» en la hora de cierre del día siguiente.
      r.overnight ? t('store.overnightRange', { open: r.open, close: r.close.replace(/^0/, '') }) : `${r.open}–${r.close}`
    text =
      t('store.closedNow') +
      (ranges === null ? '' : ' ' + (ranges.length ? t('store.todayHours', { ranges: ranges.map(label).join(', ') }) : t('store.noOpenToday')))
  } else if (info.status === 'PAUSED') {
    // Una pausa con hora (15/30/60 min de la Bandeja) dice cuándo vuelve; la del gerente, o un servidor viejo, el texto de hoy.
    text =
      info.reason === 'TOO_BUSY' ? t('store.tooBusy')
      : info.reason === 'MANUAL_PAUSE' && info.pausedUntil ? t('store.pausedUntil', { time: formatTime(info.pausedUntil, tz, locale) })
      : t('store.manualPause')
    title = t('store.pausedTitle')
  } else if (info.status === 'DISABLED') {
    // La carta ya lo dice en lugar de los platillos; aquí sirve en el carrito y en tus datos (p. ej. tras un 409).
    text = t('store.disabled')
    title = t('store.disabledTitle')
    icon = 'lock'
    tone = 'neutral' // no es una pausa: el restaurante no vende en línea
  } else {
    text = t('store.offline')
    icon = 'cloudOff'
  }
  return { text, title, icon, tone }
}

/** Aviso de por qué no se puede pedir ahora. Con la tienda abierta no pinta nada. */
export function StoreStatusBanner() {
  const store = useContext(OrderStoreContext)!
  const info = store.info.value
  if (!info || info.status === 'OPEN') return null
  const s = storeStatus(info, createOrderT(store.locale), store.locale)
  return <Notice tone={s.tone} icon={s.icon} title={s.title} text={s.text} />
}
