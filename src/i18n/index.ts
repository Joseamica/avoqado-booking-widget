import type enCatalog from './en.json'
import en from './en.json'
import es from './es.json'

type Catalog = typeof enCatalog

const catalogs: Record<'en' | 'es', Catalog> = { en, es }

export type TFunction = (key: string, vars?: Record<string, string | number>) => string

export function createT(locale: 'en' | 'es'): TFunction {
  const catalog = catalogs[locale] ?? catalogs.es
  return function t(key: string, vars?: Record<string, string | number>): string {
    const parts = key.split('.')
    let val: any = catalog
    for (const part of parts) {
      val = val?.[part]
    }
    if (typeof val !== 'string') return key
    if (!vars) return val
    return Object.entries(vars).reduce(
      (s, [k, v]) => s.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
      val,
    )
  }
}
