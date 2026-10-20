import { h } from 'preact'
import { useContext } from 'preact/hooks'
import { signal, type Signal } from '@preact/signals'
import { OrderStoreContext, type OrderStore } from '../store'
import type { StoreInfo } from '../types'
import { initialsOf } from './theme'

/** El logo de la tienda: el cuadrado, o el ancho si no hay. Un `/info` sin `brand` no tumba la pantalla (el seguimiento no depende de él). */
export const logoOf = (info: StoreInfo | null): string | null => info?.brand?.logo || info?.brand?.logoFull || null

// La LIGA del logo que no cargó, por tienda (un WeakMap, como `checkoutOf`). El logo se pinta en la portada, en la cabecera compacta de
// datos y código y en la tarjeta del carrito: si cada uno recordara lo suyo, cambiar de pantalla volvería a pedir (y a parpadear en
// blanco) una imagen que ya se sabe rota. Se guarda la liga, no un «roto» a secas: una liga nueva (otro /info) se intenta de nuevo.
const broken = new WeakMap<OrderStore, Signal<string | null>>()
const brokenOf = (store: OrderStore) => {
  let s = broken.get(store)
  if (!s) broken.set(store, (s = signal<string | null>(null)))
  return s
}

/**
 * El círculo del restaurante: su logo; sin logo, o con la liga rota, las iniciales del nombre (nunca un hueco). Las iniciales no se leen
 * en voz alta (el nombre ya va al lado) y el logo es una imagen sin texto alternativo. Sin logo y sin letras en el nombre, nada.
 * `small` es el de la cabecera compacta (32 px); sin él, el de la portada (80 px). La tarjeta del carrito lo reajusta por CSS.
 * `name` es el nombre que va al lado cuando no sale de `/info` (el seguimiento lo trae en su respuesta): de él salen las iniciales.
 */
export function VenueMark({ small, name }: { small?: boolean; name?: string }) {
  const store = useContext(OrderStoreContext)!
  const info = store.info.value
  const logo = logoOf(info)
  const bad = brokenOf(store)
  const showLogo = !!logo && bad.value !== logo
  const initials = initialsOf(name || info?.venue.name)
  if (!showLogo && !initials) return null
  return (
    <span class={small ? 'avq-o-mark avq-o-mark--sm' : 'avq-o-mark'} aria-hidden={showLogo ? undefined : 'true'}>
      {showLogo ? <img src={logo!} alt="" onError={() => { bad.value = logo }} /> : initials}
    </span>
  )
}
