import { h } from 'preact'
import { useState, useEffect, useRef, useId } from 'preact/hooks'
import type { TFunction } from '../i18n'
import type { CreditPackPublic, CustomerPortalData, MiTarjeta } from '../types'
import { Spinner } from './ui/Spinner'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { EntrarConCuenta } from './EntrarConCuenta'
import { CambiarNumero, comoSeLee } from './CambiarNumero'
import * as api from '../api/booking'
import {
  customerToken, setCustomerSession, clearCustomerSession, venueInfo, entroAqui, lectorDe,
} from '../state/booking'
import { cuentaDe, leerCuenta } from '../state/miCuenta'
import { alCambiarLaPagina, epocaDe, paginaDe, soltarLaPagina, type SesionEmitida, type Superficie } from '../lib/sesionDeCliente'
import { FOLIO_CAMBIO, trackingUrl, type FolioCambioDetail } from '../order/events'

interface CustomerPortalProps {
  venueSlug: string
  timezone: string
  /** Venue phone — used in the empty state of "Buy credits" so customers can reach out. */
  venuePhone?: string | null
  t: TFunction
  onBack: () => void
  onManageBooking: (cancelSecret: string) => void
  /** W4: la superficie que monta «Mi cuenta». `pedidos` = dentro de la tienda: manda con la sesión de la tienda; sin contraseña, perfil ni paquetes. */
  superficie?: Superficie
  /** W4: abrir el seguimiento de un pedido. Por omisión, su liga. */
  onVerPedido?: (trackingToken: string) => void
  /** W4 (tienda): el folio de este aparato con la línea exacta de su seguimiento («Paga en caja antes de las 10:42.»). */
  pedidoDeHoy?: { folio: string; estado: string; pagado: boolean; linea: string; trackingToken: string } | null
  /** W4 (tienda): entró o salió en «Mi cuenta»; por omisión, la sesión de reservas. */
  alEntrar?: (r: SesionEmitida) => void
  alSalir?: () => void
  /** W4 (tienda): el nombre del negocio para «¿Ya eres cliente de…?» (en la tienda no hay `venueInfo` de reservas). */
  negocio?: string | null
  /**
   * Pulido W6 (tienda): su flecha es el ÚNICO «atrás». Aquí se le presta el paso anterior (`null` = no hay: sale al menú): el de lo de
   * adentro (entrar, cambiar el número) y, si no, el de «Mi cuenta» (de «Usar en caja», «Cambiar mi número» o «Entrar otra vez»).
   */
  alCambiarAtras?: (atras: (() => void) | null) => void
}

const statusConfig: Record<string, { bg: string; text: string }> = {
  PENDING: { bg: '#fef9c3', text: '#854d0e' },
  CONFIRMED: { bg: '#dcfce7', text: '#166534' },
  CHECKED_IN: { bg: '#dbeafe', text: '#1e40af' },
  COMPLETED: { bg: '#f3f4f6', text: '#1f2937' },
  CANCELLED: { bg: '#fee2e2', text: '#991b1b' },
  NO_SHOW: { bg: '#ffedd5', text: '#9a3412' },
}

const labelStyle: Record<string, string> = {
  display: 'block', fontSize: '13px', fontWeight: '500',
  color: 'var(--avq-fg, #111827)', marginBottom: '6px',
}

// W4: los bloques de «Mi cuenta» (mockups v2 1f, 1g, 1m y 1f·2), con los tokens del contenedor (tienda clara o reservas clara/oscura).
const bloque = { margin: '0 0 12px', padding: '14px 16px', borderRadius: '16px', background: 'var(--avq-muted, #F4F4F4)' }
const tituloBloque = { margin: '0 0 4px', color: 'var(--avq-muted-fg, #4A4A4A)', fontSize: '13px', fontWeight: '600' }
const grande = {
  margin: 0, fontFamily: 'var(--avq-o-display, inherit)', fontWeight: '800', fontSize: '24px', lineHeight: '1.15', color: 'var(--avq-fg, #000)',
}
const chico = { display: 'block', margin: '3px 0 0', color: 'var(--avq-muted-fg, #5E5E5E)', fontSize: '13px', lineHeight: '1.35' }
const pildora = (verde: boolean) => ({
  display: 'inline-flex', alignItems: 'center', height: '26px', padding: '0 10px', borderRadius: '999px', fontSize: '13px', fontWeight: '600',
  background: verde ? '#EAF6EE' : 'var(--avq-bg, #FFF)', color: verde ? '#0B6B36' : 'var(--avq-muted-fg, #4A4A4A)', whiteSpace: 'nowrap',
})
const botonBlanco = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: '44px', marginTop: '10px', padding: '0 16px',
  borderRadius: '12px', border: 'none', background: 'var(--avq-bg, #FFF)', color: 'var(--avq-fg, #000)', fontSize: '15px', fontWeight: '700',
  cursor: 'pointer',
}
const botonQuieto = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: '44px', marginTop: '8px', padding: '0 8px',
  border: 'none', background: 'transparent', color: 'var(--avq-fg, #000)', fontSize: '15px', fontWeight: '600', cursor: 'pointer',
}
const aviso = (tono: 'ambar' | 'neutro') => ({
  display: 'flex', flexDirection: 'column', gap: '2px', margin: '0 0 12px', padding: '14px 16px', borderRadius: '16px', lineHeight: '1.4',
  fontSize: '14px', background: tono === 'ambar' ? '#FFF4DE' : 'var(--avq-muted, #F3F3F3)', color: tono === 'ambar' ? '#6B4300' : 'var(--avq-fg, #000)',
})
const FINALES = new Set(['COMPLETED', 'REJECTED', 'EXPIRED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_STAFF', 'PAYMENT_NOT_COMPLETED'])
type Lista = 'pedidos' | 'tarjetas' | 'descuentos'
/** «$1,234.50»: siempre con centavos, como la caja y los mockups (es y en escriben igual el dinero de México). */
const dinero = (n: number) => '$' + new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

/**
 * W4: la sesión de la superficie que monta «Mi cuenta». Reservas usa su señal; la tienda, la sesión de su página (el guardián), que se
 * repinta con cada cambio. Lo leído y su estado NO viven aquí: son UNO por negocio y superficie (`state/miCuenta.ts`).
 */
function useTokenDe(slug: string, sup: Superficie): string | null {
  const [, repintar] = useState(0)
  useEffect(() => {
    if (sup === 'reservas') return
    return alCambiarLaPagina((s, afecta) => { if (s === slug && afecta.includes(sup)) repintar(n => n + 1) })
  }, [slug, sup])
  return sup === 'reservas' ? customerToken.value : paginaDe(slug, sup)?.token ?? null
}

export function CustomerPortal({
  venueSlug, timezone, venuePhone, t, onBack, onManageBooking, superficie = 'reservas', onVerPedido, pedidoDeHoy, alEntrar, alSalir, negocio,
  alCambiarAtras,
}: CustomerPortalProps) {
  const sup = superficie
  const enTienda = sup === 'pedidos'
  // Correo y contraseña: sólo para entrar a una cuenta que YA la tiene. Toda cuenta nueva se crea con código (seguridad, 1-oct).
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // W2: entrar es `EntrarConCuenta` (WhatsApp, correo o Google, sin contraseña). Correo y contraseña quedan como opción secundaria.
  const [showEmailLogin, setShowEmailLogin] = useState(false)
  // W4: las páginas siguientes que ya trajo «Ver más», pegadas a la primera página DE LA QUE SALIERON (`base`): si «Mi cuenta» se relee
  // (aquí, en otra apertura o en otro elemento), los datos son otros y esas páginas ya no cuentan (codex-w4-r1 #3, r2 #1).
  const [mas, setMas] = useState<{ base: CustomerPortalData | null; listas: Partial<Record<Lista, { items: any[]; nextCursor: string | null }>> }>(
    { base: null, listas: {} },
  )
  const [trayendo, setTrayendo] = useState<Lista | null>(null)
  const [fallaMas, setFallaMas] = useState<Lista | null>(null)
  // W4: «Guardar en mi cuenta».
  const [codigo, setCodigo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState<{ ok: boolean; texto: string } | null>(null)
  // W4: «Usar en caja» (1m) y «Entrar otra vez» (invitada u otra ficha).
  // El id, no una copia: «Usar en caja» enseña SIEMPRE la tarjeta de los datos vigentes (codex-w4-r1 #2).
  const [usando, setUsando] = useState<string | null>(null)
  const [reentrar, setReentrar] = useState(false)
  // W6: «Cambiar mi número» abierto, y el aviso «Listo: tu número ahora es…». Los dos son de UNA sesión (la época de la superficie al
  // abrirlo, y la de la sesión de reemplazo): si entra otra persona o sale, ya no se pintan. Una renovación no los cierra.
  const [cambiando, setCambiando] = useState<number | null>(null)
  const [numeroNuevo, setNumeroNuevo] = useState<{ epoca: number; numero: string } | null>(null)
  const idCodigo = useId()
  const enVuelo = useRef({ mas: false, guardar: false })

  // Profile edit state
  const [editingProfile, setEditingProfile] = useState(false)
  const [editFirstName, setEditFirstName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState(false)

  // Credit packs state
  const [packs, setPacks] = useState<CreditPackPublic[]>([])
  const [packsLoading, setPacksLoading] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)

  const token = useTokenDe(venueSlug, sup)
  // codex-w4-r3: lo leído y su estado, UNO por negocio y superficie; todos los lectores de la página se pintan de aquí.
  const cuenta = cuentaDe(venueSlug, sup).value
  const data = cuenta.data
  // «Mi cuenta» no se pudo leer por red o por el servidor: se dice y se reintenta, sin volver a pedir que entre.
  const fallaCarga = cuenta.falla
  // Releyendo con lo anterior a la vista («Actualizando…»).
  const actualizando = cuenta.leyendo
  const extra = mas.base === data ? mas.listas : {}
  /** El token de la superficie AHORA (no el del último pintado). */
  const tokenActual = () => (sup === 'reservas' ? customerToken.value : paginaDe(venueSlug, sup)?.token ?? null)
  /** Un 401 ya soltó la sesión en el transporte; si llega de otro lado (o simulado), se suelta igual: nunca la de otra persona. */
  const soltar401 = (err: any, tkn: string) => soltarLaPagina(venueSlug, sup, err?.enviado ?? tkn, lectorDe(venueSlug, sup))

  // codex-r5 E7: si la página se queda sin sesión (401, salió), vuelve a «Entra a tu cuenta», sin el formulario de contraseña ni su error.
  useEffect(() => {
    setUsando(null)
    setMas({ base: null, listas: {} })
    setGuardado(null)
    setCodigo('')
    // codex-w4-r3 #3: el perfil que se estaba editando era de la sesión anterior.
    setEditingProfile(false)
    setEditFirstName('')
    setEditLastName('')
    if (!token) {
      setShowEmailLogin(false)
      setError(null)
      setReentrar(false)
    }
  }, [token])

  // W4 (P2-6): siempre leída de nuevo. Al abrirla (con lo anterior a la vista y «Actualizando…») y cada vez que cambia la sesión de la
  // superficie (entró, otra ficha, renovada).
  useEffect(() => {
    if (token) void loadPortal()
  }, [token])

  // W4: también al volver a la pestaña y cuando el seguimiento ve que un folio de este negocio cambió (pagado, vencido, cancelado).
  const releer = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === 'visible') void releer.current() }
    const alCambiarFolio = (e: Event) => { if ((e as CustomEvent<FolioCambioDetail>).detail?.slug === venueSlug) void releer.current() }
    document.addEventListener('visibilitychange', alVolver)
    document.addEventListener(FOLIO_CAMBIO, alCambiarFolio)
    return () => {
      document.removeEventListener('visibilitychange', alVolver)
      document.removeEventListener(FOLIO_CAMBIO, alCambiarFolio)
    }
  }, [venueSlug])

  // Una página que no se pudo traer era de la lectura anterior: con datos nuevos, el aviso se va (sus páginas también).
  useEffect(() => { setFallaMas(null) }, [data])

  // Load available credit packs when portal is shown (la tienda no vende paquetes todavía: Fase B)
  useEffect(() => {
    if (data && !enTienda) {
      loadPacks()
    }
  }, [!!data]) // una vez por apertura, no en cada relectura

  // W4 (1m): «Usar en caja», con el código de la tarjeta para que la cajera lo teclee. Sale de los datos VIGENTES: si al releer ya no
  // está activa (bloqueada, vencida, sin código) o ya no está, se regresa a «Mi cuenta», que dice por qué.
  const enUso = usando && data
    ? [...(data.tarjetas?.items ?? []), ...(extra.tarjetas?.items ?? [])].find(c => c.id === usando && c.estado === 'ACTIVA' && c.codigo) ?? null
    : null
  // Pulido W6: el paso anterior que presta lo de adentro (sólo en la tienda) y la subpantalla de «Mi cuenta» abierta (el orden de abajo).
  const [atrasDeDentro, setAtrasDeDentro] = useState<(() => void) | null>(null)
  const prestar = alCambiarAtras ? (f: (() => void) | null) => setAtrasDeDentro(() => f) : undefined
  const subpantalla = !data || !token ? null
    : reentrar ? 'reentrar' : cambiando !== null && cambiando === epocaDe(venueSlug, sup) ? 'cambiando' : enUso ? 'usando' : null
  useEffect(() => {
    if (!alCambiarAtras) return
    const propio = subpantalla === 'reentrar' ? () => setReentrar(false)
      : subpantalla === 'cambiando' ? () => setCambiando(null)
      : subpantalla === 'usando' ? () => setUsando(null)
      : null
    alCambiarAtras(atrasDeDentro ?? propio)
    return () => alCambiarAtras(null)
  }, [atrasDeDentro, subpantalla])

  /** Relee «Mi cuenta» de la superficie (la última lectura gana y deja su estado para todos los lectores; `state/miCuenta.ts`). */
  async function loadPortal() {
    const tkn = tokenActual()
    if (tkn) await leerCuenta(venueSlug, sup, tkn)
  }
  releer.current = loadPortal

  /** W4: «Ver más pedidos / tarjetas / descuentos» trae la página siguiente con la sesión de la superficie. */
  async function verMas(lista: Lista) {
    const tkn = tokenActual()
    const vigentes = () => cuentaDe(venueSlug, sup).peek().data
    const base = vigentes()
    const cursor = extra[lista] ? extra[lista]!.nextCursor : base?.[lista]?.nextCursor
    if (!tkn || !base || !cursor || enVuelo.current.mas) return
    enVuelo.current.mas = true
    const epoca = epocaDe(venueSlug, sup)
    setTrayendo(lista)
    setFallaMas(null)
    try {
      const listar = lista === 'pedidos' ? api.listarMisPedidos : lista === 'tarjetas' ? api.listarMisTarjetas : api.listarMisDescuentos
      const r = await listar(venueSlug, tkn, cursor, sup)
      // Otra sesión, u otros datos (una relectura terminó en medio, aquí o en otro elemento): esta página ya no va con lo que se ve.
      if (vigentes() !== base || epocaDe(venueSlug, sup) !== epoca) return
      setMas(m => {
        const listas = m.base === base ? m.listas : {}
        return { base, listas: { ...listas, [lista]: { items: [...(listas[lista]?.items ?? []), ...r.items], nextCursor: r.nextCursor } } }
      })
    } catch (err: any) {
      if (vigentes() !== base || epocaDe(venueSlug, sup) !== epoca || err?.data?.code === 'CUSTOMER_SESSION_CHANGED') return
      if (err?.status === 401) soltar401(err, tkn)
      else setFallaMas(lista)
    } finally {
      enVuelo.current.mas = false
      setTrayendo(x => (x === lista ? null : x))
    }
  }

  /** W4: «Guardar en mi cuenta» con el código (17 letras y números). No mueve saldo; al guardarla se relee «Mi cuenta». */
  const caracteres = codigo.replace(/[\s-]/g, '').length
  async function guardarTarjeta(e: Event) {
    e.preventDefault()
    const tkn = tokenActual()
    if (!tkn || enVuelo.current.guardar || caracteres !== 17) return
    enVuelo.current.guardar = true
    const epoca = epocaDe(venueSlug, sup)
    setGuardando(true)
    setGuardado(null)
    try {
      await api.guardarTarjeta(venueSlug, tkn, codigo.trim(), sup)
      if (epocaDe(venueSlug, sup) !== epoca) return
      setCodigo('')
      setGuardado({ ok: true, texto: t('cuenta.guardada') })
      void loadPortal()
    } catch (err: any) {
      if (epocaDe(venueSlug, sup) !== epoca) return
      if (err?.status === 401) return void soltar401(err, tkn)
      const texto = err?.data?.code === 'GIFT_CARD_ALREADY_SAVED' ? t('cuenta.yaGuardada')
        : err?.status === 404 ? t('cuenta.noEncontrada')
        : err?.status === 429 ? t('entrar.muchosIntentos')
        : !err?.status ? t('entrar.sinRed')
        : t('errors.generic')
      setGuardado({ ok: false, texto })
    } finally {
      enVuelo.current.guardar = false
      setGuardando(false)
    }
  }

  async function loadPacks() {
    setPacksLoading(true)
    try {
      const result = await api.getCreditPacks(venueSlug)
      setPacks(result)
    } catch {
      // Silently fail — packs section just won't show
    } finally {
      setPacksLoading(false)
    }
  }

  async function handleLogin(e: Event) {
    e.preventDefault()
    if (!email.trim() || !password.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await api.customerLogin(venueSlug, { email: email.trim(), password: password.trim() })
      // S7: la contraseña ya entrega la sesión única, SIN contactos probados (prueba la ficha, no su correo).
      const antes = customerToken.value
      // codex-r3 H7: si el navegador no la dejó guardar, no se entra (r11: lo dice el guardado mismo, sin releer).
      if (setCustomerSession(venueSlug, result.token, result.customer, result.bookingAccess ?? null, []) === 'fallo') return setError(t('entrar.noSeGuardo'))
      // El efecto pide «Mi cuenta» al cambiar el token; si es el mismo (misma ficha, mismo segundo), se pide aquí.
      if (customerToken.value === antes) await loadPortal()
    } catch (err: any) {
      setError(err.data?.message ?? t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * W2: ya entró por `EntrarConCuenta`, que guardó la sesión única: la superficie adopta ESA sesión (r11: sin releer lo guardado; tampoco
   * la vuelve a guardar, codex-r3 H6) y se pide «Mi cuenta». W4: en la tienda la adopta la tienda (`alEntrar`).
   */
  async function handleEntro(r: SesionEmitida) {
    const antes = tokenActual()
    setReentrar(false)
    if (alEntrar) alEntrar(r)
    else entroAqui(venueSlug, r)
    const ahora = tokenActual()
    if (ahora && ahora === antes) await loadPortal()
  }

  function handleLogout() {
    if (alSalir) alSalir()
    else clearCustomerSession(venueSlug)
    setEmail('')
    setPassword('')
    setError(null)
    setEditingProfile(false)
    setShowEmailLogin(false)
  }

  function startEditProfile() {
    const c = data?.customer
    setEditFirstName(c?.firstName || '')
    setEditLastName(c?.lastName || '')
    setEditingProfile(true)
    setProfileSuccess(false)
  }

  async function handleSaveProfile() {
    if (!token) return
    setProfileSaving(true)
    setProfileSuccess(false)
    // codex-r4 R4-2: si la página salió (o cambió de sesión) mientras se guardaba, la respuesta ya no es de nadie que esté adentro.
    const epoca = epocaDe(venueSlug, sup)
    try {
      const updates: Record<string, string> = {}
      const c = data?.customer
      if (editFirstName.trim() !== (c?.firstName || '')) updates.firstName = editFirstName.trim()
      if (editLastName.trim() !== (c?.lastName || '')) updates.lastName = editLastName.trim()

      if (Object.keys(updates).length === 0) {
        setEditingProfile(false)
        return
      }

      const result = await api.updateCustomerProfile(venueSlug, token, updates)

      // Sólo la ficha que respondió: `setCustomerSession` la escribe si sigue siendo la vigente (codex-r3 H2: otra página pudo entrar
      // con otra ficha mientras se guardaba; nunca se le pegan los datos de ésta).
      if (epocaDe(venueSlug, sup) !== epoca) return
      if (result.customer?.id) setCustomerSession(venueSlug, token, result.customer)
      // Reload portal data to refresh everything
      await loadPortal()
      setEditingProfile(false)
      setProfileSuccess(true)
      setTimeout(() => setProfileSuccess(false), 3000)
    } catch (err: any) {
      // codex-r5 E7: un 401 ya dejó la página sin sesión; no se pinta como error.
      if (err?.status !== 401) setError(err.data?.message ?? t('errors.generic'))
    } finally {
      setProfileSaving(false)
    }
  }

  async function handleBuyPack(packId: string) {
    const cust = data?.customer
    if (!cust?.email && !cust?.phone) return
    setCheckoutLoading(packId)
    try {
      // Fase 0.B: the portal is always a logged-in surface — bind the purchase
      // to the session customer (server metadata.customerId), not to the contact.
      const result = await api.createPackCheckout(venueSlug, packId, {
        email: cust.email || undefined,
        phone: cust.phone || '',
        successUrl: window.location.href,
        cancelUrl: window.location.href,
      }, customerToken.value)
      window.location.href = result.checkoutUrl
    } catch (err: any) {
      if (err?.status !== 401) setError(err.data?.message ?? t('errors.generic'))
      setCheckoutLoading(null)
    }
  }

  // Con sesión y «Mi cuenta» todavía sin cargar: cargando (nunca «Entra a tu cuenta» a quien ya entró).
  if (!data && token && !fallaCarga) {
    return (
      <div role="status" aria-label={t('cuenta.actualizando')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0' }}>
        <Spinner size={28} />
      </div>
    )
  }

  if (!data && token && fallaCarga) {
    return (
      <div class="avq-animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '32px 0', textAlign: 'center' }}>
        <p role="alert" style={{ fontSize: '14px', color: 'var(--avq-fg, #111827)', margin: 0 }}>{fallaCarga === 'sinRed' ? t('entrar.sinRed') : t('errors.generic')}</p>
        <Button fullWidth onClick={() => void loadPortal()}>{t('actions.retry')}</Button>
        <Button variant="ghost" fullWidth onClick={handleLogout}>{t('portal.logout')}</Button>
      </div>
    )
  }

  // W4: «Entrar otra vez» (invitada u otra ficha): la misma entrada, con la cuenta todavía abierta detrás.
  if (data && token && reentrar) {
    return (
      <div class="avq-animate-in">
        <EntrarConCuenta slug={venueSlug} negocio={negocio ?? venueInfo.value?.name} t={t} onEntro={r => void handleEntro(r)} alCambiarAtras={prestar} />
        <button type="button" style={botonQuieto} onClick={() => setReentrar(false)}>{t('cuenta.volverACuenta')}</button>
      </div>
    )
  }

  // W6: «Cambiar mi número». La sesión de reemplazo ya quedó guardada: la superficie la adopta como al entrar (sin releer) y «Mi cuenta»
  // se vuelve a leer con ella.
  if (data && token && cambiando !== null && cambiando === epocaDe(venueSlug, sup)) {
    return (
      <div class="avq-animate-in">
        <CambiarNumero
          slug={venueSlug}
          superficie={sup}
          t={t}
          token={tokenActual}
          onListo={(r, numero) => {
            setCambiando(null)
            void handleEntro(r)
            setNumeroNuevo({ epoca: epocaDe(venueSlug, sup), numero })
          }}
          onReentrar={() => { setCambiando(null); setReentrar(true) }}
          onVolver={() => setCambiando(null)}
          on401={soltar401}
          alCambiarAtras={prestar}
        />
      </div>
    )
  }

  if (data && token && enUso) {
    return (
      <div class="avq-animate-in" style={{ textAlign: 'center' }}>
        {actualizando && <p role="status" style={{ ...chico, margin: 0 }}>{t('cuenta.actualizando')}</p>}
        {fallaCarga && <p role="status" style={{ ...chico, margin: 0, color: '#6B4300' }}>{fallaCarga === 'sinRed' ? t('cuenta.sinRedConDatos') : t('cuenta.noSeActualizo')}</p>}
        <h2 tabIndex={-1} style={{ ...grande, fontSize: '26px', margin: '8px 0 0' }}>{t('cuenta.tarjeta')}</h2>
        <p style={{ margin: '8px 0 0', color: 'var(--avq-muted-fg, #4A4A4A)', fontSize: '15px' }}>
          {t('cuenta.saldoEtiqueta')} <b style={{ color: 'var(--avq-fg, #000)' }}>{dinero(enUso.saldo)}</b>
        </p>
        <p style={{ margin: '16px 0 0', fontFamily: 'Figtree, system-ui, sans-serif', fontWeight: '700', fontSize: '23px', letterSpacing: '.06em', color: 'var(--avq-fg, #000)' }}>
          {enUso.codigo}
        </p>
        <p style={{ margin: '12px 0 0', color: 'var(--avq-muted-fg, #5E5E5E)', fontSize: '14px', lineHeight: '1.4' }}>{t('cuenta.usarEnCajaAyuda')}</p>
        <div style={{ marginTop: '20px' }}>
          <Button variant="secondary" fullWidth onClick={() => setUsando(null)}>{t('cuenta.listo')}</Button>
        </div>
      </div>
    )
  }

  // Auth forms — WhatsApp-OTP is primary; email/password is the secondary option.
  if (!data) {
    // W4 (1k): dentro de la tienda, la misma entrada sin contraseña y con «Pedir sin cuenta» (para pedir basta su nombre).
    if (enTienda) {
      return (
        <div class="avq-animate-in">
          <EntrarConCuenta slug={venueSlug} negocio={negocio ?? venueInfo.value?.name} t={t} onEntro={r => void handleEntro(r)} alCambiarAtras={prestar} />
          <p style={{ ...chico, margin: '16px 0 0', textAlign: 'center' }}>{t('cuenta.sinCuentaAyuda')}</p>
          <button type="button" style={botonQuieto} onClick={onBack}>{t('cuenta.pedirSinCuenta')}</button>
        </div>
      )
    }
    // PRIMARY (W2): «Entra a tu cuenta» — WhatsApp, correo o Google, sin contraseña.
    if (!showEmailLogin) {
      return (
        <div class="avq-animate-in">
          <EntrarConCuenta slug={venueSlug} negocio={negocio ?? venueInfo.value?.name} t={t} onEntro={r => void handleEntro(r)} alCambiarAtras={prestar} />

          {/* Reveal the email/password login as a secondary option */}
          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <button
              type="button"
              onClick={() => setShowEmailLogin(true)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', minHeight: '44px',
                color: 'var(--avq-muted-fg, #6b7280)', fontWeight: '500',
                fontSize: '13px', textDecoration: 'underline', textUnderlineOffset: '2px',
              }}
            >
              {t('otp.orPassword')}
            </button>
          </div>

          <div style={{ marginTop: '12px' }}>
            <Button variant="ghost" fullWidth onClick={onBack}>
              {t('portal.backToBooking')}
            </Button>
          </div>
        </div>
      )
    }

    // SECONDARY: correo y contraseña, sólo para quien YA tiene contraseña. Toda cuenta nueva se crea con código
    // (seguridad, 1-oct): el alta con contraseña dejaba quedarse con la cuenta de otro cliente.
    return (
      <div class="avq-animate-in">
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '50%',
            background: 'var(--avq-muted, #f8f9fb)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
          }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--avq-accent, #6366f1)" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--avq-fg, #111827)', margin: '0 0 6px' }}>
            {t('portal.login')}
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>
            {t('portal.subtitle')}
          </p>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={labelStyle}>{t('portal.email')}</label>
            <Input
              type="email"
              value={email}
              placeholder={t('form.emailPlaceholder')}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            />
          </div>

          <div>
            <label style={labelStyle}>{t('portal.password')}</label>
            <Input
              type="password"
              value={password}
              placeholder="••••••"
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            />
          </div>

          {error && (
            <p style={{ fontSize: '13px', color: '#ef4444', margin: 0 }}>{error}</p>
          )}

          <Button type="submit" fullWidth disabled={submitting || !email.trim() || !password.trim()}>
            {submitting ? <Spinner size={18} /> : t('portal.loginButton')}
          </Button>
        </form>

        {/* ¿Sin cuenta? Se crea entrando con código: vuelve a la vista principal */}
        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>
            {t('portal.noAccount')}
            {' '}
            <button
              type="button"
              onClick={() => { setShowEmailLogin(false); setError(null) }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--avq-accent, #6366f1)', fontWeight: '500',
                fontSize: '13px', textDecoration: 'underline', textUnderlineOffset: '2px',
              }}
            >
              {t('portal.enterWithCode')}
            </button>
          </p>
        </div>

        <div style={{ marginTop: '12px' }}>
          <Button variant="ghost" fullWidth onClick={onBack}>
            {t('portal.backToBooking')}
          </Button>
        </div>
      </div>
    )
  }

  // Portal dashboard (authenticated)
  const customer = data.customer
  const totalCredits = data.credits.purchases.reduce((sum, p) =>
    sum + p.itemBalances.reduce((s, b) => s + b.remainingQuantity, 0), 0,
  )
  const hasCredits = data.credits.purchases.length > 0 && totalCredits > 0
  const hasUpcoming = data.reservations.upcoming.length > 0
  const hasPast = data.reservations.past.length > 0
  // 🔴 Ante la duda gana iPhone: es el camino que ya funciona en producción. La liga
  // de escape existe porque la detección falla en tablets raras y navegadores con
  // user-agent modificado.
  const isAndroidDevice = api.esAndroid(navigator.userAgent)

  // W4: lo de «Mi cuenta», sólo lo que llega prendido (un servidor viejo no manda nada de esto y la pantalla sale como antes).
  const intl = t('cuenta.intl')
  const fecha = (iso: string, conAno = false) =>
    new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', ...(conAno ? { year: 'numeric' } : {}), timeZone: timezone }).format(new Date(iso))
  /** `yyyy-MM-dd` (ya en la zona del negocio) sin moverlo de día. */
  const dia = (ymd: string) => new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`))
  const estadoDe = (estado: string, pagado: boolean) =>
    t(`cuenta.estados.${estado === 'PENDING_ACCEPTANCE' && pagado ? 'ACCEPTED' : estado}`).replace(/^cuenta\.estados\..*$/, t('cuenta.estados.OTRO'))
  const pedidos = [...(data.pedidos?.items ?? []), ...(extra.pedidos?.items ?? [])]
  const tarjetas: MiTarjeta[] = [...(data.tarjetas?.items ?? []), ...(extra.tarjetas?.items ?? [])]
  const descuentos = [...(data.descuentos?.items ?? []), ...(extra.descuentos?.items ?? [])]
  const sigue = (l: Lista) => (extra[l] ? extra[l]!.nextCursor : data[l]?.nextCursor ?? null)
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  // codex-w4-r2 #2: el estado y el «pagado» los manda la cuenta recién leída; la línea exacta del seguimiento de este aparato («Paga en
  // caja antes de las 10:42.») sólo si es SU folio y dice lo mismo que la cuenta.
  const suyoDelAparato = pedidoDeHoy && pedidos.find(p => p.trackingToken === pedidoDeHoy.trackingToken)
  const deHoy = suyoDelAparato && suyoDelAparato.estado === pedidoDeHoy!.estado && suyoDelAparato.pagado === pedidoDeHoy!.pagado
    ? pedidoDeHoy
    : (() => {
        const p = suyoDelAparato && !FINALES.has(suyoDelAparato.estado) ? suyoDelAparato
          : pedidos.find(x => !FINALES.has(x.estado) && new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(x.creadoEl)) === hoy)
        if (!p) return null
        const linea = p.estado === 'READY' ? t('cuenta.lineaListo')
          : p.pagado ? t('cuenta.lineaPagado')
          : p.estado === 'PENDING_ACCEPTANCE' ? t('cuenta.pagaEnCaja')
          : p.estado === 'AWAITING_PAYMENT' ? t('cuenta.estados.AWAITING_PAYMENT')
          : t('cuenta.lineaPreparando')
        return { folio: p.folio, estado: p.estado, pagado: p.pagado, linea, trackingToken: p.trackingToken }
      })()
  const verPedido = (tt: string) => (onVerPedido ? onVerPedido(tt) : window.location.assign(trackingUrl(venueSlug, tt)))
  const sellos = data.stampCard?.enabled && customer ? data.stampCard : null
  const hayAlgo = !!(sellos || data.puntos || data.premioDisponible || descuentos.length || tarjetas.length || data.saldoAFavor || pedidos.length
    || hasUpcoming || hasPast || hasCredits || deHoy)
  const verMasBoton = (l: Lista, etiqueta: string, mostrados: number, total: number | undefined) =>
    sigue(l) && (
      <div>
        <small style={{ ...chico, marginTop: '8px' }}>{t('cuenta.deTotal', { n: mostrados, total: total ?? mostrados })}</small>
        <button type="button" style={{ ...botonQuieto, marginTop: '2px' }} disabled={trayendo === l} onClick={() => void verMas(l)}>
          {trayendo === l ? <Spinner size={16} /> : etiqueta}
        </button>
        {fallaMas === l && <small role="status" style={{ ...chico, color: '#6B4300' }}>{t('cuenta.errorMas')}</small>}
      </div>
    )

  return (
    <div class="avq-animate-in">
      {/* W4 (1f): «Hola, Ana» y, mientras relee, «Actualizando…» con lo anterior a la vista. «Cerrar sesión» va al final (1g). */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '16px' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontFamily: 'var(--avq-o-display, inherit)', fontSize: '26px', fontWeight: '800', lineHeight: '1.1', color: 'var(--avq-fg, #111827)', margin: 0 }}>
            {customer
              ? (customer.firstName || customer.email)
                ? `${t('portal.hello')}, ${customer.firstName || customer.email}`
                : t('portal.hello')
              : t('portal.title')}
          </h2>
          {customer?.email && customer.firstName && (
            <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: '4px 0 0' }}>{customer.email}</p>
          )}
          {customer?.phone && (
            <p style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', margin: '1px 0 0' }}>{comoSeLee(customer.phone)}</p>
          )}
          {/* W6: con su código por WhatsApp (una cuenta sin teléfono no lo ve: agregar uno no está pedido). */}
          {customer?.phone && (
            <button type="button" onClick={() => { setNumeroNuevo(null); setCambiando(epocaDe(venueSlug, sup)) }}
              style={{ ...botonQuieto, width: 'auto', justifyContent: 'flex-start', marginTop: 0, padding: 0, fontSize: '13px', textDecoration: 'underline', textUnderlineOffset: '2px' }}>
              {t('cambiarNumero.boton')}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 'none' }}>
          {actualizando && (
            <span role="status" style={{ display: 'inline-flex', alignItems: 'center', height: '32px', padding: '0 12px', borderRadius: '999px', background: 'var(--avq-muted, #F3F3F3)', color: 'var(--avq-fg, #333)', fontSize: '14px', fontWeight: '500', whiteSpace: 'nowrap' }}>
              {t('cuenta.actualizando')}
            </span>
          )}
          {/* El perfil se edita en «Mi cuenta» de reservas (en la tienda, W6 trae «Cambiar mi número»). */}
          {!enTienda && (
            <button
              type="button"
              onClick={startEditProfile}
              style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: '44px', minHeight: '44px', padding: '6px', color: 'var(--avq-muted-fg, #6b7280)' }}
              title={t('portal.editProfile')}
              aria-label={t('portal.editProfile')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {numeroNuevo && numeroNuevo.epoca === epocaDe(venueSlug, sup) && (
        <div role="status" style={{ ...aviso('neutro'), background: '#EAF6EE', color: '#0B6B36', fontWeight: '600' }}>
          {t('cambiarNumero.listo', { numero: numeroNuevo.numero })}
        </div>
      )}

      {/* Releer falló: lo último que supimos sigue a la vista, con calma (ámbar) y «Reintentar». */}
      {fallaCarga && (
        <div role="status" style={{ ...aviso('ambar'), flexDirection: 'row', alignItems: 'center', gap: '12px' }}>
          <span style={{ flex: 1 }}>{fallaCarga === 'sinRed' ? t('cuenta.sinRedConDatos') : t('cuenta.noSeActualizo')}</span>
          <button type="button" style={{ ...botonBlanco, marginTop: 0 }} onClick={() => void loadPortal()}>{t('cuenta.reintentar')}</button>
        </div>
      )}

      {/* Profile success toast */}
      {profileSuccess && (
        <div style={{
          padding: '10px 14px', borderRadius: '10px', marginBottom: '16px',
          background: '#dcfce7', color: '#166534', fontSize: '13px', fontWeight: '500',
        }}>
          {t('portal.profileUpdated')}
        </div>
      )}

      {/* Edit Profile Form */}
      {editingProfile && (
        <div style={{
          borderRadius: '12px', padding: '16px', marginBottom: '20px',
          border: '1px solid var(--avq-border, #e8eaed)', background: 'var(--avq-muted, #f8f9fb)',
        }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)', margin: '0 0 12px' }}>
            {t('portal.editProfile')}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={labelStyle}>{t('portal.firstName')}</label>
              <Input
                type="text"
                value={editFirstName}
                placeholder={t('portal.firstName')}
                onInput={(e) => setEditFirstName((e.target as HTMLInputElement).value)}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('portal.lastName')}</label>
              <Input
                type="text"
                value={editLastName}
                placeholder={t('portal.lastName')}
                onInput={(e) => setEditLastName((e.target as HTMLInputElement).value)}
              />
            </div>
            {/* El teléfono no se edita aquí (seguridad, 1-oct): lo cambia el negocio, para no perder el historial. */}
            <div>
              <label style={labelStyle}>{t('portal.phone')}</label>
              {data?.customer?.phone && (
                <p style={{ fontSize: '14px', color: 'var(--avq-fg, #111827)', margin: '0 0 4px' }}>{comoSeLee(data.customer.phone)}</p>
              )}
              <p style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>{t('portal.phoneChangeHint')}</p>
            </div>
            {error && (
              <p style={{ fontSize: '13px', color: '#ef4444', margin: 0 }}>{error}</p>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <Button variant="ghost" onClick={() => { setEditingProfile(false); setError(null) }}>
                {t('portal.cancel')}
              </Button>
              <Button onClick={handleSaveProfile} disabled={profileSaving}>
                {profileSaving ? <Spinner size={18} /> : t('portal.save')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 1f·2: beneficios en otra ficha (P2-1: no promete unirlas). */}
      {data.otraFicha && (
        <div style={aviso('ambar')}>
          <b>{t('entrar.otraFichaTitulo')}</b>
          <span>{t(data.otraFicha.contacto === 'EMAIL' ? 'entrar.otraFichaCorreo' : 'entrar.otraFichaTelefono')}</span>
          <button type="button" style={{ ...botonBlanco, alignSelf: 'flex-start' }} onClick={() => setReentrar(true)}>
            {t(data.otraFicha.contacto === 'EMAIL' ? 'entrar.entrarConCorreo' : 'entrar.entrarConTelefono')}
          </button>
        </div>
      )}

      {/* S7: sesión sin contacto probado (token de reservas de hoy, contraseña): sus reservas de invitada piden entrar otra vez. */}
      {data.invitadaRequiereEntrar && (
        <div style={aviso('neutro')}>
          <span>{t('cuenta.invitada')}</span>
          <button type="button" style={{ ...botonBlanco, alignSelf: 'flex-start' }} onClick={() => setReentrar(true)}>{t('cuenta.entrarOtraVez')}</button>
        </div>
      )}

      {/* 1f: lo más urgente arriba, su folio de hoy. */}
      {deHoy && (
        <div style={{ ...bloque, display: 'flex', alignItems: 'center', gap: '12px', background: '#EAF6EE' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ ...tituloBloque, color: '#0B6B36' }}>{t('cuenta.pedidoDeHoy')}</p>
            <b style={{ color: '#000', letterSpacing: '0.04em' }}>{`${deHoy.folio} · ${estadoDe(deHoy.estado, deHoy.pagado).toLocaleLowerCase(intl)}`}</b>
            <small style={{ ...chico, color: '#3A4A3F' }}>{deHoy.linea}</small>
          </div>
          <button type="button" style={{ ...botonBlanco, marginTop: 0, background: '#FFF', color: '#000' }} onClick={() => verPedido(deHoy.trackingToken)}>{t('cuenta.ver')}</button>
        </div>
      )}

      {/* Tarjeta de sellos — 🔴 la seccion completa depende de `enabled`, que manda el
          servidor. Dibujar el boton sin ese dato lo haria responder 403 al tocarlo, y
          el cliente creeria que el negocio le esta fallando. */}
      {sellos && customer && (
        <div style={bloque}>
          <p style={tituloBloque}>{t('portal.stampCard')}</p>
          <div aria-hidden="true" style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', margin: '8px 0 6px' }}>
            {Array.from({ length: Math.min(sellos.stampsRequired, 20) }, (_, i) => (
              <i key={i} style={{ width: '20px', height: '20px', borderRadius: '50%', border: '2px solid var(--avq-fg, #000)', background: i < sellos.stampsEarned ? 'var(--avq-fg, #000)' : 'transparent' }} />
            ))}
          </div>
          <small style={chico}>{t('cuenta.llevas', { n: sellos.stampsEarned, total: sellos.stampsRequired })}</small>
          {data.premioDisponible
            ? <span style={{ ...pildora(true), marginTop: '8px' }}>{t('cuenta.premio', { premio: data.premioDisponible.etiqueta })}</span>
            : sellos.rewardLabel && <small style={chico}>{t('cuenta.alCompletar', { premio: sellos.rewardLabel })}</small>}
          <a
            href={isAndroidDevice ? api.googleWalletPassUrl(venueSlug, customer.id) : api.walletPassUrl(venueSlug, customer.id)}
            // 🔴 El portal va incrustado en el sitio del negocio. La liga de Apple dispara
            // una descarga y la página se queda; la de Google hace un 302 a
            // pay.google.com y SE LLEVA el sitio del negocio, sin regreso, si no abre en
            // pestaña nueva. `rel="noopener"` evita que esa pestaña nueva controle la de
            // origen (`window.opener`).
            target="_blank"
            rel="noopener"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '44px', marginTop: '10px', borderRadius: '12px', background: 'var(--avq-fg, #000)', color: 'var(--avq-bg, #FFF)', fontSize: '14px', fontWeight: '600', textDecoration: 'none' }}
          >
            {t('portal.saveCard')}
          </a>
          {/* 🔴 La salida existe porque la detección falla: tablets raras, navegadores
              con user-agent modificado. Sin ella ese cliente se queda sin tarjeta y no
              hay a quién preguntarle en el mostrador. */}
          <p style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', margin: '10px 0 0', textAlign: 'center' }}>
            <a
              href={isAndroidDevice ? api.walletPassUrl(venueSlug, customer.id) : api.googleWalletPassUrl(venueSlug, customer.id)}
              // 🔴 Misma razón que la liga principal: esta es la de escape (la otra
              // cartera), y también puede ser la de Google — mismo riesgo de llevarse el
              // sitio del negocio.
              target="_blank"
              rel="noopener"
              style={{ color: 'var(--avq-muted-fg, #6b7280)' }}
            >
              {t('portal.saveOnOther', { sistema: isAndroidDevice ? 'iPhone' : 'Android' })}
            </a>
          </p>
        </div>
      )}

      {data.puntos && (
        <div style={bloque}>
          <p style={tituloBloque}>{t('cuenta.puntos')}</p>
          <p style={grande}>{t(data.puntos.saldo === 1 ? 'cuenta.unPunto' : 'cuenta.nPuntos', { n: new Intl.NumberFormat(intl).format(data.puntos.saldo) })}</p>
          <small style={chico}>{t('cuenta.valen', { valor: dinero(data.puntos.valor) })}</small>
        </div>
      )}

      {descuentos.length > 0 && (
        <div style={bloque}>
          <p style={tituloBloque}>{t('cuenta.descuentos')}</p>
          {descuentos.map((d, i) => (
            <div key={`${d.nombre}-${i}`} style={{ marginTop: i ? '10px' : 0 }}>
              <b style={{ fontSize: '14px', color: 'var(--avq-fg, #000)' }}>{d.nombre}</b>
              <small style={chico}>{d.vigenteHasta ? t('cuenta.hasta', { fecha: fecha(d.vigenteHasta) }) : t('cuenta.sinVencimiento')}</small>
            </div>
          ))}
          {verMasBoton('descuentos', t('cuenta.verMasDescuentos'), descuentos.length, data.descuentos?.total)}
        </div>
      )}

      {/* 1g: tarjetas que ELLA guardó. Sólo una ACTIVA con código se ofrece para usar; las demás dicen por qué no (R6). */}
      {tarjetas.map(c => (
        <div key={c.id} style={bloque}>
          <p style={tituloBloque}>{t('cuenta.tarjeta')}</p>
          <p style={grande}>{t(c.estado === 'ACTIVA' ? 'cuenta.teQuedan' : 'cuenta.saldo', { saldo: dinero(c.saldo) })}</p>
          <small style={chico}>{[t('cuenta.terminaEn', { last4: c.last4 }), c.venceEl && t('cuenta.venceEl', { fecha: dia(c.venceEl) })].filter(Boolean).join(' · ')}</small>
          {c.estado !== 'ACTIVA'
            ? <small style={chico}>{t(`cuenta.tarjeta${c.estado}`)}</small>
            : c.codigo
              ? <button type="button" style={botonBlanco} onClick={() => setUsando(c.id)}>{t('cuenta.usarEnCaja')}</button>
              : <small style={chico}>{t('cuenta.sinCodigo')}</small>}
        </div>
      ))}
      {tarjetas.length > 0 && sigue('tarjetas') && <div style={{ margin: '-4px 0 12px' }}>{verMasBoton('tarjetas', t('cuenta.verMasTarjetas'), tarjetas.length, data.tarjetas?.total)}</div>}

      {/* R9: el saldo a favor se usa con su teléfono; su código nunca se enseña. */}
      {data.saldoAFavor && (
        <div style={bloque}>
          <p style={tituloBloque}>{t('cuenta.saldoAFavor')}</p>
          <p style={grande}>{dinero(data.saldoAFavor.saldo)}</p>
          <small style={chico}>{data.saldoAFavor.estado === 'ACTIVA' ? t('cuenta.saldoAFavorAyuda') : t(`cuenta.tarjeta${data.saldoAFavor.estado}`)}</small>
        </div>
      )}

      {/* «Guardar en mi cuenta» (S13): sólo con un servidor que lo sabe hacer. */}
      {data.tarjetas !== undefined && (
        <form style={bloque} onSubmit={e => void guardarTarjeta(e)}>
          <p style={tituloBloque}>{t('cuenta.guardarTitulo')}</p>
          <small style={{ ...chico, margin: '0 0 10px' }}>{t('cuenta.guardarAyuda')}</small>
          <label for={idCodigo} style={labelStyle}>{t('cuenta.codigo')}</label>
          <Input
            id={idCodigo}
            type="text"
            value={codigo}
            placeholder="XXXX-XXXX-XXXX-XXXX-X"
            onInput={(e) => { setCodigo((e.target as HTMLInputElement).value); setGuardado(null) }}
          />
          {caracteres !== 17 && <small style={chico}>{t('cuenta.codigoCorto')}</small>}
          {guardado && (
            <small role={guardado.ok ? 'status' : 'alert'} style={{ ...chico, color: guardado.ok ? '#0B6B36' : '#6B4300', fontWeight: '600' }}>{guardado.texto}</small>
          )}
          <div style={{ marginTop: '10px' }}>
            <Button type="submit" variant="secondary" fullWidth disabled={guardando || caracteres !== 17}>
              {guardando ? <Spinner size={18} /> : t('cuenta.guardar')}
            </Button>
          </div>
        </form>
      )}

      {pedidos.length > 0 && (
        <div style={bloque}>
          <p style={tituloBloque}>{t('cuenta.pedidos')}</p>
          {pedidos.map(p => (
            <button
              key={p.trackingToken}
              type="button"
              onClick={() => verPedido(p.trackingToken)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', width: '100%', minHeight: '44px', padding: '6px 0', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', color: 'var(--avq-fg, #000)' }}
            >
              <span style={{ minWidth: 0 }}>
                <b style={{ fontSize: '14px', letterSpacing: '0.04em' }}>{`${p.folio} · ${dinero(p.total)}`}</b>
                <small style={chico}>{fecha(p.creadoEl)}</small>
              </span>
              <span style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '4px' }}>
                <span style={pildora(false)}>{estadoDe(p.estado, p.pagado)}</span>
                {p.pagado && <span style={pildora(true)}>{t('cuenta.pagado')}</span>}
              </span>
            </button>
          ))}
          {verMasBoton('pedidos', t('cuenta.verMasPedidos'), pedidos.length, data.pedidos?.total)}
        </div>
      )}

      {/* Credits */}
      {hasCredits && (
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--avq-accent, #6366f1)" stroke-width="2">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            {t('portal.credits')}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.credits.purchases.map(purchase => (
              <div key={purchase.id} style={{ borderRadius: '12px', padding: '14px', border: '1px solid var(--avq-border, #e8eaed)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--avq-fg, #111827)' }}>{purchase.creditPack.name}</span>
                  {purchase.expiresAt && (
                    <span style={{ fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)' }}>
                      {t('portal.expires', { date: new Date(purchase.expiresAt).toLocaleDateString() })}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {purchase.itemBalances.map(balance => (
                    <div key={balance.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '13px', color: 'var(--avq-fg, #111827)' }}>{balance.product.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '48px', height: '6px', borderRadius: '3px', background: 'var(--avq-muted, #f8f9fb)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: '3px', background: 'var(--avq-accent, #6366f1)', width: `${(balance.remainingQuantity / balance.originalQuantity) * 100}%` }} />
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--avq-accent, #6366f1)' }}>
                          {balance.remainingQuantity}/{balance.originalQuantity}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasCredits && customer && !enTienda && (
        <div style={{ borderRadius: '12px', padding: '14px', background: 'var(--avq-muted, #f8f9fb)', border: '1px solid var(--avq-border, #e8eaed)', textAlign: 'center', marginBottom: '20px' }}>
          <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>{t('portal.noCredits')}</p>
        </div>
      )}

      {/* Buy Credits — header always visible; empty state when no packs.
          Cards no longer have outer border (they live inside a section already);
          rows are separated by a hairline divider for cleaner visual rhythm. */}
      {customer && !enTienda && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{
            fontSize: '11px', fontWeight: '600',
            color: 'var(--avq-muted-fg, #6b7280)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            margin: '0 0 12px',
          }}>
            {t('portal.buyCredits')}
          </h3>
          {packsLoading ? (
            <div style={{ padding: '24px', textAlign: 'center' }}>
              <Spinner size={18} />
            </div>
          ) : packs.length === 0 ? (
            <div style={{
              borderRadius: '12px', padding: '16px',
              background: 'var(--avq-muted, #f8f9fb)',
              textAlign: 'center',
            }}>
              <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: '0 0 12px' }}>
                {t('portal.noPacksAvailable')}
              </p>
              {venuePhone && (
                <div style={{
                  display: 'inline-flex', flexWrap: 'wrap', gap: '8px',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {/* Call: opens dialer on mobile, click-to-call on desktop */}
                  <a
                    href={`tel:${venuePhone}`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '7px 14px', borderRadius: '999px',
                      fontSize: '13px', fontWeight: '600',
                      color: 'var(--avq-accent, #6366f1)',
                      background: 'var(--avq-bg, #fff)',
                      border: '1px solid var(--avq-border, #e8eaed)',
                      textDecoration: 'none',
                      transition: 'background 0.15s var(--avq-ease, ease-out), border-color 0.15s var(--avq-ease, ease-out)',
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                    </svg>
                    {t('portal.callVenue', { phone: venuePhone })}
                  </a>
                  {/* WhatsApp: assumes the venue phone supports WhatsApp.
                      wa.me requires digits only — strip the +, spaces and any punctuation. */}
                  <a
                    href={`https://wa.me/${venuePhone.replace(/\D/g, '')}?text=${encodeURIComponent(t('portal.whatsappMessage'))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '7px 14px', borderRadius: '999px',
                      fontSize: '13px', fontWeight: '600',
                      color: '#fff',
                      background: '#25D366',
                      border: '1px solid #1faa56',
                      textDecoration: 'none',
                      transition: 'opacity 0.15s var(--avq-ease, ease-out)',
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/>
                    </svg>
                    {t('portal.whatsappVenue')}
                  </a>
                </div>
              )}
            </div>
          ) : (
          <div style={{
            display: 'flex', flexDirection: 'column',
            border: '1px solid var(--avq-border, #e8eaed)',
            borderRadius: '14px', overflow: 'hidden',
          }}>
            {packs.map((pack, idx) => (
              <div key={pack.id} style={{
                padding: '16px',
                borderTop: idx > 0 ? '1px solid var(--avq-border, #e8eaed)' : 'none',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--avq-fg, #111827)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pack.name}</div>
                    {pack.description && (
                      <p style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', margin: '3px 0 0' }}>{pack.description}</p>
                    )}
                  </div>
                  <span style={{
                    fontSize: '17px', fontWeight: '700',
                    color: 'var(--avq-fg, #111827)',
                    whiteSpace: 'nowrap', flexShrink: 0,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    ${Number(pack.price).toFixed(0)}
                    <span style={{ fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)', fontWeight: '500', marginLeft: '4px' }}>{pack.currency}</span>
                  </span>
                </div>

                {/* Pack items as inline chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                  {pack.items.map(item => (
                    <span key={item.id} style={{
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                      padding: '3px 9px', borderRadius: '999px',
                      background: 'var(--avq-muted, #f8f9fb)',
                      fontSize: '12px', color: 'var(--avq-fg, #111827)',
                    }}>
                      <strong style={{ fontWeight: '700', color: 'var(--avq-accent, #6366f1)' }}>{item.quantity}×</strong>
                      <span>{item.product.name}</span>
                    </span>
                  ))}
                </div>

                {/* Validity + Buy */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)' }}>
                    {pack.validityDays
                      ? t('portal.packValidity', { days: String(pack.validityDays) })
                      : t('portal.packNoExpiry')}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleBuyPack(pack.id)}
                    disabled={!!checkoutLoading}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      padding: '7px 18px', borderRadius: '999px', fontSize: '13px', fontWeight: '600',
                      background: 'var(--avq-accent, #6366f1)', color: '#fff',
                      border: 'none', cursor: checkoutLoading ? 'not-allowed' : 'pointer',
                      opacity: checkoutLoading ? 0.6 : 1,
                      transition: 'opacity 0.15s var(--avq-ease)',
                    }}
                  >
                    {checkoutLoading === pack.id ? <Spinner size={14} /> : t('portal.buyPack')}
                  </button>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      )}

      {/* Upcoming — en la tienda sólo si tiene alguna (allá no se reserva). */}
      {(!enTienda || hasUpcoming) && <div style={{ marginBottom: '24px' }}>
        <h3 style={{
          fontSize: '11px', fontWeight: '600',
          color: 'var(--avq-muted-fg, #6b7280)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          margin: '0 0 12px',
        }}>
          {t('portal.upcoming')}
        </h3>
        {hasUpcoming ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.reservations.upcoming.map(res => {
              const start = new Date(res.startsAt)
              const end = new Date(res.endsAt)
              const sc = statusConfig[res.status] ?? statusConfig.CONFIRMED
              return (
                <div key={res.confirmationCode} style={{ borderRadius: '12px', padding: '14px', border: '1px solid var(--avq-border, #e8eaed)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '600', background: sc.bg, color: sc.text, padding: '2px 8px', borderRadius: '6px' }}>
                      {t(`status.${res.status}`)}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--avq-muted-fg, #6b7280)', fontWeight: '500' }}>{res.confirmationCode}</span>
                  </div>
                  {res.product && (
                    <p style={{ fontSize: '14px', fontWeight: '500', color: 'var(--avq-fg, #111827)', margin: '0 0 4px' }}>{res.product.name}</p>
                  )}
                  <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: '0 0 10px' }}>
                    {start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone })}
                    {' '}
                    {start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: timezone })}
                    {' - '}
                    {end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: timezone })}
                  </p>
                  <button
                    type="button"
                    onClick={() => onManageBooking(res.cancelSecret)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '500', color: 'var(--avq-accent, #6366f1)', padding: 0, textDecoration: 'underline', textUnderlineOffset: '2px' }}
                  >
                    {t('portal.manage')}
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ borderRadius: '12px', padding: '14px', background: 'var(--avq-muted, #f8f9fb)', border: '1px solid var(--avq-border, #e8eaed)', textAlign: 'center' }}>
            <p style={{ fontSize: '13px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>{t('portal.noUpcoming')}</p>
          </div>
        )}
      </div>}

      {/* Past */}
      {hasPast && (
        <details style={{ marginBottom: '24px' }}>
          <summary style={{
            fontSize: '11px', fontWeight: '600',
            color: 'var(--avq-muted-fg, #6b7280)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            cursor: 'pointer',
            marginBottom: '12px',
          }}>
            {t('portal.pastReservations')}
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {data.reservations.past.map(res => {
              const start = new Date(res.startsAt)
              const sc = statusConfig[res.status] ?? statusConfig.COMPLETED
              return (
                <div key={res.confirmationCode} style={{ borderRadius: '10px', padding: '10px 14px', border: '1px solid var(--avq-border, #e8eaed)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: 0.8 }}>
                  <div>
                    <p style={{ fontSize: '13px', fontWeight: '500', color: 'var(--avq-fg, #111827)', margin: '0 0 2px' }}>{res.product?.name ?? res.guestName}</p>
                    <p style={{ fontSize: '12px', color: 'var(--avq-muted-fg, #6b7280)', margin: 0 }}>{start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: timezone })}</p>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: '600', background: sc.bg, color: sc.text, padding: '2px 8px', borderRadius: '6px' }}>{t(`status.${res.status}`)}</span>
                </div>
              )
            })}
          </div>
        </details>
      )}

      {/* W4: en la tienda, una cuenta sin nada dice por qué está vacía. */}
      {enTienda && !hayAlgo && <p style={{ ...chico, margin: '4px 0 16px', textAlign: 'center' }}>{t('cuenta.vacio')}</p>}

      {/* Actions — «Cerrar sesión» al final, lejos de lo que se toca seguido (1g). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {!enTienda && <Button variant="primary" fullWidth onClick={onBack}>{t('portal.bookNow')}</Button>}
        <button type="button" style={botonQuieto} onClick={handleLogout}>{t('portal.logout')}</button>
      </div>
    </div>
  )
}
