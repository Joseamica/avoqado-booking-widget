import { h } from 'preact'

// Íconos de trazo que usan varias pantallas de la tienda (los de un solo lugar viven en su componente).

/** La flecha de volver: carrito, tus datos y código. */
export const Back = () => (
  <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

/** El «+» de agregar: la fila de la carta y «Agregar algo más». */
export const Plus = () => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)
