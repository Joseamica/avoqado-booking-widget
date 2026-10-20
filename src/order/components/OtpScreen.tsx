import { h } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { ApiError, requestOrderingOtp } from '../api'
import { pendingAttempt } from '../attempt'
import { checkoutOf, errorText, phoneToVerify, send, verifyPhone } from '../checkout'
import { OtpInput } from '../../components/ui/OtpInput'
import { CheckoutStatus } from './CheckoutStatus'
import { Notice } from './StoreStatusBanner'
import { Back } from './icons'

const RESEND_S = 30

/** Código de WhatsApp para el teléfono del pedido; al verificarlo se manda el pedido (el intento pendiente, si lo hay). */
export function OtpScreen() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const c = checkoutOf(store)
  const phone = phoneToVerify(store)
  const [code, setCode] = useState('')
  // `offline` = no hubo respuesta usable (sin red o ni un ApiError): es un estado normal, ámbar con la nube; lo demás va en rojo.
  const [error, setError] = useState<{ text: string; offline: boolean } | null>(null)
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
      const offline = !(e instanceof ApiError) || e.network
      // Sin red el código no salió: volver a esta pantalla lo pide otra vez (no hereda una espera de un envío que no fue).
      if (offline) c.otpSentAt.delete(phone)
      setError({ text: errorText(t, e), offline })
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
      setError({ text: errorText(t, e), offline: !(e instanceof ApiError) || e.network })
      setCode('')
      setVerifying(false)
      return
    }
    // Ese código ya se usó: si un 401 regresa aquí, toca uno nuevo sin esperar.
    c.otpSentAt.delete(phone)
    setVerifying(false)
    // Verificado y aun así el pedido pide código (sesión que no se guardó, 401 otra vez): se dice, no se queda callado.
    if ((await send(store, body)).kind === 'needsOtp') setError({ text: t('otp.notUsable'), offline: false })
  }

  if (!phone)
    return (
      <div class="avq-o-otp">
        <button type="button" class="avq-o-btn avq-o-btn--quiet avq-o-otp__back" onClick={() => store.go('cart')}><Back />{t('details.back')}</button>
      </div>
    )

  const busy = verifying || c.busy.value
  return (
    <div class="avq-o-otp">
      <button type="button" class="avq-o-btn avq-o-btn--quiet avq-o-otp__back" onClick={() => store.go('details')}><Back />{t('otp.change')}</button>
      <div class="avq-o-otp__intro">
        <h2 class="avq-o-title">{t('otp.title')}</h2>
        <p>{t('otp.sent', { phone })}</p>
      </div>
      <div class="avq-o-otp__code">
        <OtpInput look="tienda" value={code} onChange={setCode} onComplete={v => void verify(v)} disabled={busy} />
        {busy && <p role="status" class="avq-o-help">{t('otp.verifying')}</p>}
        {error && (error.offline
          ? <Notice role="alert" tone="warn" icon="cloudOff" text={error.text} />
          : <p role="alert" class="avq-o-issue">{error.text}</p>)}
      </div>
      <CheckoutStatus />
      <div class="avq-o-otp__more">
        <button type="button" class="avq-o-btn avq-o-btn--quiet" disabled={wait > 0 || busy} onClick={() => void request()}>
          {wait > 0 ? t('otp.resendIn', { s: wait }) : t('otp.resend')}
        </button>
        <p class="avq-o-help">{t('otp.help')}</p>
      </div>
    </div>
  )
}
