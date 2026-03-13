/** Shared CSS for all Avoqado widget custom elements. */
export const SHARED_CSS = `
  :host { display: block; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  .avq-root { box-sizing: border-box; }
  *, *::before, *::after { box-sizing: inherit; }
  [data-avq-theme="light"] { --avq-bg: #ffffff; --avq-fg: #111827; --avq-muted: #f8f9fb; --avq-muted-hover: #eef0f4; --avq-muted-fg: #6b7280; --avq-border: #e8eaed; --avq-card-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02); }
  [data-avq-theme="dark"] { --avq-bg: #0f172a; --avq-fg: #f8fafc; --avq-muted: #1e293b; --avq-muted-hover: #334155; --avq-muted-fg: #94a3b8; --avq-border: #334155; --avq-card-shadow: 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2); }
  [data-avq-theme="auto"] { --avq-bg: #ffffff; --avq-fg: #111827; --avq-muted: #f8f9fb; --avq-muted-hover: #eef0f4; --avq-muted-fg: #6b7280; --avq-border: #e8eaed; --avq-card-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02); }
  @media (prefers-color-scheme: dark) {
    [data-avq-theme="auto"] { --avq-bg: #0f172a; --avq-fg: #f8fafc; --avq-muted: #1e293b; --avq-muted-hover: #334155; --avq-muted-fg: #94a3b8; --avq-border: #334155; --avq-card-shadow: 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2); }
  }
  .avq-root { background: var(--avq-bg, #ffffff); color: var(--avq-fg, #111827); }
  .animate-spin { animation: spin 1s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes avq-fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes avq-scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
  @keyframes avq-checkmark { 0% { stroke-dashoffset: 24; } 100% { stroke-dashoffset: 0; } }
  @keyframes avq-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
  .avq-animate-in { animation: avq-fadeIn 0.35s ease-out; }
  .avq-animate-scale { animation: avq-scaleIn 0.3s ease-out; }
  .space-y-1 > * + * { margin-top: 0.25rem; }
  .space-y-1\\.5 > * + * { margin-top: 0.375rem; }
  .space-y-2 > * + * { margin-top: 0.5rem; }
  .space-y-3 > * + * { margin-top: 0.75rem; }
  .space-y-4 > * + * { margin-top: 1rem; }
  .space-y-5 > * + * { margin-top: 1.25rem; }
  .space-y-6 > * + * { margin-top: 1.5rem; }
  .flex { display: flex; }
  .flex-1 { flex: 1 1 0%; }
  .flex-wrap { flex-wrap: wrap; }
  .flex-shrink-0 { flex-shrink: 0; }
  .flex-col { flex-direction: column; }
  .items-center { align-items: center; }
  .items-start { align-items: flex-start; }
  .justify-center { justify-content: center; }
  .justify-between { justify-content: space-between; }
  .gap-1 { gap: 0.25rem; }
  .gap-2 { gap: 0.5rem; }
  .gap-3 { gap: 0.75rem; }
  .gap-4 { gap: 1rem; }
  .grid { display: grid; }
  .grid-cols-7 { grid-template-columns: repeat(7, minmax(0, 1fr)); }
  .w-full { width: 100%; }
  .w-12 { width: 3rem; }
  .h-4 { height: 1rem; }
  .h-5 { height: 1.25rem; }
  .h-8 { height: 2rem; }
  .h-11 { height: 2.75rem; }
  .h-12 { height: 3rem; }
  .h-16 { height: 4rem; }
  .h-1\\.5 { height: 0.375rem; }
  .min-w-\\[72px\\] { min-width: 72px; }
  .max-w-lg { max-width: 32rem; }
  .mx-auto { margin-left: auto; margin-right: auto; }
  .mb-2 { margin-bottom: 0.5rem; }
  .mb-3 { margin-bottom: 0.75rem; }
  .mb-4 { margin-bottom: 1rem; }
  .mb-6 { margin-bottom: 1.5rem; }
  .mt-0\\.5 { margin-top: 0.125rem; }
  .mt-1 { margin-top: 0.25rem; }
  .mt-2 { margin-top: 0.5rem; }
  .mt-8 { margin-top: 2rem; }
  .m-0\\.5 { margin: 0.125rem; }
  .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
  .px-4 { padding-left: 1rem; padding-right: 1rem; }
  .py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
  .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
  .py-2\\.5 { padding-top: 0.625rem; padding-bottom: 0.625rem; }
  .py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
  .py-4 { padding-top: 1rem; padding-bottom: 1rem; }
  .py-6 { padding-top: 1.5rem; padding-bottom: 1.5rem; }
  .py-8 { padding-top: 2rem; padding-bottom: 2rem; }
  .py-16 { padding-top: 4rem; padding-bottom: 4rem; }
  .p-1\\.5 { padding: 0.375rem; }
  .p-4 { padding: 1rem; }
  .pt-2 { padding-top: 0.5rem; }
  .pt-3 { padding-top: 0.75rem; }
  .text-xs { font-size: 0.75rem; line-height: 1rem; }
  .text-sm { font-size: 0.875rem; line-height: 1.25rem; }
  .text-base { font-size: 1rem; line-height: 1.5rem; }
  .text-lg { font-size: 1.125rem; line-height: 1.75rem; }
  .text-xl { font-size: 1.25rem; line-height: 1.75rem; }
  .text-2xl { font-size: 1.5rem; line-height: 2rem; }
  .text-3xl { font-size: 1.875rem; line-height: 2.25rem; }
  .font-medium { font-weight: 500; }
  .font-semibold { font-weight: 600; }
  .font-bold { font-weight: 700; }
  .tracking-wider { letter-spacing: 0.05em; }
  .text-center { text-align: center; }
  .text-left { text-align: left; }
  .text-right { text-align: right; }
  .rounded-lg { border-radius: 0.5rem; }
  .rounded-xl { border-radius: 0.75rem; }
  .rounded-full { border-radius: 9999px; }
  .border { border-width: 1px; border-style: solid; }
  .border-2 { border-width: 2px; border-style: solid; }
  .border-b { border-bottom-width: 1px; border-bottom-style: solid; }
  .border-t { border-top-width: 1px; border-top-style: solid; }
  .relative { position: relative; }
  .fixed { position: fixed; }
  .bottom-4 { bottom: 1rem; }
  .left-1\\/2 { left: 50%; }
  .z-50 { z-index: 50; }
  .-translate-x-1\\/2 { transform: translateX(-50%); }
  .object-cover { object-fit: cover; }
  .overflow-hidden { overflow: hidden; }
  .transition-all { transition: all 0.2s cubic-bezier(0.4,0,0.2,1); }
  .transition-colors { transition: color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease; }
  .transition-opacity { transition: opacity 0.2s ease; }
  .duration-300 { transition-duration: 300ms; }
  .opacity-30 { opacity: 0.3; }
  .opacity-50 { opacity: 0.5; }
  .cursor-not-allowed { cursor: not-allowed; }
  .invisible { visibility: hidden; }
  .shadow-lg { box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05); }
  .focus\\:outline-none:focus { outline: none; }
  .focus\\:ring-2:focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--avq-accent, #6366f1) 25%, transparent); }
  .disabled\\:opacity-50:disabled { opacity: 0.5; }
  .disabled\\:cursor-not-allowed:disabled { cursor: not-allowed; }
  .hover\\:opacity-90:hover { opacity: 0.9; }
  .inline-flex { display: inline-flex; }
  .inline-block { display: inline-block; }
  .block { display: block; }
  .underline { text-decoration: underline; }
  .bg-green-100 { background-color: #dcfce7; }
  .text-green-600 { color: #16a34a; }
  .text-green-800 { color: #166534; }
  .bg-yellow-100 { background-color: #fef9c3; }
  .text-yellow-600 { color: #ca8a04; }
  .text-yellow-800 { color: #854d0e; }
  .bg-red-50 { background-color: #fef2f2; }
  .bg-red-100 { background-color: #fee2e2; }
  .bg-red-600 { background-color: #dc2626; }
  .text-red-600 { color: #dc2626; }
  .text-red-700 { color: #b91c1c; }
  .text-red-800 { color: #991b1b; }
  .border-red-200 { border-color: #fecaca; }
  .border-red-500 { border-color: #ef4444; }
  .hover\\:bg-red-700:hover { background-color: #b91c1c; }
  .bg-blue-100 { background-color: #dbeafe; }
  .text-blue-800 { color: #1e40af; }
  .bg-orange-100 { background-color: #ffedd5; }
  .text-orange-800 { color: #9a3412; }
  .bg-gray-100 { background-color: #f3f4f6; }
  .text-gray-800 { color: #1f2937; }
  .text-white { color: #ffffff; }
  .avq-footer-link { color: var(--avq-muted-fg, #9ca3af); text-decoration: none; display: inline-flex; align-items: center; gap: 6px; transition: color 0.2s ease; }
  .avq-footer-link:hover { color: var(--avq-fg, #111827); }
`

/** Create a Shadow DOM with shared styles and a render container. */
export function createShadowContainer(host: HTMLElement): { shadow: ShadowRoot; container: HTMLDivElement } {
  const shadow = host.attachShadow({ mode: 'open' })
  const styleEl = document.createElement('style')
  styleEl.textContent = SHARED_CSS
  shadow.appendChild(styleEl)
  const container = document.createElement('div')
  shadow.appendChild(container)
  return { shadow, container }
}

/** Read common attributes from a custom element. */
export function readCommonAttrs(el: HTMLElement) {
  return {
    venue: el.getAttribute('venue') ?? '',
    locale: (el.getAttribute('locale') ?? 'es') as 'en' | 'es',
    theme: (el.getAttribute('theme') ?? 'auto') as 'light' | 'dark' | 'auto',
    accentColor: el.getAttribute('accent-color') ?? undefined,
  }
}
