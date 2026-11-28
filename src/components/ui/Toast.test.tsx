import { h } from 'preact'
import { act, cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { Toast } from './Toast'
import { toastMessage } from '../../state/booking'

afterEach(() => {
  cleanup()
  toastMessage.value = null
})

describe('Toast', () => {
  // Diseño 27-nov: en el celular la página propia tiene una barra fija abajo; ella pone `--avq-toast-offset` (su alto) en el
  // widget y el aviso sube encima de la barra. Sin la variable (computadora, widget pegado en otro sitio) queda donde siempre.
  it('su distancia al borde de abajo suma la variable de la barra de la página (0 si no la hay)', async () => {
    render(<Toast />)
    await act(async () => { toastMessage.value = { text: 'El catálogo se actualizó.', type: 'success' } })
    const aviso = screen.getByText('El catálogo se actualizó.')
    expect(aviso.style.bottom).toBe('calc(16px + var(--avq-toast-offset, 0px))')
    // Arriba de la barra de la página (z-index 45) y debajo de las ventanas del widget (100 en adelante).
    expect(aviso.style.zIndex).toBe('50')
  })
})
