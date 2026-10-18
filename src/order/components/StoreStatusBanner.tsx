import { h } from 'preact'
import { useContext } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { formatTime, todayRanges } from '../hours'
import { banner } from './ui'

/** Aviso de por qué no se puede pedir ahora. Con la tienda abierta no pinta nada. */
export function StoreStatusBanner() {
  const store = useContext(OrderStoreContext)!
  const info = store.info.value
  if (!info || info.status === 'OPEN') return null
  const t = createOrderT(store.locale)
  const tz = info.venue.timezone ?? 'America/Mexico_City'
  let text: string
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
      : info.reason === 'MANUAL_PAUSE' && info.pausedUntil ? t('store.pausedUntil', { time: formatTime(info.pausedUntil, tz, store.locale) })
      : t('store.manualPause')
  } else if (info.status === 'DISABLED') {
    // La carta ya lo dice en lugar de los platillos; aquí sirve en el carrito y en tus datos (p. ej. tras un 409).
    text = t('store.disabled')
  } else text = t('store.offline')
  return <div role="status" style={banner}>{text}</div>
}
