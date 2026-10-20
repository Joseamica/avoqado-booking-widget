import { describe, expect, it } from 'vitest'
import { createOrderT } from './i18n'
import es from '../i18n/es.json'
import en from '../i18n/en.json'

describe('textos de la tienda', () => {
  it('interpola y devuelve la llave cruda si falta', () => {
    const t = createOrderT('es')
    expect(t('modifiers.chooseUpTo', { n: 3 })).toBe('Elige hasta 3')
    expect(t('modifiers.chooseUpTo')).toBe('Elige hasta {{n}}')
    expect(t('no.existe')).toBe('no.existe')
    expect(t('modifiers')).toBe('modifiers')
  })
  it('en inglés', () => {
    expect(createOrderT('en')('modifiers.mandatory')).toBe('Required')
  })
  it('«Opcional» (la única llave de opciones que la tienda comparte con reservas) dice lo mismo que en reservas', () => {
    for (const [lang, booking] of [['es', es], ['en', en]] as const) {
      expect(createOrderT(lang)('modifiers.optional')).toBe((booking as any).modifiers.optional)
    }
  })
  it('es y en tienen exactamente las mismas llaves', async () => {
    const keys = (o: any, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort()
    const [tes, ten] = await Promise.all([import('./i18n/es.json'), import('./i18n/en.json')])
    expect(keys(ten.default)).toEqual(keys(tes.default))
  })
  it('idioma desconocido cae a es', () => {
    expect(createOrderT('fr')('modifiers.mandatory')).toBe('Obligatorio')
  })
})
