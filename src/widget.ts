import { render, h } from 'preact'
import App from './App'
import { PortalApp } from './components/PortalApp'
import { BookButtonApp } from './components/BookButtonApp'
import type { WidgetProps } from './types'
import { createShadowContainer, readCommonAttrs } from './shared-styles'

// ==================== <avoqado-booking> ====================
// Full all-in-one widget (booking flow + portal + credit packs)

class AvoqadoBookingWidget extends HTMLElement {
  private _container: HTMLDivElement | null = null

  static get observedAttributes() {
    return ['venue', 'locale', 'theme', 'accent-color', 'mode', 'service-id', 'button-text', 'flow-type']
  }

  connectedCallback() {
    const { container } = createShadowContainer(this)
    this._container = container
    this._render()
  }

  disconnectedCallback() {
    if (this._container) render(null, this._container)
  }

  attributeChangedCallback() {
    if (this._container) this._render()
  }

  open() { this.dispatchEvent(new CustomEvent('_avq_open', { bubbles: false })) }
  close() { this.dispatchEvent(new CustomEvent('_avq_close', { bubbles: false })) }

  private getProps(): WidgetProps {
    const common = readCommonAttrs(this)
    // Whitelist accepted flow types — anything else (including missing attr or
    // typos) collapses to 'unified' so unknown values can never break rendering.
    const rawFlowType = this.getAttribute('flow-type')
    const flowType: WidgetProps['flowType'] =
      rawFlowType === 'appointments' || rawFlowType === 'classes' ? rawFlowType : 'unified'
    return {
      ...common,
      mode: (this.getAttribute('mode') ?? 'inline') as 'inline' | 'button' | 'popup',
      serviceId: this.getAttribute('service-id') ?? undefined,
      buttonText: this.getAttribute('button-text') ?? undefined,
      flowType,
      hostElement: this,
    }
  }

  private _render() {
    if (!this._container) return
    render(h(App, this.getProps()), this._container)
  }
}

// ==================== <avoqado-portal> ====================
// Standalone customer portal (login/register/account dashboard)

class AvoqadoPortalWidget extends HTMLElement {
  private _container: HTMLDivElement | null = null

  static get observedAttributes() {
    return ['venue', 'locale', 'theme', 'accent-color']
  }

  connectedCallback() {
    const { container } = createShadowContainer(this)
    this._container = container
    this._render()
  }

  disconnectedCallback() {
    if (this._container) render(null, this._container)
  }

  attributeChangedCallback() {
    if (this._container) this._render()
  }

  private _render() {
    if (!this._container) return
    const common = readCommonAttrs(this)
    render(h(PortalApp, common), this._container)
  }
}

// ==================== <avoqado-book-button> ====================
// Button that opens a modal with the full booking flow

class AvoqadoBookButton extends HTMLElement {
  private _container: HTMLDivElement | null = null

  static get observedAttributes() {
    return ['venue', 'locale', 'theme', 'accent-color', 'button-text', 'service-id']
  }

  connectedCallback() {
    const { container } = createShadowContainer(this)
    this._container = container
    this._render()
  }

  disconnectedCallback() {
    if (this._container) render(null, this._container)
  }

  attributeChangedCallback() {
    if (this._container) this._render()
  }

  private _render() {
    if (!this._container) return
    const common = readCommonAttrs(this)
    render(h(BookButtonApp, {
      ...common,
      buttonText: this.getAttribute('button-text') ?? undefined,
      serviceId: this.getAttribute('service-id') ?? undefined,
      hostElement: this,
    }), this._container)
  }
}

// ==================== Register custom elements ====================

if (!customElements.get('avoqado-booking')) {
  customElements.define('avoqado-booking', AvoqadoBookingWidget)
}
if (!customElements.get('avoqado-portal')) {
  customElements.define('avoqado-portal', AvoqadoPortalWidget)
}
if (!customElements.get('avoqado-book-button')) {
  customElements.define('avoqado-book-button', AvoqadoBookButton)
}

// ==================== Auto-discovery ====================
// Scan for [data-avoqado] elements and mount the corresponding widget.
// Usage: <div data-avoqado="booking" data-venue="my-venue"></div>

const COMPONENT_MAP: Record<string, string> = {
  booking: 'avoqado-booking',
  portal: 'avoqado-portal',
  'book-button': 'avoqado-book-button',
}

// Transfer data-* attributes to the custom element
function transferAttrs(source: HTMLElement, target: HTMLElement) {
  const attrMap: Record<string, string> = {
    'data-venue': 'venue',
    'data-locale': 'locale',
    'data-theme': 'theme',
    'data-accent-color': 'accent-color',
    'data-mode': 'mode',
    'data-service-id': 'service-id',
    'data-button-text': 'button-text',
    'data-flow-type': 'flow-type',
  }
  for (const [dataAttr, widgetAttr] of Object.entries(attrMap)) {
    const val = source.getAttribute(dataAttr)
    if (val) target.setAttribute(widgetAttr, val)
  }
}

function autoDiscover() {
  const elements = document.querySelectorAll<HTMLElement>('[data-avoqado]')
  elements.forEach(el => {
    // Skip if already mounted
    if (el.hasAttribute('data-avoqado-mounted')) return

    const type = el.getAttribute('data-avoqado') ?? ''
    const tagName = COMPONENT_MAP[type]
    if (!tagName) return

    const widget = document.createElement(tagName)
    transferAttrs(el, widget)
    el.appendChild(widget)
    el.setAttribute('data-avoqado-mounted', 'true')
  })
}

// Run auto-discovery when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoDiscover)
} else {
  autoDiscover()
}
