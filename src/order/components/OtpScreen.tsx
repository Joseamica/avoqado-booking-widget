import { h } from 'preact'
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { OrderStoreContext } from '../store'
import { createOrderT } from '../i18n'
import { ApiError, requestOrderingOtp } from '../api'
import { pendingAttempt } from '../attempt'
import { checkoutOf, errorText, phoneToVerify, send, verifyPhone } from '../checkout'
import { OtpInput } from '../../components/ui/OtpInput'
import { CheckoutStatus } from './CheckoutStatus'
import { Notice } from './StoreStatusBanner'
import { Back } from './icons'
import { focusLost } from './focus'

const RESEND_S = 30

/** Código de WhatsApp para el teléfono del pedido; al verificarlo se manda el pedido (el intento pendiente, si lo hay). */
export function OtpScreen() {
  const store = useContext(OrderStoreContext)!
  const t = createOrderT(store.locale)
  const c = checkoutOf(store)
  // El destino del código: el teléfono del pedido (no se edita aquí; «Cambiar número» sale de esta pantalla). Pedir, decir y verificar
  // usan este mismo valor (D17, como W2 y W6), y si cambiara, el efecto de abajo lo vuelve a pedir para el nuevo.
  const phone = phoneToVerify(store)
  /** Como se lee en México: «+525544422262» ⇒ «55 4442 2262»; de otro país, tal cual. */
  const leible = phone && /^\+52\d{10}$/.test(phone) ? phone.slice(3).replace(/(\d{2})(\d{4})(\d{4})/, '$1 $2 $3') : phone
  const titleId = useId()
  const introId = useId()
  const boxes = useRef<HTMLDivElement>(null)
  const [code, setCode] = useState('')
  // `offline` = no hubo respuesta usable (sin red o ni un ApiError): es un estado normal, ámbar con la nube; lo demás va en rojo.
  const [error, setError] = useState<{ text: string; offline: boolean } | null>(null)
  const [verifying, setVerifying] = useState(false)
  // D17: el SERVIDOR dijo que el código no salió (`OTP_SEND_FAILED`): sin cajas ni «Pedimos tu código…» hasta que uno sí salga.
  const notSent = !!phone && c.otpNoSalio.value === phone
  // codex-r2 #2: una petición a la vez por teléfono (dos toques en el mismo turno no mandan dos).
  const enVuelo = useRef<string | null>(null)
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
  const wait = notSent ? 0 : Math.max(0, Math.ceil((until - Date.now()) / 1000))

  // Al llegar, el cursor ya está en la primera caja (spec §5.5) con el borde de acento, sin mover la página. El teclado no se promete: iOS no
  // lo abre con un foco que no sale de un toque (aquí se llega tras una respuesta de la red), y ahí hay que tocar la caja. Va en lugar del
  // titular, que es a donde van las demás pantallas (OrderApp lo respeta: el foco ya está tomado; si la caja no pudiera tomarlo, lo toma el
  // titular); el grupo de abajo le da a las cajas el titular como nombre y «Pedimos tu código…» como descripción, para que un lector de pantalla no
  // llegue a cajas sin contexto. Y otra vez cuando un código equivocado vacía las cajas: mientras se verificaba estaban deshabilitadas y el
  // navegador les quitó el foco (en Android se cierra el teclado). Las dos veces, sólo si nadie tiene el foco: quien ya está en otro elemento,
  // de la tienda o del sitio, se queda ahí.
  useLayoutEffect(() => {
    const first = boxes.current?.querySelector('input')
    if (!verifying && !code && first && focusLost(first)) first.focus({ preventScroll: true })
  }, [verifying])

  const request = async () => {
    if (!phone || enVuelo.current === phone) return
    enVuelo.current = phone
    setError(null)
    c.otpNoSalio.value = null
    const now = Date.now()
    c.otpSentAt.set(phone, now)
    setUntil(now + RESEND_S * 1000)
    try {
      await requestOrderingOtp(store.slug, phone)
    } catch (e) {
      const offline = !(e instanceof ApiError) || e.network
      const noSalio = e instanceof ApiError && e.code === 'OTP_SEND_FAILED'
      // Sin respuesta (sin red, o ni un ApiError) se asume que el código no salió, y con `OTP_SEND_FAILED` el SERVIDOR lo dice (D17): ni
      // volver a esta pantalla ni «Reenviar código» heredan la espera de un envío que no fue. Con otro error del servidor sí se espera (no
      // se sabe si salió).
      if (offline || noSalio) {
        c.otpSentAt.delete(phone)
        setUntil(Date.now())
      }
      if (noSalio) c.otpNoSalio.value = phone
      else setError({ text: errorText(t, e), offline })
    } finally {
      if (enVuelo.current === phone) enVuelo.current = null
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
    let vigente: boolean
    try {
      vigente = await verifyPhone(store, phone, value)
    } catch (e) {
      const offline = !(e instanceof ApiError) || e.network
      setError({ text: errorText(t, e), offline })
      // codex-r3 A2: sólo un rechazo del SERVIDOR invalida lo escrito; sin red el mismo código sigue sirviendo («Reintentar»).
      if (!offline) setCode('')
      setVerifying(false)
      return
    }
    // Ese código ya se usó: si un 401 regresa aquí, toca uno nuevo sin esperar.
    c.otpSentAt.delete(phone)
    setVerifying(false)
    // codex-r8 H3: la sesión de la página cambió mientras se verificaba (salió, entró otra): no se manda nada.
    if (!vigente) return setCode('')
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
        <h2 id={titleId} class="avq-o-title" tabIndex={-1}>{t('otp.title')}</h2>
        {/* D17: el SERVIDOR no garantiza que el WhatsApp salió: se dice que se pidió y qué hacer si no llega. */}
        {!notSent && <p id={introId}>{t('otp.sent', { phone: leible ?? '' })}</p>}
      </div>
      <div class="avq-o-otp__code">
        {!notSent && (
          <div ref={boxes} role="group" aria-labelledby={titleId} aria-describedby={introId}>
            <OtpInput look="tienda" value={code} onChange={setCode} onComplete={v => void verify(v)} disabled={busy} />
          </div>
        )}
        {busy && <p role="status" class="avq-o-help">{t('otp.verifying')}</p>}
        {notSent && <p role="alert" class="avq-o-issue">{t('otp.notSent')}</p>}
        {error && (error.offline
          ? <Notice role="alert" tone="warn" icon="cloudOff" text={error.text} />
          : <p role="alert" class="avq-o-issue">{error.text}</p>)}
        {error?.offline && code.length === 6 && !busy && (
          <button type="button" class="avq-o-btn avq-o-btn--quiet" onClick={() => void verify(code)}>{t('common.retry')}</button>
        )}
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
