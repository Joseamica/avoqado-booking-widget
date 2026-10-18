import { h } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { ApiError, requestOrderingOtp } from '../api'
import { pendingAttempt } from '../attempt'
import { checkoutOf, errorText, phoneToVerify, send, verifyPhone } from '../checkout'
import { OtpInput } from '../../components/ui/OtpInput'
import { CheckoutStatus } from './CheckoutStatus'
import { btn, muted } from './ui'

const RESEND_S = 30

/** Código de WhatsApp para el teléfono del pedido; al verificarlo se manda el pedido (el intento pendiente, si lo hay). */
export function OtpScreen() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const c = checkoutOf(store)
  const phone = phoneToVerify(store)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  // La hora del último envío vive en el Checkout de la tienda: salir y volver a esta pantalla no manda otro WhatsApp.
  const lastSent = () => (phone ? c.otpSentAt.get(phone) : undefined)
  const recent = () => { const at = lastSent(); return at !== undefined && Date.now() - at < RESEND_S * 1000 }
  // Hora límite (no un contador que se encadena): no se atrasa aunque el navegador demore los re-pintados.
  const [until, setUntil] = useState(() => (recent() ? lastSent()! : Date.now()) + RESEND_S * 1000)
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const wait = Math.max(0, Math.ceil((until - Date.now()) / 1000))

  const request = async () => {
    if (!phone) return
    setError(null)
    const now = Date.now()
    c.otpSentAt.set(phone, now)
    setUntil(now + RESEND_S * 1000)
    try {
      await requestOrderingOtp(store.slug, phone)
    } catch (e) {
      // Sin red el código no salió: volver a esta pantalla lo pide otra vez (no hereda una espera de un envío que no fue).
      if (!(e instanceof ApiError) || e.network) c.otpSentAt.delete(phone)
      setError(errorText(t, e))
    }
  }
  useEffect(() => {
    if (recent()) setUntil(lastSent()! + RESEND_S * 1000)
    else void request()
  }, [phone])

  const verify = async (value: string) => {
    const body = pendingAttempt(store.slug)?.body ?? c.lastBody.value
    if (verifying || !phone || !body) return
    setVerifying(true)
    setError(null)
    try {
      await verifyPhone(store, phone, value)
    } catch (e) {
      setError(errorText(t, e))
      setCode('')
      setVerifying(false)
      return
    }
    // Ese código ya se usó: si un 401 regresa aquí, toca uno nuevo sin esperar.
    c.otpSentAt.delete(phone)
    setVerifying(false)
    // Verificado y aun así el pedido pide código (sesión que no se guardó, 401 otra vez): se dice, no se queda callado.
    if ((await send(store, body)).kind === 'needsOtp') setError(t('otp.notUsable'))
  }

  if (!phone)
    return <button type="button" style={btn()} onClick={() => store.go('cart')}>{t('details.back')}</button>

  const busy = verifying || c.busy.value
  return (
    <div>
      <button type="button" style={{ ...btn(), marginBottom: '10px' }} onClick={() => store.go('details')}>{t('otp.change')}</button>
      <h2 style={{ margin: '0 0 6px', fontSize: '18px' }}>{t('otp.title')}</h2>
      <p style={muted}>{t('otp.sent', { phone })}</p>
      <OtpInput value={code} onChange={setCode} onComplete={v => void verify(v)} disabled={busy} />
      {busy && <p role="status" style={muted}>{t('otp.verifying')}</p>}
      {error && <p role="alert" style={{ color: 'var(--avq-danger, #b91c1c)', fontSize: '14px' }}>{error}</p>}
      <CheckoutStatus />
      <button type="button" style={{ ...btn(), marginTop: '10px' }} disabled={wait > 0 || busy} onClick={() => void request()}>
        {wait > 0 ? t('otp.resendIn', { s: wait }) : t('otp.resend')}
      </button>
    </div>
  )
}
