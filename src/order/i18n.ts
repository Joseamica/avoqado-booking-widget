import es from './i18n/es.json'
import en from './i18n/en.json'

const catalogs: Record<string, any> = { es, en }

/** Traductor propio de la tienda: llaves con puntos y `{{var}}`; si falta la llave, la devuelve cruda. */
export function createOrderT(locale: string) {
  const catalog = catalogs[locale] ?? es
  return (key: string, vars?: Record<string, string | number>): string => {
    const text = key.split('.').reduce((o: any, k) => (o && typeof o === 'object' ? o[k] : undefined), catalog)
    if (typeof text !== 'string') return key
    return text.replace(/\{\{(\w+)\}\}/g, (m, v) => (vars && v in vars ? String(vars[v]) : m))
  }
}

export type OrderT = ReturnType<typeof createOrderT>
