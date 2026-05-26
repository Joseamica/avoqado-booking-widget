/** Fonts that don't need fetching (system default / already shipped). */
const SKIP = new Set(['DM Sans'])
const loaded = new Set<string>()

/**
 * Inject a Google Fonts stylesheet for `family` into document.head once.
 * Idempotent. `@font-face` declared in the document cascades into the widget's
 * Shadow DOM (fonts are not scoped to a shadow root), so setting `font-family`
 * on the widget root (`--avq-font`) is enough to apply it.
 */
export function loadBrandingFont(family: string | null | undefined): void {
  if (!family || SKIP.has(family) || loaded.has(family)) return
  if (typeof document === 'undefined') return
  loaded.add(family)
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700&display=swap`
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.dataset.avqFont = family
  document.head.appendChild(link)
}
