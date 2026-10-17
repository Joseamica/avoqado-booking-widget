import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginAttempt, newAttemptKey, pendingAttempt, settleAttempt } from './attempt'
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
