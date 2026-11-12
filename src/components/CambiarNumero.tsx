import { h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { TFunction } from '../i18n'
import * as api from '../api/booking'
import { DEFAULT_DIAL, phoneE164 } from '../data/countries'
import { epocaDelNegocio, guardarSesion, leerSesion, salidaDe, versionDelToken, type SesionEmitida, type Superficie } from '../lib/sesionDeCliente'
import { Button } from './ui/Button'
import { CountryPhoneInput } from './ui/CountryPhoneInput'
import { OtpInput } from './ui/OtpInput'
import { Spinner } from './ui/Spinner'

// W6 (S8, P2-1): «Cambiar mi número», dentro de «Mi cuenta» (reservas y la tienda). Nunca se edita el campo: el número NUEVO se prueba
// con su código por WhatsApp, con la sesión de la superficie. Al confirmarlo, el SERVIDOR responde la sesión de REEMPLAZO (las de antes
// de esa ficha dejan de valer): se guarda y la superficie la adopta como al entrar (`onListo`), sin releer lo guardado. La v2 no tiene
// mockup de esta pantalla: copia la de entrar (1k).

type Paso = 'numero' | 'codigo' | 'reentrar' | 'otraFicha'

interface Props {
  slug: string
  superficie: Superficie
  t: TFunction
  /** El token de la superficie AHORA. */
  token: () => string | null
  /** Ya se guardó la sesión de reemplazo: la superficie la adopta. `numero` como se lee («55 9876 5432»). */
  onListo: (r: SesionEmitida, numero: string) => void
  /** «Entrar otra vez» (sesión sin contacto probado) o «Entrar con mi teléfono» (el número es de otra ficha). */
  onReentrar: () => void
  onVolver: () => void
  /** Un 401 que no es `CUSTOMER_REAUTH_REQUIRED`, o la sesión que lo pidió ya no está guardada: se suelta (nunca la de otra persona). */
  on401: (err: any, token: string) => void
}

const ESPERA_S = 30
/** Como se lee en México: «+525598765432» ⇒ «55 9876 5432»; de otro país, tal cual. */
const comoSeLee = (e164: string) => (/^\+52\d{10}$/.test(e164) ? e164.slice(3).replace(/(\d{2})(\d{4})(\d{4})/, '$1 $2 $3') : e164)
const titulo = { fontSize: '18px', fontWeight: '700', color: 'var(--avq-fg, #111827)', margin: '0 0 6px' }
const texto = { fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }
const etiqueta = { display: 'block', fontSize: '13px', fontWeight: '500', color: 'var(--avq-fg, #111827)', marginBottom: '6px' }
const columna = { display: 'flex', flexDirection: 'column', gap: '12px' }
const enlace = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '10px 4px', minHeight: '44px',
  color: 'var(--avq-accent, #6366f1)', fontWeight: '500', fontSize: '13px',
}

export function CambiarNumero({ slug, superficie, t, token, onListo, onReentrar, onVolver, on401 }: Props) {
  const [paso, setPaso] = useState<Paso>('numero')
  const [dial, setDial] = useState(DEFAULT_DIAL)
  const [numero, setNumero] = useState('')
  const [codigo, setCodigo] = useState('')
  // codex-w5w6-r1 #2: el número al que SÍ se pidió el código, fijado al pedirlo; reenviar y confirmar van a ése, no al del campo.
  const [destino, setDestino] = useState('')
  const [espera, setEspera] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  // `sinRed`: no hubo respuesta (o pasaron 20 s). Es un estado normal: ámbar, no rojo.
  const [error, setError] = useState<{ texto: string; sinRed: boolean } | null>(null)
  const enVuelo = useRef(false)
  const encabezado = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!espera) return
    const id = setTimeout(() => setEspera(s => s - 1), 1000)
    return () => clearTimeout(id)
  }, [espera])
  // Cada paso nuevo lleva el foco a su título; al abrirse, también (se llegó tocando «Cambiar mi número»).
  useEffect(() => {
    encabezado.current?.focus({ preventScroll: true })
  }, [paso])

  const digitos = numero.replace(/\D/g, '')
  // El mismo número que se manda (`phoneE164` quita la lada que la persona repitió).
  const nuevo = phoneE164(dial, numero)

  function fallar(e: any, tkn: string, enCodigo: boolean) {
    const code = e?.data?.code
    if (e?.status === 401) {
      // La sesión sirve para lo demás: sólo no probó un contacto. Cualquier otro 401 la cierra.
      if (code === 'CUSTOMER_REAUTH_REQUIRED') return setPaso('reentrar')
      return on401(e, tkn)
    }
    if (code === 'TELEFONO_DE_OTRA_FICHA') return setPaso('otraFicha')
    // Sólo un rechazo del SERVIDOR invalida el código escrito; sin red el mismo sigue sirviendo.
    if (enCodigo && e?.status) setCodigo('')
    setError(
      !e?.status ? { texto: t('entrar.sinRed'), sinRed: true }
      : code === 'CUSTOMER_PHONE_SAME' ? { texto: t('cambiarNumero.mismo'), sinRed: false }
      // D17: el SERVIDOR dice que WhatsApp no aceptó el código: no se pasa al paso del código y se puede pedir otro enseguida.
      : code === 'OTP_SEND_FAILED' ? { texto: t('entrar.noSalioWhatsapp'), sinRed: false }
      : e.status === 429 ? { texto: t('entrar.muchosIntentos'), sinRed: false }
      : e.status >= 500 && !code ? { texto: t('errors.generic'), sinRed: false }
      : { texto: e.data?.message || t('errors.generic'), sinRed: false },
    )
  }

  /**
   * Una petición a la vez, con el token de la superficie. Si mientras iba cambió la sesión en este documento (época), no pinta. Salvo
   * `listoDecide`: la respuesta de confirmar decide sola con su regla (abajo), porque un 401 de la sesión vieja también cambia la época.
   */
  async function intentar<T>(llamar: (tkn: string) => Promise<T>, listo: (r: T, tkn: string) => void, listoDecide = false) {
    const tkn = token()
    if (!tkn || enVuelo.current) return
    enVuelo.current = true
    const epoca = epocaDelNegocio(slug)
    const enCodigo = paso === 'codigo'
    setOcupado(true)
    setError(null)
    try {
      const r = await llamar(tkn)
      if (listoDecide || epocaDelNegocio(slug) === epoca) listo(r, tkn)
    } catch (e) {
      if (epocaDelNegocio(slug) === epoca) fallar(e, tkn, enCodigo)
    } finally {
      enVuelo.current = false
      setOcupado(false)
    }
  }

  const pedirCodigo = (tel: string, alLlegar: () => void) =>
    void intentar(tkn => api.pedirCambioDeNumero(slug, tkn, tel, superficie), alLlegar)
  const enviar = (e: Event) => {
    e.preventDefault()
    if (!digitos) return setError({ texto: t('entrar.faltaTelefono'), sinRed: false })
    const tel = nuevo // el que sale en ESTA petición, aunque el campo cambie mientras va
    pedirCodigo(tel, () => {
      setDestino(tel)
      setCodigo('')
      setEspera(ESPERA_S)
      setPaso('codigo')
    })
  }
  const verificar = (valor: string) => {
    if (valor.length < 6) return
    const tel = destino
    const salida = salidaDe(slug)
    void intentar(tkn => api.confirmarCambioDeNumero(slug, tkn, tel, valor, superficie), (r, tkn) => {
      // Regla única de la sesión de reemplazo (codex-w5w6-r1 #1, r2 #1 y r3 #1; `inventario-reemplazo-w6.md`): el SERVIDOR ya cambió el
      // número y dejó sin valor toda sesión anterior de ESA ficha. Se escribe y se adopta salvo que, mientras iba, alguien cerrara sesión
      // a propósito (en cualquier pestaña: `salidaDe`), lo guardado sea de OTRA persona, o sea una versión MÁS NUEVA de la misma (otro
      // cambio de número posterior, en otra pestaña). Un 401 de la sesión vieja, una renovación o lo guardado vacío por ese 401 no lo
      // impiden. Si no se escribe, la página queda sin sesión (la suya ya no vale).
      const guardada = leerSesion(slug)
      const vGuardada = guardada ? versionDelToken(guardada.token) : null
      const vNueva = versionDelToken(r.token)
      const masNueva = vGuardada !== null && vNueva !== null && vGuardada > vNueva
      if (salidaDe(slug) !== salida || (guardada && (guardada.customer.id !== r.customer.id || masNueva))) return on401(null, tkn)
      // codex-r3 H7: si el navegador no la deja guardar, no se adopta una sesión que nadie recordará.
      if (guardarSesion(slug, { token: r.token, customer: r.customer, contactos: r.contactos, guardadaEn: Date.now() }) === 'fallo') {
        return setError({ texto: t('entrar.noSeGuardo'), sinRed: false })
      }
      onListo(r, comoSeLee(r.customer.phone || tel))
    }, true)
  }

  const avisoDeError = error && (
    <p role="alert" style={{ fontSize: '13px', margin: 0, color: error.sinRed ? '#92400e' : '#ef4444' }}>{error.texto}</p>
  )
  const cabeza = (tituloTexto: string, intro?: string) => (
    <div style={{ textAlign: 'center', marginBottom: '8px' }}>
      <h2 ref={encabezado} tabIndex={-1} style={{ ...titulo, outline: 'none' }}>{tituloTexto}</h2>
      {intro && <p style={texto}>{intro}</p>}
    </div>
  )
  const volver = (
    <button type="button" style={{ ...enlace, color: 'var(--avq-muted-fg, #6b7280)', alignSelf: 'center' }} onClick={onVolver}>
      {t('cuenta.volverACuenta')}
    </button>
  )

  if (paso === 'reentrar')
    return (
      <div class="avq-animate-in" style={columna}>
        {cabeza(t('cambiarNumero.reentrar'), t('cambiarNumero.reentrarAyuda'))}
        <Button fullWidth onClick={onReentrar}>{t('cuenta.entrarOtraVez')}</Button>
        {volver}
      </div>
    )

  // P2-1: el número es de otra ficha y nada se movió. El aviso de las dos fichas (no promete unirlas).
  if (paso === 'otraFicha')
    return (
      <div class="avq-animate-in" style={columna}>
        {cabeza(t('entrar.otraFichaTitulo'), t('entrar.otraFichaTelefono'))}
        <p style={{ ...texto, textAlign: 'center', color: 'var(--avq-fg, #111827)', fontWeight: '600' }}>{t('cambiarNumero.noCambio')}</p>
        <Button variant="outline" fullWidth onClick={onReentrar}>{t('entrar.entrarConTelefono')}</Button>
        {volver}
      </div>
    )

  if (paso === 'codigo')
    return (
      <form class="avq-animate-in" style={columna} onSubmit={e => { e.preventDefault(); verificar(codigo) }}>
        <button type="button" style={{ ...enlace, color: 'var(--avq-muted-fg, #6b7280)', alignSelf: 'flex-start' }}
          onClick={() => { setError(null); setPaso('numero') }}>
          <span aria-hidden="true">← </span>{t('entrar.atras')}
        </button>
        {cabeza(t('cambiarNumero.titulo'))}
        {/* D17: el SERVIDOR no garantiza que el WhatsApp salió: se dice que se pidió y qué hacer si no llega. */}
        <p style={{ ...texto, textAlign: 'center' }}>{t('entrar.pedimosWhatsapp', { numero: comoSeLee(destino) })}</p>
        <div>
          <label style={etiqueta}>{t('otp.codeLabel')}</label>
          <OtpInput value={codigo} onChange={setCodigo} onComplete={verificar} disabled={ocupado} />
        </div>
        {ocupado && <p role="status" style={{ ...texto, fontSize: '13px' }}>{t('entrar.verificando')}</p>}
        {avisoDeError}
        <Button type="submit" fullWidth disabled={ocupado || codigo.length < 6}>{ocupado ? <Spinner size={18} /> : t('cambiarNumero.confirmar')}</Button>
        <button type="button" style={{ ...enlace, alignSelf: 'center', ...(espera > 0 ? { color: 'var(--avq-muted-fg, #6b7280)', cursor: 'default' } : {}) }}
          disabled={espera > 0 || ocupado} onClick={() => pedirCodigo(destino, () => setEspera(ESPERA_S))}>
          {espera > 0 ? t('otp.resendIn', { s: espera }) : t('otp.resend')}
        </button>
      </form>
    )

  return (
    <form class="avq-animate-in" style={columna} onSubmit={enviar}>
      {cabeza(t('cambiarNumero.titulo'), t('cambiarNumero.intro'))}
      <div>
        <label style={etiqueta}>{t('cambiarNumero.etiqueta')}</label>
        <CountryPhoneInput
          dialCode={dial}
          nationalNumber={numero}
          onDialCodeChange={setDial}
          onNationalNumberChange={v => { setNumero(v); setError(null) }}
          numberPlaceholder={t('form.phonePlaceholder')}
          searchPlaceholder={t('otp.countrySearchPlaceholder')}
          noResultsText={t('otp.countryNoResults')}
        />
      </div>
      {avisoDeError}
      <Button type="submit" fullWidth disabled={ocupado}>{ocupado ? <Spinner size={18} /> : t('otp.sendCode')}</Button>
      {volver}
    </form>
  )
}
