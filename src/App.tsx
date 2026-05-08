import { h } from 'preact'
import type { WidgetProps } from './types'
import { BookingFlow } from './components/BookingFlow'
import { Toast } from './components/ui/Toast'

export default function App(props: WidgetProps) {
  // The default container max-width keeps the booking flow narrow + focused.
  // /classes widens to 1100px (calendar grid + sidebar). /appointments widens
  // modestly to ~880px so the wizard step content + venue sidebar both have
  // room on desktop. The host page (book.avoqado.io) widens its outer .shell
  // accordingly via body.flow-classes / body.flow-appointments.
  const widthClass =
    props.flowType === 'classes'
      ? 'avq-wide'
      : props.flowType === 'appointments'
        ? 'avq-mid'
        : 'max-w-lg'
  return (
    <div
      data-avq-theme={props.theme}
      style={props.accentColor ? `--avq-accent:${props.accentColor}` : undefined}
      class="avq-root"
    >
      <div class={'mx-auto px-4 py-6 ' + widthClass}>
        <BookingFlow props={props} />
      </div>
      <Toast />
    </div>
  )
}
