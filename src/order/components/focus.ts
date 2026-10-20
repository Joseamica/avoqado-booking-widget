/**
 * ¿Nadie tiene el foco? La tienda vive en una sombra: `document.activeElement` sólo ve el host, así que se mira también la raíz del
 * elemento. Sólo si ninguna de las dos tiene algo enfocado (o es el `body`) el foco está perdido; si está en otra parte de la tienda
 * o del sitio, no es nuestro y no se le quita.
 */
export const focusLost = (el: Element) => {
  const inner = (el.getRootNode() as Document | ShadowRoot).activeElement
  return (!inner || inner === document.body) && (!document.activeElement || document.activeElement === document.body)
}

/**
 * Hora del TOQUE de un clic, en el reloj de `performance.now()`: su `timeStamp`, no la hora de atenderlo. Si el hilo se traba tras el primer
 * toque, el segundo espera en la cola y llegaría ya «tarde». La usan las guardas contra el segundo toque de un doble toque (la de la raíz
 * de la tienda en OrderApp y la de «Confirmar pedido»).
 * ponytail: donde el `timeStamp` no es la hora del toque cuenta la de atenderlo, y un toque encolado tras un hilo trabado 400 ms o más
 * todavía pasa (nunca más que sin esto). Pasa en iOS WebKit (Safari y los WKWebView de otras apps), que sintetiza el click del toque en el
 * proceso web con la hora en que lo procesa, y con un `timeStamp` en 0 o de otro reloj (jsdom: Date.now()), que cae a la hora de ahora.
 * Falta confirmarlo en un iPhone real.
 */
export const tapTime = (e: Event) => (e.timeStamp > 0 && e.timeStamp <= performance.now() ? e.timeStamp : performance.now())
