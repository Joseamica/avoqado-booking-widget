import { h } from 'preact'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import type { TFunction } from '../i18n'
import * as api from '../api/booking'
import { DEFAULT_DIAL, phoneE164 } from '../data/countries'
import { esDeAvoqado, guardarSesion, leerSesion, type FichaNueva, type SesionEmitida } from '../lib/sesionDeCliente'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { CountryPhoneInput } from './ui/CountryPhoneInput'
import { OtpInput } from './ui/OtpInput'
import { Spinner } from './ui/Spinner'

// W2 (P2-1, mockups v2 1k y 1l): entrar sin contraseña. WhatsApp primero; correo y Google de respaldo. Si el contacto no tiene ficha,
// se pregunta una vez «¿Ya eres cliente…?»: «Sí» prueba el otro contacto y lo liga a ESA ficha (`vincular`); «No» crea la ficha con
// la prueba del primero y su nombre (obligatorio en el alta, founder 14-oct). Dos fichas nunca se unen: se avisa de la otra.

type Paso = 'inicio' | 'contacto' | 'codigo' | 'pregunta' | 'nombre' | 'otraFicha'
type Canal = 'phone' | 'email'

interface Props {
  slug: string
  /** Nombre del negocio para los textos («¿Ya eres cliente de Mindform?»). */
  negocio?: string | null
  t: TFunction
  /** Ya entró: la sesión única ya quedó guardada (W1). */
  onEntro: (s: SesionEmitida) => void
}

const ESPERA_S = 30
// Los navegadores de Instagram y Facebook no dejan entrar con Google (Google bloquea las vistas web incrustadas).
const EN_APP = /Instagram|FBAN|FBAV|FB_IAB|FBIOS/i

const titulo = { fontSize: '18px', fontWeight: '700', color: 'var(--avq-fg, #111827)', margin: '0 0 6px' }
const texto = { fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }
const etiqueta = { display: 'block', fontSize: '13px', fontWeight: '500', color: 'var(--avq-fg, #111827)', marginBottom: '6px' }
const columna = { display: 'flex', flexDirection: 'column', gap: '12px' }
const enlace = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '10px 4px', minHeight: '44px',
  color: 'var(--avq-accent, #6366f1)', fontWeight: '500', fontSize: '13px',
}

/** El correo del id token de Google (su parte del medio). Sólo para seguir por código: quien lo prueba es el SERVIDOR. */
function correoDe(idToken: string): string | null {
  try {
    const p = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const email = JSON.parse(atob(p + '==='.slice((p.length + 3) % 4))).email
    return typeof email === 'string' ? email : null
  } catch {
    return null
  }
}

export function EntrarConCuenta({ slug, negocio, t, onEntro }: Props) {
  const nombreNegocio = negocio || t('entrar.esteNegocio')
  const [paso, setPaso] = useState<Paso>('inicio')
  const [canal, setCanal] = useState<Canal>('phone')
  const [dial, setDial] = useState(DEFAULT_DIAL)
  const [numero, setNumero] = useState('')
  const [correo, setCorreo] = useState('')
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [espera, setEspera] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  // `sinRed`: no hubo respuesta (o pasaron 20 s). Es un estado normal: ámbar, no rojo.
  const [error, setError] = useState<{ texto: string; sinRed: boolean } | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // La prueba del PRIMER contacto sin ficha (S7, 15 min): con «Sí» se liga al siguiente; con «No» crea la ficha.
  const [prueba, setPrueba] = useState<{ token: string; contacto: string; canal: Canal } | null>(null)
  // «Sí» con otro contacto que tampoco tiene ficha.
  const [tampoco, setTampoco] = useState<{ contacto: string; canal: Canal } | null>(null)
  const [conOtraFicha, setConOtraFicha] = useState<SesionEmitida | null>(null)
  const idNombre = useId()
  const encabezado = useRef<HTMLHeadingElement>(null)
  const primerPintado = useRef(true)

  useEffect(() => {
    if (!espera) return
    const id = setTimeout(() => setEspera(s => s - 1), 1000)
    return () => clearTimeout(id)
  }, [espera])
  // Cada paso nuevo lleva el foco a su título (un lector de pantalla oye dónde quedó); al montarse no se lo roba a la página.
  useEffect(() => {
    if (primerPintado.current) primerPintado.current = false
    else encabezado.current?.focus({ preventScroll: true })
  }, [paso])

  const idGoogle = import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined
  // Fuera de avoqado.io Google no reconoce el origen (su cliente web sólo autoriza book. y pedidos.): ahí no se ofrece.
  const google = !idGoogle || !esDeAvoqado() ? null : EN_APP.test(navigator.userAgent) ? 'enApp' : 'boton'

  const destino = () => (canal === 'phone' ? { phone: phoneE164(dial, numero) } : { email: correo.trim() })
  // Como se lee en México: «55 4442 2262»; de otro país, con su lada.
  const digitos = numero.replace(/\D/g, '')
  const visible = () =>
    canal === 'email' ? correo.trim()
    : dial === '52' && digitos.length === 10 ? digitos.replace(/(\d{2})(\d{4})(\d{4})/, '$1 $2 $3')
    : `+${dial} ${digitos}`

  function reiniciar() {
    setPaso('inicio')
    setPrueba(null)
    setTampoco(null)
    setCodigo('')
    setAviso(null)
  }
  function fallar(e: any) {
    if (e?.data?.code === 'CUSTOMER_PROOF_INVALID') {
      reiniciar()
      setError({ texto: t('entrar.pruebaVencida'), sinRed: false })
    } else if (!e?.status) setError({ texto: t('entrar.sinRed'), sinRed: true })
    else if (e.status === 429) setError({ texto: t('entrar.muchosIntentos'), sinRed: false })
    else if (e.status >= 500 && !e.data?.code) setError({ texto: t('errors.generic'), sinRed: false })
    else setError({ texto: e.data?.message || t('errors.generic'), sinRed: false })
  }
  function terminar(r: SesionEmitida | FichaNueva, contacto: string, canalUsado: Canal) {
    if ('fichaNueva' in r) {
      if (prueba) setTampoco({ contacto, canal: canalUsado })
      else setPrueba({ token: r.pruebaPendiente, contacto, canal: canalUsado })
      setPaso('pregunta')
      return
    }
    if (guardarSesion(slug, { token: r.token, customer: r.customer, contactos: r.contactos, guardadaEn: Date.now() }) === 'fallo') {
      // codex-r3 H7: el navegador no dejó guardarla (cuota llena, modo privado): no se entra con una sesión que nadie recordará.
      reiniciar()
      setError({ texto: t('entrar.noSeGuardo'), sinRed: false })
      return
    }
    if (r.otraFicha) {
      setConOtraFicha(r)
      setPaso('otraFicha')
    } else onEntro(r)
  }
  async function intentar(fn: () => Promise<void>) {
    if (ocupado) return
    setOcupado(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      fallar(e)
      // Sólo un rechazo del SERVIDOR invalida lo escrito; sin red el mismo código sigue sirviendo (codex-r2 #6).
      if ((e as any)?.status) setCodigo('')
    } finally {
      setOcupado(false)
    }
  }

  const pedirCodigo = (e?: Event) => {
    e?.preventDefault()
    if (canal === 'phone' ? !digitos : !correo.trim()) {
      setError({ texto: t(canal === 'phone' ? 'entrar.faltaTelefono' : 'entrar.faltaCorreo'), sinRed: false })
      return
    }
    setAviso(null)
    void intentar(async () => {
      await api.requestOtp(slug, destino())
      setCodigo('')
      setEspera(ESPERA_S)
      setPaso('codigo')
    })
  }
  const reenviar = () => {
    if (espera > 0) return
    setAviso(null)
    void intentar(async () => {
      await api.requestOtp(slug, destino())
      setEspera(ESPERA_S)
    })
  }
  const verificar = (valor: string) => {
    if (valor.length < 6) return
    void intentar(async () => {
      const r = await api.verifyOtp(slug, { ...destino(), code: valor, ...(prueba ? { vincular: prueba.token } : {}) })
      terminar(r, visible(), canal)
    })
  }
  const conGoogle = (idToken: string) =>
    intentar(async () => {
      try {
        terminar(await api.entrarConGoogle(slug, { idToken, ...(prueba ? { vincular: prueba.token } : {}) }), correoDe(idToken) ?? '', 'email')
      } catch (e: any) {
        if (e?.data?.code !== 'GOOGLE_EMAIL_NOT_TRUSTED') throw e
        // Google no da ese correo por suyo: el SERVIDOR ya le mandó un código ahí. Se confirma por correo, sin pedir otro.
        const c = correoDe(idToken)
        setCanal('email')
        setAviso(t('entrar.googleNoConfiable'))
        if (c) {
          setCorreo(c)
          setCodigo('')
          setEspera(ESPERA_S)
          setPaso('codigo')
        } else setPaso('contacto')
      }
    })
  const crearFicha = (e?: Event) => {
    e?.preventDefault()
    if (!prueba) return
    if (!nombre.trim()) {
      setError({ texto: t('otp.nameRequired'), sinRed: false })
      return
    }
    void intentar(async () => {
      terminar(await api.crearFichaNueva(slug, { pruebaPendiente: prueba.token, firstName: nombre.trim() }), '', 'phone')
    })
  }

  const avisoDeError = error && (
    <p role="alert" style={{ fontSize: '13px', margin: 0, color: error.sinRed ? '#92400e' : '#ef4444' }}>{error.texto}</p>
  )
  const atras = (a: () => void) => (
    <button type="button" style={{ ...enlace, color: 'var(--avq-muted-fg, #6b7280)', alignSelf: 'flex-start' }} onClick={() => { setError(null); a() }}>
      <span aria-hidden="true">← </span>{t('entrar.atras')}
    </button>
  )
  const cabeza = (tituloTexto: string, intro?: string) => (
    <div style={{ textAlign: 'center', marginBottom: '8px' }}>
      <h2 ref={encabezado} tabIndex={-1} style={{ ...titulo, outline: 'none' }}>{tituloTexto}</h2>
      {intro && <p style={texto}>{intro}</p>}
    </div>
  )

  if (paso === 'inicio')
    return (
      <div class="avq-animate-in" style={columna}>
        {cabeza(
          prueba ? t('entrar.tituloOtro') : t('entrar.titulo'),
          prueba ? t('entrar.introOtro') : t('entrar.intro', { negocio: nombreNegocio }),
        )}
        <div data-testid="avq-entrar-opciones" style={columna}>
          <Button fullWidth onClick={() => { setCanal('phone'); setError(null); setPaso('contacto') }}>{t('entrar.whatsapp')}</Button>
          <Button variant="outline" fullWidth onClick={() => { setCanal('email'); setError(null); setPaso('contacto') }}>{t('entrar.correo')}</Button>
          {google === 'boton' && <BotonDeGoogle clientId={idGoogle!} onCredencial={c => void conGoogle(c)} />}
          {google === 'enApp' && <p style={{ ...texto, fontSize: '13px', textAlign: 'center' }}>{t('entrar.googleEnApp')}</p>}
        </div>
        {ocupado && <div role="status" style={{ display: 'flex', justifyContent: 'center' }}><Spinner size={18} /></div>}
        {avisoDeError}
      </div>
    )

  if (paso === 'contacto')
    return (
      <form class="avq-animate-in" style={columna} onSubmit={pedirCodigo}>
        {atras(() => setPaso('inicio'))}
        {cabeza(canal === 'phone' ? t('otp.title') : t('otp.titleEmail'))}
        {aviso && <p role="status" style={texto}>{aviso}</p>}
        {canal === 'phone' ? (
          <div>
            <label style={etiqueta}>{t('otp.phoneLabel')}</label>
            <CountryPhoneInput
              dialCode={dial}
              nationalNumber={numero}
              onDialCodeChange={setDial}
              onNationalNumberChange={setNumero}
              numberPlaceholder={t('form.phonePlaceholder')}
              searchPlaceholder={t('otp.countrySearchPlaceholder')}
              noResultsText={t('otp.countryNoResults')}
            />
          </div>
        ) : (
          <div>
            <label style={etiqueta}>{t('otp.emailLabel')}</label>
            <Input type="email" value={correo} autoComplete="email" placeholder={t('form.emailPlaceholder')}
              onInput={e => setCorreo((e.target as HTMLInputElement).value)} />
          </div>
        )}
        {avisoDeError}
        <Button type="submit" fullWidth disabled={ocupado}>{ocupado ? <Spinner size={18} /> : t('otp.sendCode')}</Button>
      </form>
    )

  if (paso === 'codigo')
    return (
      <form class="avq-animate-in" style={columna} onSubmit={e => { e.preventDefault(); verificar(codigo) }}>
        {atras(() => { setAviso(null); setPaso('contacto') })}
        {cabeza(canal === 'phone' ? t('otp.title') : t('otp.titleEmail'))}
        {aviso && <p role="status" style={{ ...texto, color: 'var(--avq-fg, #111827)', textAlign: 'center' }}>{aviso}</p>}
        <div style={{ textAlign: 'center' }}>
          <p style={texto}>{canal === 'phone' ? t('otp.sent') : t('otp.sentEmail')}</p>
          <p style={{ ...texto, fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>{visible()}</p>
        </div>
        <div>
          <label style={etiqueta}>{t('otp.codeLabel')}</label>
          <OtpInput value={codigo} onChange={setCodigo} onComplete={verificar} disabled={ocupado} />
        </div>
        {ocupado && <p role="status" style={{ ...texto, fontSize: '13px' }}>{t('entrar.verificando')}</p>}
        {avisoDeError}
        <Button type="submit" fullWidth disabled={ocupado || codigo.length < 6}>{ocupado ? <Spinner size={18} /> : t('otp.verify')}</Button>
        <button type="button" style={{ ...enlace, alignSelf: 'center', ...(espera > 0 ? { color: 'var(--avq-muted-fg, #6b7280)', cursor: 'default' } : {}) }}
          disabled={espera > 0 || ocupado} onClick={reenviar}>
          {espera > 0 ? t('otp.resendIn', { s: espera }) : t('otp.resend')}
        </button>
      </form>
    )

  if (paso === 'pregunta') {
    const de = tampoco ?? prueba!
    const llave = `entrar.${tampoco ? 'tampoco' : 'noEncontramos'}${de.canal === 'phone' ? 'Telefono' : 'Correo'}`
    return (
      <div class="avq-animate-in" style={columna}>
        {atras(reiniciar)}
        {cabeza(t('entrar.yaEresCliente', { negocio: nombreNegocio }), `${t(llave, { contacto: de.contacto })} ${t('entrar.siVienes')}`)}
        {/* Los dos pesan igual a propósito: un «No» por prisa le crea una ficha en cero. */}
        <Button variant="outline" fullWidth onClick={() => { setTampoco(null); setError(null); setPaso('inicio') }}>{t('entrar.si')}</Button>
        <Button variant="outline" fullWidth onClick={() => { setError(null); setPaso('nombre') }}>{t('entrar.no')}</Button>
        {avisoDeError}
      </div>
    )
  }

  if (paso === 'nombre')
    return (
      <form class="avq-animate-in" style={columna} onSubmit={crearFicha}>
        {atras(() => setPaso('pregunta'))}
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <h2 ref={encabezado} tabIndex={-1} style={{ ...titulo, outline: 'none' }}><label for={idNombre}>{t('otp.nameLabel')}</label></h2>
          <p style={texto}>{t('entrar.nombreAyuda', { negocio: nombreNegocio })}</p>
        </div>
        <Input id={idNombre} value={nombre} maxLength={60} autoComplete="given-name" placeholder={t('otp.namePlaceholder')}
          onInput={e => setNombre((e.target as HTMLInputElement).value)} />
        {avisoDeError}
        <Button type="submit" fullWidth disabled={ocupado}>{ocupado ? <Spinner size={18} /> : t('entrar.crearCuenta')}</Button>
      </form>
    )

  // Entró, y uno de sus contactos tiene beneficios en otra ficha. No se promete unirlas: se le dice con cuál entrar.
  const otra = conOtraFicha!.otraFicha!
  // «Seguir» sólo con la sesión que sigue guardada: si mientras tanto salió (o entró otra) en otra página, no se revive (codex-r3 H6).
  const seguir = () => {
    if (leerSesion(slug)?.token === conOtraFicha!.token) return onEntro(conOtraFicha!)
    reiniciar()
    setError({ texto: t('entrar.sesionCerrada'), sinRed: false })
  }
  return (
    <div class="avq-animate-in" style={columna}>
      {cabeza(t('entrar.otraFichaTitulo'), t(otra.contacto === 'EMAIL' ? 'entrar.otraFichaCorreo' : 'entrar.otraFichaTelefono'))}
      <Button variant="outline" fullWidth onClick={() => { reiniciar(); setCanal(otra.contacto === 'EMAIL' ? 'email' : 'phone'); setPaso('contacto') }}>
        {t(otra.contacto === 'EMAIL' ? 'entrar.entrarConCorreo' : 'entrar.entrarConTelefono')}
      </Button>
      <Button fullWidth onClick={seguir}>{t('entrar.seguir')}</Button>
    </div>
  )
}

// ---- Google (Google Identity Services) ----

let gis: Promise<any> | null = null
function cargarGoogle(): Promise<any> {
  const w = window as any
  if (w.google?.accounts?.id) return Promise.resolve(w.google)
  gis ??= new Promise((ok, mal) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => (w.google?.accounts?.id ? ok(w.google) : mal(new Error('sin Google')))
    s.onerror = () => {
      gis = null
      mal(new Error('sin Google'))
    }
    document.head.appendChild(s)
  })
  return gis
}

/**
 * El botón lo pinta Google (sus reglas de marca no dejan uno propio; su texto lo pone Google en el idioma del navegador). Si su
 * script no carga (sin red, bloqueado), no se enseña: WhatsApp y correo siguen.
 */
function BotonDeGoogle({ clientId, onCredencial }: { clientId: string; onCredencial: (idToken: string) => void }) {
  const caja = useRef<HTMLDivElement>(null)
  const alEntrar = useRef(onCredencial)
  alEntrar.current = onCredencial
  const [falla, setFalla] = useState(false)
  useEffect(() => {
    let vivo = true
    cargarGoogle().then(
      g => {
        if (!vivo || !caja.current) return
        g.accounts.id.initialize({
          client_id: clientId,
          callback: (r: { credential?: string }) => r.credential && alEntrar.current(r.credential),
        })
        g.accounts.id.renderButton(caja.current, {
          theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill',
          width: Math.min(400, Math.max(200, caja.current.offsetWidth || 320)),
        })
      },
      () => vivo && setFalla(true),
    )
    return () => {
      vivo = false
    }
  }, [clientId])
  if (falla) return null
  return <div data-testid="avq-entrar-google" ref={caja} style={{ display: 'flex', justifyContent: 'center', minHeight: '44px' }} />
}
