import { h } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import { ApiError, cancelOrder, getTracking } from '../api'
import { formatTime } from '../hours'
import { createOrderT } from '../i18n'
import { formatMXN } from '../money'
import { clearLastOrder } from '../session'
import { OrderStoreContext } from '../store'
import type { OnlineOrderStatus, Tracking } from '../types'
import { banner, btn, muted } from './ui'

const POLL_MS = 10_000
const FINAL: OnlineOrderStatus[] = ['COMPLETED', 'REJECTED', 'EXPIRED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_STAFF']
export const isFinalStatus = (s: OnlineOrderStatus) => FINAL.includes(s)

/** Seguimiento del pedido. No usa `/info` ni `/menu` (el plan puede haber vencido): todo sale de la respuesta del seguimiento. */
export function TrackingScreen() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const token = store.trackingToken.value
  const [tracking, setTracking] = useState<Tracking | null>(null)
  const [offline, setOffline] = useState(false)
  const [gone, setGone] = useState(false)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cancelMsg, setCancelMsg] = useState<string | null>(null)
  const refresh = useRef<() => Promise<void>>(async () => {})
  const cancelling = useRef(false)

  useEffect(() => {
    if (!token) return
    let stopped = false
    let finished = false
    let inflight = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = async () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (stopped || finished || inflight || document.visibilityState !== 'visible') return
      inflight = true
      try {
        const r = await getTracking(store.slug, token)
        if (stopped) return
        setTracking(r)
        setOffline(false)
        if (isFinalStatus(r.status)) finished = true
      } catch (e) {
        if (stopped) return
        if (e instanceof ApiError && e.status === 404) {
          finished = true
          setGone(true)
          clearLastOrder(store.slug)
        } else setOffline(true)
      } finally {
        inflight = false
      }
      if (!stopped && !finished) timer = setTimeout(() => void run(), POLL_MS)
    }
    refresh.current = run
    const onVisible = () => void run()
    document.addEventListener('visibilitychange', onVisible)
    void run()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [store, token])

  if (gone) return <p role="status" style={{ margin: '16px 0' }}>{t('tracking.notFound')}</p>
  if (!tracking) return <p role="status" style={{ margin: '16px 0' }}>{offline ? t('store.reconnecting') : t('tracking.loading')}</p>

  const tz = tracking.venueTimezone ?? store.info.value?.venue.timezone ?? 'America/Mexico_City'
  const time = (iso: string) => formatTime(iso, tz, store.locale)
  const status = (): string => {
    switch (tracking.status) {
      case 'PENDING_ACCEPTANCE': return t('tracking.waiting', { time: time(tracking.acceptDeadlineAt) })
      case 'ACCEPTED':
        return tracking.estimatedReadyAt ? t('tracking.preparingEta', { time: time(tracking.estimatedReadyAt) }) : t('tracking.preparing')
      case 'READY': return t('tracking.ready')
      case 'COMPLETED': return t('tracking.completed')
      case 'REJECTED':
        return tracking.rejectReason ? t('tracking.rejected', { reason: t(`tracking.reason.${tracking.rejectReason}`) }) : t('tracking.rejectedNoReason')
      case 'EXPIRED': return t('tracking.expired')
      case 'CANCELLED_BY_CUSTOMER': return t('tracking.cancelledByCustomer')
      default: return t('tracking.cancelledByStaff')
    }
  }

  async function doCancel() {
    if (cancelling.current || !token) return
    cancelling.current = true
    setBusy(true)
    setCancelMsg(null)
    try {
      await cancelOrder(store.slug, token)
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined
      if (code === 'ORDER_STATE_CHANGED') setCancelMsg(t('tracking.stateChanged'))
      else if (code === 'ORDER_HAS_PAYMENTS') setCancelMsg(t('tracking.hasPayments'))
      else setCancelMsg(e instanceof ApiError && e.network ? t('common.offline') : t('checkout.failed'))
    } finally {
      cancelling.current = false
      setBusy(false)
      setAsking(false)
    }
    await refresh.current()
  }

  const contact = tracking.venueContact
  return (
    <div>
      {offline && <p role="status" style={{ ...muted, margin: '0 0 8px' }}>{t('store.reconnecting')}</p>}
      <h2 style={{ margin: '0 0 4px' }}>{tracking.venueName}</h2>
      <p style={{ ...muted, margin: '0 0 12px' }}>{t('tracking.folio', { n: tracking.orderNumber })}</p>
      <p role="status" style={banner}>{status()}</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
        {tracking.items.map((it, i) => (
          <li key={i} style={{ marginBottom: '6px' }}>
            {it.quantity} × {it.name}
            {it.modifiers.map((m, j) => <div key={j} style={muted}>{m.quantity > 1 ? `${m.quantity} × ` : ''}{m.name}</div>)}
            {it.note && <div style={muted}>{it.note}</div>}
          </li>
        ))}
      </ul>
      <p style={{ display: 'flex', justifyContent: 'space-between', margin: '0 0 4px' }}>
        <strong>{t('cart.total')}</strong><strong>{formatMXN(tracking.total, store.locale)}</strong>
      </p>
      <p style={{ ...muted, margin: '0 0 12px' }}>{tracking.paid ? t('tracking.paid') : t('tracking.payAtPickup')}</p>
      {(contact?.address || contact?.phone) && (
        <div style={{ margin: '0 0 12px' }}>
          {contact.address && <div>{contact.address}</div>}
          {contact.phone && <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>{contact.phone}</a>}
        </div>
      )}
      {cancelMsg && <p role="status" style={banner}>{cancelMsg}</p>}
      {tracking.canCancel && !asking && (
        <button type="button" style={btn()} onClick={() => { setCancelMsg(null); setAsking(true) }}>{t('tracking.cancel')}</button>
      )}
      {tracking.canCancel && asking && (
        <div role="group" aria-label={t('tracking.cancelAsk')}>
          <p style={{ margin: '0 0 8px' }}>{t('tracking.cancelAsk')}</p>
          <button type="button" style={btn(true)} disabled={busy} onClick={() => void doCancel()}>{busy ? t('tracking.cancelling') : t('tracking.cancelYes')}</button>{' '}
          <button type="button" style={btn()} disabled={busy} onClick={() => setAsking(false)}>{t('tracking.cancelNo')}</button>
        </div>
      )}
    </div>
  )
}
