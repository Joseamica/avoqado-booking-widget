import { h } from 'preact'
import type { WidgetProps } from './types'
import { BookingFlow } from './components/BookingFlow'
import { Toast } from './components/ui/Toast'

export default function App(props: WidgetProps) {
  // The default container max-width keeps the booking flow narrow + focused.
  // When the customer enters via /classes, we widen it so the optional desktop
  // sidebar + week-grid Calendar view have room. The host page (book.avoqado.io)
  // also widens its outer .shell when body.flow-classes is set; the two work
  // together so the layout stays consistent across the embedded widget and the
  // hosted page.
  const wide = props.flowType === 'classes'
  return (
    <div
      data-avq-theme={props.theme}
      style={props.accentColor ? `--avq-accent:${props.accentColor}` : undefined}
      class="avq-root"
    >
      <div class={'mx-auto px-4 py-6 ' + (wide ? 'avq-wide' : 'max-w-lg')}>
        <BookingFlow props={props} />
      </div>
      <Toast />
    </div>
  )
}
