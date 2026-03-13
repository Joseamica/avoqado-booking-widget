import { h } from 'preact'
import { useState } from 'preact/hooks'
import App from '../App'
import type { WidgetProps } from '../types'
import { createT } from '../i18n'

interface BookButtonAppProps {
  venue: string
  locale: 'en' | 'es'
  theme: 'light' | 'dark' | 'auto'
  accentColor?: string
  buttonText?: string
  serviceId?: string
  hostElement: HTMLElement
}

/**
 * A button that opens a modal overlay with the full booking flow.
 * Used as <avoqado-book-button venue="slug"> on any page.
 */
export function BookButtonApp(props: BookButtonAppProps) {
  const [open, setOpen] = useState(false)
  const t = createT(props.locale)
  const text = props.buttonText || t('actions.open')

  const widgetProps: WidgetProps = {
    venue: props.venue,
    locale: props.locale,
    theme: props.theme,
    accentColor: props.accentColor,
    mode: 'inline',
    serviceId: props.serviceId,
    hostElement: props.hostElement,
  }

  return (
    <div data-avq-theme={props.theme} style={props.accentColor ? `--avq-accent:${props.accentColor}` : undefined} class="avq-root">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 24px',
          borderRadius: '12px',
          border: 'none',
          background: 'var(--avq-accent, #6366f1)',
          color: '#ffffff',
          fontSize: '15px',
          fontWeight: '600',
          cursor: 'pointer',
          transition: 'opacity 0.2s ease',
          fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.9' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {text}
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
          />

          {/* Modal content */}
          <div
            class="avq-animate-scale"
            style={{
              position: 'relative', zIndex: 1,
              width: '100%', maxWidth: '480px', maxHeight: '90vh',
              margin: '16px',
              borderRadius: '20px',
              background: 'var(--avq-bg, #ffffff)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
              overflow: 'auto',
            }}
          >
            {/* Close button */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                position: 'sticky', top: '12px', float: 'right',
                marginRight: '12px', marginTop: '12px',
                width: '32px', height: '32px', borderRadius: '50%',
                border: 'none', background: 'var(--avq-muted, #f8f9fb)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 2,
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--avq-fg, #111827)" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <App {...widgetProps} />
          </div>
        </div>
      )}
    </div>
  )
}
