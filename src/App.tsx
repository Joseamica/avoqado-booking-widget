import { h } from 'preact'
import type { WidgetProps } from './types'
import { BookingFlow } from './components/BookingFlow'
import { Toast } from './components/ui/Toast'

export default function App(props: WidgetProps) {
  return (
    <div
      data-avq-theme={props.theme}
      style={props.accentColor ? `--avq-accent:${props.accentColor}` : undefined}
      class="avq-root"
    >
      <div class="mx-auto max-w-lg px-4 py-6">
        <BookingFlow props={props} />
      </div>
      <Toast />
    </div>
  )
}
