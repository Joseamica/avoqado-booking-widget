import { h } from 'preact'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerPortal } from './CustomerPortal'
import * as api from '../api/booking'
import * as state from '../state/booking'
import { createT } from '../i18n'

vi.mock('../api/booking', async importOriginal => {
  const real = await importOriginal<typeof import('../api/booking')>()
  return { ...real, requestOtp: vi.fn(), verifyOtp: vi.fn(), getCustomerPortal: vi.fn(), getCreditPacks: vi.fn() }
})

function renderPortal(locale: 'es' | 'en' = 'es') {
  return render(
    <CustomerPortal venueSlug="testarudo" timezone="America/Mexico_City" t={createT(locale)} onBack={() => {}} onManageBooking={() => {}} />,
  )
}
function escribir(el: HTMLElement, value: string) {
  fireEvent.input(el, { target: { value } })
}

beforeEach(() => {
  localStorage.clear()
  state.bindCustomerSessionToVenue('testarudo')
  state.customerToken.value = null
  state.customerInfo.value = null
  state.portalData.value = null
  state.portalLoading.value = false
  state.bookingAccess.value = null
  vi.mocked(api.requestOtp).mockResolvedValue({ ok: true })
  vi.mocked(api.verifyOtp).mockResolvedValue({
    token: 'tok', customer: { id: 'c1', firstName: 'Ana', lastName: null, email: null, phone: '+525544422262' },
  })
  // La prueba se queda en el alta: el portal ya cargado no es lo que se mide aquí.
  vi.mocked(api.getCustomerPortal).mockRejectedValue(new Error('la prueba no carga el portal'))
  vi.mocked(api.getCreditPacks).mockResolvedValue([])
})
afterEach(() => cleanup())

describe('CustomerPortal: «¿Cómo te llamas?» en el alta por código', () => {
  it('sin nombre no pide el código y lo dice en español', async () => {
    renderPortal()
    escribir(screen.getByPlaceholderText('Tu número de teléfono'), '5544422262')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
    expect(await screen.findByText('Escribe tu nombre.')).toBeTruthy()
    expect(api.requestOtp).not.toHaveBeenCalled()
  })

  it('por WhatsApp manda el nombre recortado como firstName al verificar', async () => {
    renderPortal()
    escribir(screen.getByLabelText('¿Cómo te llamas?'), '  Ana  ')
    escribir(screen.getByPlaceholderText('Tu número de teléfono'), '5544422262')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
    await screen.findByText('Te enviamos un código por WhatsApp')
    escribir(screen.getAllByRole('textbox')[0], '123456')
    await waitFor(() =>
      expect(api.verifyOtp).toHaveBeenCalledWith('testarudo', { phone: '+525544422262', code: '123456', firstName: 'Ana' }),
    )
  })

  it('por correo también lo pide y lo manda', async () => {
    renderPortal()
    fireEvent.click(screen.getByRole('button', { name: 'Usar correo' }))
    escribir(screen.getByPlaceholderText('tucorreo@email.com'), 'ana@correo.mx')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
    expect(await screen.findByText('Escribe tu nombre.')).toBeTruthy()
    expect(api.requestOtp).not.toHaveBeenCalled()
    escribir(screen.getByLabelText('¿Cómo te llamas?'), 'Ana')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
    await screen.findByText('Te enviamos un código a tu correo')
    escribir(screen.getAllByRole('textbox')[0], '123456')
    await waitFor(() =>
      expect(api.verifyOtp).toHaveBeenCalledWith('testarudo', { email: 'ana@correo.mx', code: '123456', firstName: 'Ana' }),
    )
  })

  it('en inglés el campo dice «What\'s your name?» y tiene tope de 60', () => {
    renderPortal('en')
    const campo = screen.getByLabelText("What's your name?") as HTMLInputElement
    expect(campo.maxLength).toBe(60)
  })
})
