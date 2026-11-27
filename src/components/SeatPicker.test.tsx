import { h } from 'preact'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createT } from '../i18n'
import type { LayoutConfig } from '../types'
import { SeatPicker } from './SeatPicker'

const t = createT('es')
// Un «dado» de 3 × 3 (como la maqueta): cinco máquinas y cuatro huecos; el del centro izquierdo está apagado.
const DADO: LayoutConfig = {
  iconType: 'reformer', rows: 3, cols: 3, showInstructor: true,
  spots: [
    { id: 'p1', row: 0, col: 0, label: '1', enabled: true },
    { id: 'p2', row: 0, col: 2, label: '2', enabled: true },
    { id: 'p3', row: 1, col: 1, label: '3', enabled: true },
    { id: 'p4', row: 2, col: 0, label: '4', enabled: true },
    { id: 'p5', row: 2, col: 2, label: '5', enabled: true },
    { id: 'px', row: 1, col: 0, label: '9', enabled: false },
  ],
}
const OCHO: LayoutConfig = {
  iconType: 'bike', rows: 1, cols: 8, showInstructor: false,
  spots: Array.from({ length: 8 }, (_, i) => ({ id: `b${i + 1}`, row: 0, col: i, label: String(i + 1), enabled: true })),
}

function pintar(extra: Partial<Parameters<typeof SeatPicker>[0]> = {}) {
  const onToggleSpot = vi.fn()
  const onConfirm = vi.fn()
  const r = render(
    <SeatPicker layout={DADO} takenSpotIds={['p2']} selectedSpotIds={[]} onToggleSpot={onToggleSpot} onConfirm={onConfirm} t={t}
      {...extra} />,
  )
  return { ...r, onToggleSpot, onConfirm }
}
const boton = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const css = () => Array.from(document.querySelectorAll('style')).map(s => s.textContent ?? '').join('\n')

afterEach(cleanup)

describe('SeatPicker: el mapa de lugares (pasos-con-aire-v7, paso 3)', () => {
  it('franja del frente «Frente · coach» cuando la clase la enseña; con el nombre de la coach si se sabe', () => {
    const { unmount } = pintar()
    expect(screen.getByText('Frente · coach')).toBeTruthy()
    unmount()
    const r = pintar({ coach: 'Fer' })
    expect(screen.getByText('Frente · Fer (coach)')).toBeTruthy()
    r.unmount()
    pintar({ layout: { ...DADO, showInstructor: false } })
    expect(screen.queryByText(/Frente/)).toBeNull()
  })

  it('respeta los huecos: nueve casillas, cinco lugares y el apagado no se puede tocar', () => {
    pintar()
    const mapa = document.querySelector('.avq-sp-mapa') as HTMLElement
    const casillas = Array.from(mapa.children)
    expect(casillas).toHaveLength(9)
    expect(casillas.map(c => (c.tagName === 'BUTTON' ? c.getAttribute('aria-label') : null))).toEqual([
      'Lugar 1', null, 'Lugar 2, ocupado',
      null, 'Lugar 3', null,
      'Lugar 4', null, 'Lugar 5',
    ])
    expect(screen.queryByRole('button', { name: /Lugar 9/ })).toBeNull()
  })

  it('el ocupado no se elige; el tuyo se marca; tocar uno libre lo pide', () => {
    const { onToggleSpot, unmount } = pintar()
    expect(boton('Lugar 2, ocupado').disabled).toBe(true)
    fireEvent.click(boton('Lugar 2, ocupado'))
    fireEvent.click(boton('Lugar 3'))
    expect(onToggleSpot).toHaveBeenCalledTimes(1)
    expect(onToggleSpot).toHaveBeenCalledWith('p3')
    unmount()
    pintar({ selectedSpotIds: ['p3'] })
    expect(boton('Lugar 3').getAttribute('aria-pressed')).toBe('true')
    expect(boton('Lugar 1').getAttribute('aria-pressed')).toBe('false')
  })

  it('botón «Continuar con el lugar 3»; sin lugar, «Continuar» apagado; con dos, «los lugares 1 y 3»', () => {
    const r1 = pintar()
    expect(boton('Continuar').disabled).toBe(true)
    r1.unmount()
    const r2 = pintar({ selectedSpotIds: ['p3'] })
    fireEvent.click(boton('Continuar con el lugar 3'))
    expect(r2.onConfirm).toHaveBeenCalledTimes(1)
    r2.unmount()
    // En el orden del mapa, no en el que se tocaron.
    pintar({ selectedSpotIds: ['p3', 'p1'] })
    expect(boton('Continuar con los lugares 1 y 3').disabled).toBe(false)
  })

  it('leyenda: Libre · Ocupado · Tu lugar', () => {
    pintar()
    const leyenda = document.querySelector('.avq-sp-leyenda') as HTMLElement
    expect(Array.from(leyenda.querySelectorAll('li')).map(li => li.textContent)).toEqual(['Libre', 'Ocupado', 'Tu lugar'])
  })

  it('con más lugares elegidos que los que quedan: «Sólo queda 1 lugar» y no deja seguir hasta quitar uno', () => {
    const { onConfirm, rerender, onToggleSpot } = pintar({ selectedSpotIds: ['p1', 'p3'], libres: 1 })
    expect(screen.getByRole('alert').textContent).toBe('Sólo queda 1 lugar')
    expect(boton('Continuar con los lugares 1 y 3').disabled).toBe(true)
    fireEvent.click(boton('Continuar con los lugares 1 y 3'))
    expect(onConfirm).not.toHaveBeenCalled()
    rerender(
      <SeatPicker layout={DADO} takenSpotIds={['p2']} selectedSpotIds={['p1']} libres={1} onToggleSpot={onToggleSpot}
        onConfirm={onConfirm} t={t} />,
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(boton('Continuar con el lugar 1').disabled).toBe(false)
    rerender(
      <SeatPicker layout={DADO} takenSpotIds={[]} selectedSpotIds={['p1', 'p3', 'p4']} libres={2} onToggleSpot={onToggleSpot}
        onConfirm={onConfirm} t={t} />,
    )
    expect(screen.getByRole('alert').textContent).toBe('Sólo quedan 2 lugares')
  })

  it('dice de qué clase es el mapa', () => {
    pintar({ contexto: 'Lagree · jueves 26 · 18:15' })
    expect(screen.getByRole('heading', { name: 'Elige tu lugar' })).toBeTruthy()
    expect(screen.getByText('Lagree · jueves 26 · 18:15')).toBeTruthy()
  })

  it('celular (390 px): casillas de al menos 72 px, 24 px de margen y el botón fijo abajo, de 56 px, encima de la barra', () => {
    const r = pintar({ accionFija: true })
    const mapa = () => document.querySelector('.avq-sp-mapa') as HTMLElement
    const movil = () => parseInt(mapa().style.getPropertyValue('--avq-sp-celda-movil'), 10)
    // Tres columnas: las máquinas de 80 px de la maqueta.
    expect(movil()).toBe(80)
    r.unmount()
    pintar({ layout: OCHO, accionFija: true })
    expect(movil()).toBeGreaterThanOrEqual(72)
    const celular = css().match(/@media \(max-width: 640px\)\s*\{([\s\S]*)\}/)?.[1] ?? ''
    // Cada casilla mide lo que diga su variable: en el celular, la de al menos 72 px.
    expect(css()).toMatch(/\.avq-sp-celda\s*\{[^}]*width:\s*var\(--avq-sp-c\)[^}]*height:\s*var\(--avq-sp-c\)/)
    expect(celular).toMatch(/\.avq-sp-mapa\s*\{[^}]*--avq-sp-c:\s*var\(--avq-sp-celda-movil\)/)
    // El mapa está fuera de `.avq-classes-main`: suma 12 px a los 12 px de la página.
    expect(celular).toMatch(/\.avq-sp--fija\s*\{[^}]*padding-inline:\s*12px/)
    expect(celular).toMatch(/\.avq-sp--fija \.avq-sp-accion\s*\{[^}]*position:\s*fixed/)
    expect(celular).toMatch(/\.avq-sp--fija \.avq-sp-accion\s*\{[^}]*bottom:\s*var\(--avq-toast-offset,\s*0px\)/)
    expect(celular).toMatch(/\.avq-sp--fija \.avq-sp-btn\s*\{[^}]*min-height:\s*56px/)
    expect(document.querySelector('.avq-sp--fija .avq-sp-accion')).not.toBeNull()
  })

  it('en la página propia, el botón flotante del chat no tapa «Continuar»: el mapa se anuncia en el elemento, como el detalle', () => {
    const host = document.createElement('avoqado-booking')
    document.body.append(host)
    const contenedor = document.createElement('div')
    host.attachShadow({ mode: 'open' }).append(contenedor)
    const { unmount } = render(
      <SeatPicker layout={DADO} takenSpotIds={[]} selectedSpotIds={[]} onToggleSpot={vi.fn()} onConfirm={vi.fn()} accionFija t={t} />,
      { container: contenedor },
    )
    expect(host.hasAttribute('data-detalle-de-clase')).toBe(true)
    unmount()
    expect(host.hasAttribute('data-detalle-de-clase')).toBe(false)
    host.remove()
  })

  it('sin `accionFija` (cambiar de horario en «Gestionar») el botón no va fijo', () => {
    pintar({ selectedSpotIds: ['p3'] })
    expect(document.querySelector('.avq-sp--fija')).toBeNull()
    expect(boton('Continuar con el lugar 3')).toBeTruthy()
  })
})
