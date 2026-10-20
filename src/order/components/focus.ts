/**
 * ¿Nadie tiene el foco? La tienda vive en una sombra: `document.activeElement` sólo ve el host, así que se mira también la raíz del
 * elemento. Sólo si ninguna de las dos tiene algo enfocado (o es el `body`) el foco está perdido; si está en otra parte de la tienda
 * o del sitio, no es nuestro y no se le quita.
 */
export const focusLost = (el: Element) => {
  const inner = (el.getRootNode() as Document | ShadowRoot).activeElement
  return (!inner || inner === document.body) && (!document.activeElement || document.activeElement === document.body)
}
