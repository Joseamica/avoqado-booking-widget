/** Las opciones de un renglón en una línea («Mediano, Chipotle Mayo ×2»: la cantidad sólo si pasa de 1). El carrito y el seguimiento. */
export const optionsText = (modifiers: { name: string; quantity: number }[]): string =>
  modifiers.map(m => (m.quantity > 1 ? `${m.name} ×${m.quantity}` : m.name)).join(', ')
