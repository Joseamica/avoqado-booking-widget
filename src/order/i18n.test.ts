import { describe, expect, it } from 'vitest'
import { createOrderT } from './i18n'
import es from '../i18n/es.json'
import en from '../i18n/en.json'

describe('textos de la tienda', () => {
  it('interpola y devuelve la llave cruda si falta', () => {
    const t = createOrderT('es')
    expect(t('modifiers.pickUpTo', { n: 3 })).toBe('Elige hasta 3')
    expect(t('modifiers.pickUpTo')).toBe('Elige hasta {{n}}')
    expect(t('no.existe')).toBe('no.existe')
    expect(t('modifiers')).toBe('modifiers')
  })
  it('en inglés', () => {
    expect(createOrderT('en')('modifiers.required')).toBe('Required')
  })
  it('las llaves de opciones son las mismas que en reservas', () => {
    for (const [lang, booking] of [['es', es], ['en', en]] as const) {
      const t = createOrderT(lang)
      for (const k of ['required', 'optional', 'pickOne', 'pickUpTo'])
        expect(t(`modifiers.${k}`)).toBe((booking as any).modifiers[k])
    }
  })
  it('es y en tienen exactamente las mismas llaves', async () => {
    const keys = (o: any, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort()
    const [tes, ten] = await Promise.all([import('./i18n/es.json'), import('./i18n/en.json')])
    expect(keys(ten.default)).toEqual(keys(tes.default))
  })
  it('idioma desconocido cae a es', () => {
    expect(createOrderT('fr')('modifiers.required')).toBe('Requerido')
  })
})
