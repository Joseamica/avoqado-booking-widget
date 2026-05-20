// localStorage hydration so the chat survives page reloads. Key is scoped
// by venue slug so multiple venues open in different tabs don't collide.

const KEY = (slug: string) => `avq:chat:${slug}`

export interface StoredSession {
  sessionId: string
  accessToken: string
  lastCursor?: string | null
}

export function loadSession(slug: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY(slug))
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

export function saveSession(slug: string, s: StoredSession): void {
  try {
    localStorage.setItem(KEY(slug), JSON.stringify(s))
  } catch {
    /* localStorage disabled (Safari private mode, etc.) — silently skip */
  }
}

export function clearSession(slug: string): void {
  try {
    localStorage.removeItem(KEY(slug))
  } catch {
    /* ignore */
  }
}
