import { h } from 'preact'
import { act, cleanup, render, screen } from '@testing-library/preact'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PaymentStepHeader } from './PaymentStepHeader'
import { slotHoldExpiresAt } from '../state/booking'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T18:00:00Z')); slotHoldExpiresAt.value = null })
afterEach(() => { cleanup(); slotHoldExpiresAt.value = null; vi.useRealTimers() })

it('expires an already elapsed retention once without throwing or renewing it', async () => {
  const expired = Date.now() - 1000
  slotHoldExpiresAt.value = expired
  const onExpired = vi.fn()
  expect(() => render(<PaymentStepHeader locale="es" onExpired={onExpired} />)).not.toThrow()
  expect(onExpired).toHaveBeenCalledTimes(1)
  expect(slotHoldExpiresAt.value).toBe(expired)
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(onExpired).toHaveBeenCalledTimes(1)
})

it('uses the existing TTL and expires once at zero', async () => {
  slotHoldExpiresAt.value = Date.now() + 2000
  const onExpired = vi.fn()
  render(<PaymentStepHeader locale="es" kind="class" onExpired={onExpired} />)
  expect(screen.getByText('Clase reservada durante 0:02')).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(screen.getByText('Clase reservada durante 0:00')).toBeTruthy()
  expect(onExpired).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(onExpired).toHaveBeenCalledTimes(1)
})


it('does not consume expiry on a fractional second before the authoritative timestamp', async () => {
  const expiry = Date.now() + 2500
  slotHoldExpiresAt.value = expiry
  const onExpired = vi.fn()
  render(<PaymentStepHeader locale="es" onExpired={onExpired} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(onExpired).not.toHaveBeenCalled()
  expect(slotHoldExpiresAt.value).toBe(expiry)
  expect(screen.getByText('Cita reservada durante 0:01')).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(onExpired).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Cita reservada durante 0:00')).toBeTruthy()
  expect(slotHoldExpiresAt.value).toBe(expiry)
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(onExpired).toHaveBeenCalledTimes(1)
})
