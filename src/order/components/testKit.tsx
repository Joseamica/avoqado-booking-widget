// Ayudas SÓLO para pruebas de las pantallas de la tienda (no entra al bundle: nadie lo importa fuera de *.test.tsx).
import { h } from 'preact'
import { OrderStoreContext, createOrderStore, type OrderStore } from '../store'
import type { Menu, MenuProduct, StoreInfo } from '../types'

let n = 0
export const product = (over: Partial<MenuProduct> = {}): MenuProduct => ({
  id: 'p1', name: 'Flautas de pollo', description: 'Con crema', price: 85, imageUrl: null, soldOut: false, modifierGroups: [], ...over,
})
export const menuOf = (...products: MenuProduct[]): Menu => ({
  generatedAt: '', truncated: false, categories: [{ id: 'c1', name: 'Antojitos', productCount: products.length, products }],
})
export const infoOf = (over: Partial<StoreInfo> = {}): StoreInfo => ({
  venue: { slug: 'a', name: 'Flautas', timezone: 'America/Mexico_City', currency: 'MXN' },
  brand: { logo: null, logoFull: null, primaryColor: null, secondaryColor: null },
  status: 'OPEN', reason: null, hours: null, paymentModes: { payAtPickup: true }, minOrderAmount: 0, estimatedPrepMinutes: 20, acceptTimeoutMinutes: 5,
  ...over,
})
/** Una tienda nueva por prueba (el carrito se guarda por slug en memoria). */
export function makeStore(info: StoreInfo | null, menu: Menu | null, locale: 'es' | 'en' = 'es'): OrderStore {
  const s = createOrderStore(`t${++n}`, { locale })
  s.info.value = info
  s.menu.value = menu
  return s
}
export const withStore = (store: OrderStore, child: any) => <OrderStoreContext.Provider value={store}>{child}</OrderStoreContext.Provider>
