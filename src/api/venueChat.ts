// Public venue-chat client. The widget is unauthenticated until it owns a
// session accessToken (returned by POST /sessions), then carries it as
// Authorization: Bearer for poll + send.

const BASE = (import.meta.env?.VITE_API_URL as string | undefined) ?? 'https://api.avoqado.io/api/v1/public'

interface CreateSessionBody {
  venueSlug: string
  name: string
  email?: string
  message: string
  flowOrigin: 'appointments' | 'classes' | 'packs'
  clientSessionNonce: string
}

export interface ChatMessage {
  id: string
  sessionId: string
  direction: 'INBOUND_FROM_CUSTOMER' | 'INBOUND_FROM_VENUE'
  body: string
  createdAt: string
}

export interface CreateSessionResponse {
  sessionId: string
  shortCode: string
  accessToken: string
  messages: ChatMessage[]
}

export interface PollResponse {
  messages: ChatMessage[]
  nextCursor: string | null
  sessionStatus: 'OPEN' | 'CLOSED_BY_INACTIVITY' | 'CLOSED_BY_VENUE_DEACTIVATION' | 'CLOSED_BY_CUSTOMER'
}

export class VenueNotAvailableError extends Error {
  constructor() {
    super('venue_not_available')
    this.name = 'VenueNotAvailableError'
  }
}

export async function createSession(body: CreateSessionBody): Promise<CreateSessionResponse> {
  const r = await fetch(`${BASE}/venue-chat/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
    body: JSON.stringify(body),
  })
  if (r.status === 409) {
    const data = (await r.json().catch(() => ({}))) as { error?: string }
    // 409 means either nonce_collision (rare; widget retries with fresh nonce)
    // or venue_not_available (venue is not in RELAY mode → widget falls back
    // to wa.me with the venue's phone).
    if (data?.error === 'venue_not_available') throw new VenueNotAvailableError()
    throw new Error(data?.error ?? 'conflict')
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<CreateSessionResponse>
}

export interface PostMessageResponse {
  id: string
  createdAt: string
  direction: string
  body: string
  relayStatus: string
}

export async function postMessage(
  sessionId: string,
  token: string,
  body: string,
  clientMessageId: string,
): Promise<PostMessageResponse> {
  const r = await fetch(`${BASE}/venue-chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'ngrok-skip-browser-warning': '1',
    },
    body: JSON.stringify({ body, clientMessageId }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<PostMessageResponse>
}

export async function pollMessages(
  sessionId: string,
  token: string,
  opts: { after?: string | null; visible: boolean; limit?: number },
): Promise<PollResponse> {
  const qs = new URLSearchParams()
  if (opts.after) qs.set('after', opts.after)
  qs.set('visible', String(opts.visible))
  qs.set('limit', String(opts.limit ?? 50))
  const r = await fetch(`${BASE}/venue-chat/sessions/${sessionId}/messages?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, 'ngrok-skip-browser-warning': '1' },
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<PollResponse>
}

// Email-link resume: customer arrives via `#chat-resume=<sessionId>` URL
// fragment. Posting their on-file email mints a fresh accessToken (the old
// hash gets rotated server-side).
export async function resumeSession(sessionId: string, email: string): Promise<{ accessToken: string }> {
  const r = await fetch(`${BASE}/venue-chat/sessions/${sessionId}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
    body: JSON.stringify({ email }),
  })
  if (r.status === 404) throw new Error('not_found')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<{ accessToken: string }>
}
