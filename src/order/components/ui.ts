// Estilos compartidos de las pantallas de la tienda (en línea: el Shadow DOM de la tienda llega con la tarea 11).
export const btn = (primary = false) => ({
  font: 'inherit', cursor: 'pointer', borderRadius: '10px', padding: '10px 14px',
  border: primary ? 'none' : '1px solid var(--avq-border, #e8eaed)',
  background: primary ? 'var(--avq-accent, #111827)' : 'var(--avq-bg, #fff)',
  color: primary ? '#fff' : 'var(--avq-fg, #111827)',
})
export const muted = { color: 'var(--avq-muted-fg, #6b7280)', fontSize: '13px' }
export const banner = { padding: '10px 14px', borderRadius: '10px', background: 'var(--avq-muted, #f8f9fb)', margin: '0 0 12px', fontSize: '14px' }
