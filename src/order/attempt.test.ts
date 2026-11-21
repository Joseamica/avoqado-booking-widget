import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginAttempt, newAttemptKey, pendingAttempt, settleAttempt, soltarCompraConTarjeta } from './attempt'
import { soltarLaPagina } from '../lib/sesionDeCliente'
import type { CreateOrderBody } from './types'

const KEY_RE = /^[A-Za-z0-9_-]{32,64}$/

const body = (expectedTotal = '206.00'): CreateOrderBody => ({
  items: [{ productId: 'p-flauta', quantity: 2, modifiers: [{ modifierId: 'm-salsa', quantity: 1 }] }],
  paymentMode: 'PAY_AT_PICKUP',
  expectedTotal,
  customer: { name: 'Ana López', phone: '+525544422262' },
})

beforeEach(() => sessionStorage.clear())
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('newAttemptKey', () => {
  it('32 bytes de crypto.getRandomValues en base64url: 43 caracteres válidos para Idempotency-Key', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const key = newAttemptKey()
    expect(key).toMatch(KEY_RE)
    expect(key).toHaveLength(43)
    expect(spy).toHaveBeenCalledTimes(1)
    expect((spy.mock.calls[0][0] as Uint8Array).length).toBe(32)
    expect(newAttemptKey()).not.toBe(key)
  })

  it('no usa crypto.randomUUID (no existe fuera de HTTPS ni en navegadores viejos)', () => {
    // Un `crypto` sin `randomUUID`: si el código lo llamara, lanzaría TypeError.
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    expect(newAttemptKey()).toMatch(KEY_RE)
  })
})

describe('beginAttempt / pendingAttempt / settleAttempt', () => {
  it('guarda {key, body} en `avq_order_attempt:<slug>` ANTES de devolverlo', () => {
    const a = beginAttempt('flautas-coyoacan', body())!
    expect(a.key).toMatch(KEY_RE)
    expect(a.body).toEqual(body())
    expect(a.startedAt).toEqual(expect.any(Number))
    expect(JSON.parse(sessionStorage.getItem('avq_order_attempt:flautas-coyoacan')!)).toEqual(a)
    expect(pendingAttempt('flautas-coyoacan')).toEqual(a)
  })

  it('sobrevive a recargar la página (módulo nuevo, misma sessionStorage)', async () => {
    const a = beginAttempt('flautas-coyoacan', body())!
    vi.resetModules()
    const fresh = await import('./attempt')
    expect(fresh.pendingAttempt('flautas-coyoacan')).toEqual(a)
  })

  it('con un intento sin desenlace, beginAttempt devuelve ESE (misma llave, mismo cuerpo), nunca uno nuevo', () => {
    const a = beginAttempt('flautas-coyoacan', body('206.00'))!
    const b = beginAttempt('flautas-coyoacan', body('300.00'))!
    expect(b).toEqual(a)
    expect(pendingAttempt('flautas-coyoacan')!.body.expectedTotal).toBe('206.00')
  })

  it('settleAttempt lo borra; el siguiente intento lleva otra llave; cada negocio tiene el suyo', () => {
    const a = beginAttempt('flautas-coyoacan', body())!
    const otro = beginAttempt('otro-negocio', body())!
    settleAttempt('flautas-coyoacan')
    expect(pendingAttempt('flautas-coyoacan')).toBeNull()
    expect(pendingAttempt('otro-negocio')).toEqual(otro)
    const b = beginAttempt('flautas-coyoacan', body('300.00'))!
    expect(b.key).not.toBe(a.key)
    expect(b.body.expectedTotal).toBe('300.00')
  })

  it('sin intento guardado o con uno dañado ⇒ null', () => {
    expect(pendingAttempt('flautas-coyoacan')).toBeNull()
    sessionStorage.setItem('avq_order_attempt:flautas-coyoacan', '{no es json')
    expect(pendingAttempt('flautas-coyoacan')).toBeNull()
    sessionStorage.setItem('avq_order_attempt:flautas-coyoacan', JSON.stringify({ key: 'corta', body: body(), startedAt: 1 }))
    expect(pendingAttempt('flautas-coyoacan')).toBeNull()
  })

  it('si sessionStorage lanza al leerlo, beginAttempt devuelve null (y entonces no se envía)', () => {
    vi.spyOn(globalThis, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError')
    })
    expect(beginAttempt('flautas-coyoacan', body())).toBeNull()
    expect(pendingAttempt('flautas-coyoacan')).toBeNull()
    expect(() => settleAttempt('flautas-coyoacan')).not.toThrow()
  })

  it('sin `crypto` no hay llave: beginAttempt devuelve null y no guarda nada', () => {
    vi.stubGlobal('crypto', undefined)
    expect(beginAttempt('flautas-coyoacan', body())).toBeNull()
    expect(sessionStorage.getItem('avq_order_attempt:flautas-coyoacan')).toBeNull()
  })

  it('si guardar lanza (cuota llena, modo privado), beginAttempt devuelve null', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('lleno', 'QuotaExceededError')
    })
    expect(beginAttempt('flautas-coyoacan', body())).toBeNull()
    expect(pendingAttempt('flautas-coyoacan')).toBeNull()
  })
})

describe('ronda 2 #1 (Ruling 54): la compra con tarjeta en curso se comparte entre las pestañas del navegador', () => {
  const tarjeta = (over: Partial<CreateOrderBody> = {}): CreateOrderBody => ({ ...body(), paymentMode: 'CARD_ONLINE', ...over })
  /** Otra pestaña del mismo navegador: su sessionStorage empieza vacía; la localStorage es la misma. */
  const otraPestana = () => sessionStorage.clear()
  beforeEach(() => localStorage.clear())

  it('la pestaña duplicada (misma sesión, mismos datos) reusa el intento de la primera: el servidor devuelve su borrador', () => {
    const a = beginAttempt('flautas', tarjeta(), 'tok-A')!
    otraPestana()
    const b = beginAttempt('flautas', tarjeta(), 'tok-A')!
    expect(b).toEqual(a)
    expect(pendingAttempt('flautas')).toEqual(a) // queda como el intento de ESTA pestaña: sus reintentos llevan lo mismo
    // «Mi equipo» sin sesión: sin token en las dos, también.
    localStorage.clear()
    otraPestana()
    const c = beginAttempt('flautas', tarjeta())!
    otraPestana()
    expect(beginAttempt('flautas', tarjeta())!.key).toBe(c.key)
  })

  it('ronda 3 (Ruling 54 enmendada): otra sesión con el mismo carrito (otra clienta en el mismo navegador) es otra compra', () => {
    const a = beginAttempt('flautas', tarjeta(), 'tok-A')!
    otraPestana()
    expect(beginAttempt('flautas', tarjeta(), 'tok-B')!.key).not.toBe(a.key)
    localStorage.clear()
    otraPestana()
    const conSesion = beginAttempt('flautas', tarjeta(), 'tok-A')!
    otraPestana()
    expect(beginAttempt('flautas', tarjeta(), null)!.key).not.toBe(conSesion.key) // sin sesión no toma la de alguien con sesión
  })

  it('ronda 3: la misma sesión con un dato corregido (correo, teléfono, nombre, nota o premio) es otra compra', () => {
    const corregidos: Partial<CreateOrderBody>[] = [
      { customer: { name: 'Ana López', phone: '+525544422262', email: 'ana@correo.mx' } },
      { customer: { name: 'Ana López', phone: '+525500000000' } },
      { customer: { name: 'Ana', phone: '+525544422262' } },
      { note: 'sin cebolla' },
      { beneficios: { premioId: 'r1' } },
    ]
    for (const c of corregidos) {
      localStorage.clear()
      otraPestana()
      const a = beginAttempt('flautas', tarjeta(), 'tok-A')!
      otraPestana()
      expect(beginAttempt('flautas', tarjeta(c), 'tok-A')!.key, JSON.stringify(c)).not.toBe(a.key)
    }
  })

  it('ronda 3: «Cerrar sesión» (en la tienda o en reservas) borra la compra compartida, con sus datos y su sesión', () => {
    for (const superficie of ['pedidos', 'reservas'] as const) {
      localStorage.clear()
      otraPestana()
      const a = beginAttempt('flautas', tarjeta(), 'tok-A')!
      settleAttempt('flautas', { trackingToken: 'D'.repeat(32) })
      expect(localStorage.getItem('avq_card_attempt:flautas')).toContain('tok-A')
      soltarLaPagina('flautas', superficie, undefined, () => null)
      expect(localStorage.getItem('avq_card_attempt:flautas'), superficie).toBeNull()
      otraPestana()
      expect(beginAttempt('flautas', tarjeta(), 'tok-A')!.key).not.toBe(a.key)
    }
  })

  it('otro carrito, o pagar en caja: un intento nuevo (la caja nunca se comparte)', () => {
    const a = beginAttempt('flautas', tarjeta())!
    otraPestana()
    expect(beginAttempt('flautas', tarjeta({ items: [{ productId: 'p-flauta', quantity: 3, modifiers: [] }] }))!.key).not.toBe(a.key)
    // En caja, el mismo carrito tampoco se comparte: cada pestaña el suyo, como hoy.
    otraPestana()
    const caja = beginAttempt('flautas', body())!
    otraPestana()
    expect(beginAttempt('flautas', body())!.key).not.toBe(caja.key)
  })

  it('con su página de pago abierta sigue compartida; resuelta (o sin página) ya no: la siguiente es nueva', () => {
    const a = beginAttempt('flautas', tarjeta())!
    settleAttempt('flautas', { trackingToken: 'D'.repeat(32) }) // borrador esperando su pago, con su página
    expect(pendingAttempt('flautas')).toBeNull()
    otraPestana()
    expect(beginAttempt('flautas', tarjeta())!.key).toBe(a.key)
    settleAttempt('flautas') // la respuesta ya no dejó página abierta (pagado, vencido o un rechazo)
    otraPestana()
    expect(beginAttempt('flautas', tarjeta())!.key).not.toBe(a.key)
  })

  it('el seguimiento la vio resuelta: soltarCompraConTarjeta la suelta (sólo la de ESE seguimiento)', () => {
    const a = beginAttempt('flautas', tarjeta())!
    settleAttempt('flautas', { trackingToken: 'D'.repeat(32) })
    soltarCompraConTarjeta('flautas', 'E'.repeat(32)) // otro pedido: no la toca
    otraPestana()
    expect(beginAttempt('flautas', tarjeta())!.key).toBe(a.key)
    settleAttempt('flautas', { trackingToken: 'D'.repeat(32) })
    soltarCompraConTarjeta('flautas', 'D'.repeat(32))
    otraPestana()
    expect(beginAttempt('flautas', tarjeta())!.key).not.toBe(a.key)
  })

  it('a los 35 min de su última página abierta (lo que el SERVIDOR deja abierta la de Stripe) deja de compartirse', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const a = beginAttempt('flautas', tarjeta())!
      settleAttempt('flautas', { trackingToken: 'D'.repeat(32) })
      vi.setSystemTime(Date.now() + 34 * 60_000)
      otraPestana()
      expect(beginAttempt('flautas', tarjeta())!.key).toBe(a.key)
      otraPestana()
      vi.setSystemTime(Date.now() + 2 * 60_000)
      expect(beginAttempt('flautas', tarjeta())!.key).not.toBe(a.key)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ronda 3 (Minor 3): si su página sigue abierta en un reintento (el SERVIDOR la renueva), los 35 min vuelven a contar', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const a = beginAttempt('flautas', tarjeta())!
      settleAttempt('flautas', { trackingToken: 'D'.repeat(32) })
      vi.setSystemTime(Date.now() + 30 * 60_000)
      otraPestana()
      expect(beginAttempt('flautas', tarjeta())!.key).toBe(a.key)
      settleAttempt('flautas', { trackingToken: 'D'.repeat(32) }) // su reintento volvió con la página abierta
      vi.setSystemTime(Date.now() + 30 * 60_000)
      otraPestana()
      expect(beginAttempt('flautas', tarjeta())!.key).toBe(a.key)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ronda 3 (Minor 2): una compra vencida se borra al leerla (sus datos y su sesión no se quedan en el navegador)', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      beginAttempt('flautas', tarjeta(), 'tok-A')
      settleAttempt('flautas', { trackingToken: 'D'.repeat(32) })
      expect(localStorage.getItem('avq_card_attempt:flautas')).toContain('tok-A')
      vi.setSystemTime(Date.now() + 36 * 60_000)
      soltarCompraConTarjeta('flautas', 'E'.repeat(32)) // cualquier lectura (aquí, la del seguimiento de otro pedido)
      expect(localStorage.getItem('avq_card_attempt:flautas')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('sin localStorage (bloqueado o lleno), cada pestaña su intento, como antes', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError')
    })
    const a = beginAttempt('flautas', tarjeta())!
    expect(a.key).toMatch(KEY_RE)
    expect(() => settleAttempt('flautas', { trackingToken: 'D'.repeat(32) })).not.toThrow()
    expect(() => soltarCompraConTarjeta('flautas', 'D'.repeat(32))).not.toThrow()
    otraPestana()
    expect(beginAttempt('flautas', tarjeta())!.key).not.toBe(a.key)
  })
})
