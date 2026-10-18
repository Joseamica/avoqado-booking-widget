import { h } from 'preact'
import { useContext } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { todayRanges } from '../hours'
import { banner } from './ui'

/** Aviso de por qué no se puede pedir ahora. Con la tienda abierta no pinta nada. */
export function StoreStatusBanner() {
  const store = useContext(OrderStoreContext)!
  const info = store.info.value
  if (!info || info.status === 'OPEN' || info.status === 'DISABLED') return null
  const t = createOrderT(store.locale)
  let text: string
  if (info.status === 'CLOSED') {
    const ranges = todayRanges(info.hours, new Date(), info.venue.timezone ?? 'America/Mexico_City')
    const label = (r: { open: string; close: string; overnight: boolean }) =>
      // «02:00» se dice «2:00» en la hora de cierre del día siguiente.
      r.overnight ? t('store.overnightRange', { open: r.open, close: r.close.replace(/^0/, '') }) : `${r.open}–${r.close}`
    text =
      t('store.closedNow') +
      (ranges === null ? '' : ' ' + (ranges.length ? t('store.todayHours', { ranges: ranges.map(label).join(', ') }) : t('store.noOpenToday')))
  } else if (info.status === 'PAUSED') {
    text = t(info.reason === 'TOO_BUSY' ? 'store.tooBusy' : 'store.manualPause')
  } else text = t('store.offline')
  return <div role="status" style={banner}>{text}</div>
}
