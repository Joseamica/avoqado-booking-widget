import { h } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { createSession, pollMessages, postMessage, resumeSession, VenueNotAvailableError, type ChatMessage } from '../api/venueChat'
import { clearSession, loadSession, saveSession } from '../state/venueChatSession'

type ModalState =
  | { kind: 'closed' }
  | { kind: 'form' }
  | { kind: 'resume'; sessionId: string }
  | { kind: 'chat'; sessionId: string; accessToken: string }
  | { kind: 'closed_session' }

interface Props {
  venueSlug: string
  venuePhone: string | null
  flowOrigin?: 'appointments' | 'classes' | 'packs'
  // i18n-lite: the widget already chose a locale upstream; we accept Spanish
  // by default and let the parent override if it ever localizes the FAB.
  locale?: 'es' | 'en'
  /** Hide the in-shadow-DOM FAB. Host pages (book.avoqado.io) render their
   *  own "Text us" pill in the light DOM and open the modal via the
   *  `avoqado:open-chat` window event. */
  hideFab?: boolean
}

// Sticky FAB bottom-right that opens a venue chat modal. The modal hosts a
// short form on first open and, after the customer sends their first
// message, flips to a chat view that polls the server every 5s while
// visible. Persists session+token to localStorage so refreshing the page
// preserves the conversation.
export function VenueChatModal({ venueSlug, venuePhone, flowOrigin = 'appointments', hideFab = false }: Props) {
  const [state, setState] = useState<ModalState>({ kind: 'closed' })
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ---- Initial mount: check URL fragment for email-link resume ----
  useEffect(() => {
    const hash = new URLSearchParams(location.hash.slice(1))
    const resumeSid = hash.get('chat-resume')
    if (resumeSid) {
      setState({ kind: 'resume', sessionId: resumeSid })
      // Scrub the fragment so a refresh doesn't loop into the resume prompt.
      history.replaceState(null, '', location.pathname + location.search)
    }
  }, [])

  // ---- Open handler: hydrate from localStorage if a session exists ----
  const openModal = useCallback(() => {
    setError(null)
    if (state.kind === 'resume') return // already in resume flow
    const stored = loadSession(venueSlug)
    if (stored?.sessionId && stored?.accessToken) {
      setState({ kind: 'chat', sessionId: stored.sessionId, accessToken: stored.accessToken })
    } else {
      setState({ kind: 'form' })
    }
  }, [state.kind, venueSlug])

  // External trigger: host pages (book.avoqado.io) render their own FAB in
  // the light DOM and dispatch this window event to open the modal that lives
  // inside the shadow DOM. Listening on window lets us cross the shadow
  // boundary without exposing a programmatic API surface.
  useEffect(() => {
    const onOpen = () => openModal()
    window.addEventListener('avoqado:open-chat', onOpen)
    return () => window.removeEventListener('avoqado:open-chat', onOpen)
  }, [openModal])

  const closeModal = useCallback(() => {
    setState({ kind: 'closed' })
    setError(null)
  }, [])

  return (
    <div class="avq-chat-root">
      {!hideFab && (state.kind === 'closed' || state.kind === 'closed_session') ? (
        <button type="button" class="avq-chat-fab" onClick={openModal} aria-label="Envíanos un mensaje">
          <span class="avq-chat-fab-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <span class="avq-chat-fab-label">Envíanos un mensaje</span>
        </button>
      ) : null}

      {state.kind !== 'closed' ? (
        <div class="avq-chat-overlay" role="dialog" aria-modal="true" aria-label="Chat con el venue">
          <div class="avq-chat-modal">
            <header class="avq-chat-modal-head">
              <strong>Mensaje al venue</strong>
              <button type="button" class="avq-chat-close" onClick={closeModal} aria-label="Cerrar">
                ×
              </button>
            </header>

            {state.kind === 'form' ? (
              <FormView
                venueSlug={venueSlug}
                venuePhone={venuePhone}
                flowOrigin={flowOrigin}
                submitting={submitting}
                error={error}
                setSubmitting={setSubmitting}
                setError={setError}
                onCreated={result => {
                  saveSession(venueSlug, { sessionId: result.sessionId, accessToken: result.accessToken })
                  setMessages(result.messages ?? [])
                  setState({ kind: 'chat', sessionId: result.sessionId, accessToken: result.accessToken })
                }}
              />
            ) : state.kind === 'resume' ? (
              <ResumeView
                sessionId={state.sessionId}
                venueSlug={venueSlug}
                onResumed={token => {
                  saveSession(venueSlug, { sessionId: state.sessionId, accessToken: token })
                  setState({ kind: 'chat', sessionId: state.sessionId, accessToken: token })
                }}
                onCancel={closeModal}
              />
            ) : state.kind === 'chat' ? (
              <ChatView
                sessionId={state.sessionId}
                accessToken={state.accessToken}
                venueSlug={venueSlug}
                messages={messages}
                setMessages={setMessages}
                onSessionClosed={() => {
                  clearSession(venueSlug)
                  setState({ kind: 'closed_session' })
                }}
              />
            ) : (
              <p class="avq-chat-info">La conversación terminó. Puedes abrir un nuevo chat cuando quieras.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

interface FormViewProps {
  venueSlug: string
  venuePhone: string | null
  flowOrigin: 'appointments' | 'classes' | 'packs'
  submitting: boolean
  error: string | null
  setSubmitting: (v: boolean) => void
  setError: (msg: string | null) => void
  onCreated: (result: { sessionId: string; accessToken: string; messages: ChatMessage[] }) => void
}

function FormView({ venueSlug, venuePhone, flowOrigin, submitting, error, setSubmitting, setError, onCreated }: FormViewProps) {
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const msgRef = useRef<HTMLTextAreaElement>(null)

  const onSubmit = async (e: Event) => {
    e.preventDefault()
    const name = (nameRef.current?.value ?? '').trim()
    const email = (emailRef.current?.value ?? '').trim() || undefined
    const message = (msgRef.current?.value ?? '').trim()
    if (name.length < 2 || message.length < 3) {
      setError('Completa tu nombre y un mensaje breve.')
      return
    }
    const clientSessionNonce = newUuid()
    setSubmitting(true)
    setError(null)
    try {
      const result = await createSession({ venueSlug, name, email, message, flowOrigin, clientSessionNonce })
      onCreated(result)
    } catch (err) {
      if (err instanceof VenueNotAvailableError) {
        // Venue not in RELAY → fallback to wa.me with the venue's phone.
        if (venuePhone) {
          const url = `https://wa.me/${venuePhone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
          window.open(url, '_blank', 'noopener,noreferrer')
        } else {
          setError('El venue todavía no tiene WhatsApp configurado. Intenta más tarde.')
        }
      } else {
        setError('No pudimos enviar tu mensaje. Intenta de nuevo.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form class="avq-chat-form" onSubmit={onSubmit}>
      <label>
        Nombre
        <input ref={nameRef} type="text" required maxLength={80} placeholder="Tu nombre" />
      </label>
      <label>
        Email (opcional, para recibir respuesta)
        <input ref={emailRef} type="email" maxLength={120} placeholder="tu@email.com" />
      </label>
      <label>
        Mensaje
        <textarea ref={msgRef} required maxLength={1500} rows={4} placeholder="¿En qué te podemos ayudar?" />
      </label>
      {error ? <p class="avq-chat-error">{error}</p> : null}
      <button type="submit" class="avq-chat-submit" disabled={submitting}>
        {submitting ? 'Enviando…' : 'Enviar mensaje'}
      </button>
    </form>
  )
}

interface ChatViewProps {
  sessionId: string
  accessToken: string
  venueSlug: string
  messages: ChatMessage[]
  setMessages: (m: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  onSessionClosed: () => void
}

function ChatView({ sessionId, accessToken, venueSlug, messages, setMessages, onSessionClosed }: ChatViewProps) {
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)
  const cursorRef = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Append new messages by id (cheap O(n) dedupe — venue chats are short).
  const mergeMessages = useCallback(
    (incoming: ChatMessage[]) => {
      if (!incoming.length) return
      setMessages(prev => {
        const seen = new Set(prev.map(m => m.id))
        const fresh = incoming.filter(m => !seen.has(m.id))
        if (!fresh.length) return prev
        return [...prev, ...fresh]
      })
    },
    [setMessages],
  )

  const pollOnce = useCallback(async () => {
    try {
      const out = await pollMessages(sessionId, accessToken, {
        after: cursorRef.current,
        visible: document.visibilityState === 'visible',
      })
      if (out.messages?.length) {
        mergeMessages(out.messages)
        if (out.nextCursor) {
          cursorRef.current = out.nextCursor
          saveSession(venueSlug, { sessionId, accessToken, lastCursor: out.nextCursor })
        } else {
          const last = out.messages[out.messages.length - 1]
          // Encode a fallback cursor client-side so subsequent polls don't
          // re-fetch the messages we already have (no server cursor means
          // the page was shorter than the limit).
          cursorRef.current = encodeCursor(last.createdAt, last.id)
        }
      }
      if (out.sessionStatus && out.sessionStatus !== 'OPEN') onSessionClosed()
    } catch {
      // Transient network failure — next tick will retry.
    }
  }, [sessionId, accessToken, venueSlug, mergeMessages, onSessionClosed])

  // Polling loop tied to visibility. When the tab is hidden we still tick
  // every 5s but skip the network call; on visibilitychange→visible we
  // force an immediate poll to catch up.
  useEffect(() => {
    let active = true
    void pollOnce()
    const interval = window.setInterval(() => {
      if (!active) return
      if (document.visibilityState === 'visible') void pollOnce()
    }, 5000)
    const onVis = () => {
      if (document.visibilityState === 'visible') void pollOnce()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      active = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [pollOnce])

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages.length])

  const onSend = async () => {
    const body = composer.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const row = await postMessage(sessionId, accessToken, body, newUuid())
      mergeMessages([
        {
          id: row.id,
          sessionId,
          direction: 'INBOUND_FROM_CUSTOMER',
          body: row.body,
          createdAt: row.createdAt,
        },
      ])
      setComposer('')
    } catch {
      // Soft-fail: leave composer text so customer can retry.
    } finally {
      setSending(false)
    }
  }

  return (
    <div class="avq-chat-view">
      <div class="avq-chat-messages" ref={listRef}>
        {messages.length === 0 ? (
          <p class="avq-chat-info">Esperando respuesta del venue…</p>
        ) : (
          messages.map(m => (
            <div
              key={m.id}
              class={'avq-chat-bubble ' + (m.direction === 'INBOUND_FROM_VENUE' ? 'avq-chat-bubble-venue' : 'avq-chat-bubble-customer')}
            >
              <div class="avq-chat-bubble-body">{m.body}</div>
              <div class="avq-chat-bubble-time">{formatTime(m.createdAt)}</div>
            </div>
          ))
        )}
      </div>
      <div class="avq-chat-composer">
        <textarea
          value={composer}
          onInput={e => setComposer((e.target as HTMLTextAreaElement).value)}
          maxLength={1500}
          rows={2}
          placeholder="Escribe tu mensaje…"
        />
        <button type="button" class="avq-chat-send" onClick={onSend} disabled={sending || composer.trim().length === 0}>
          {sending ? '…' : 'Enviar'}
        </button>
      </div>
    </div>
  )
}

function ResumeView({
  sessionId,
  venueSlug: _venueSlug,
  onResumed,
  onCancel,
}: {
  sessionId: string
  venueSlug: string
  onResumed: (token: string) => void
  onCancel: () => void
}) {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: Event) => {
    e.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const { accessToken } = await resumeSession(sessionId, email.trim())
      onResumed(accessToken)
    } catch {
      setError('No encontramos la conversación con ese correo.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form class="avq-chat-form" onSubmit={onSubmit}>
      <p class="avq-chat-info">Confirma tu correo para abrir la conversación.</p>
      <label>
        Email
        <input
          type="email"
          required
          maxLength={120}
          value={email}
          onInput={e => setEmail((e.target as HTMLInputElement).value)}
          placeholder="tu@email.com"
        />
      </label>
      {error ? <p class="avq-chat-error">{error}</p> : null}
      <div style="display:flex;gap:8px;">
        <button type="submit" class="avq-chat-submit" disabled={submitting}>
          {submitting ? 'Verificando…' : 'Abrir conversación'}
        </button>
        <button type="button" class="avq-chat-cancel" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `cm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function encodeCursor(createdAt: string, id: string): string {
  // Mirrors the server's base64url-of-JSON encoding so we can keep polling
  // without losing position if the server omits nextCursor on short pages.
  const json = JSON.stringify({ createdAt, id })
  return btoa(json).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
