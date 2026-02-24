import { h } from 'preact'

interface StepIndicatorProps {
  currentStep: number
  totalSteps: number
  labels: string[]
}

export function StepIndicator({ currentStep, totalSteps, labels }: StepIndicatorProps) {
  const progress = ((currentStep - 1) / Math.max(totalSteps - 1, 1)) * 100

  return (
    <div style={{ marginBottom: '28px' }}>
      {/* Progress bar */}
      <div style={{
        height: '3px', width: '100%', borderRadius: '99px',
        background: 'var(--avq-muted, #f3f4f6)', marginBottom: '10px', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: '99px',
          background: 'var(--avq-accent, #6366f1)',
          width: `${progress}%`,
          transition: 'width 300ms ease',
        }} />
      </div>

      {/* Step labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {labels.map((label, i) => {
          const stepNum = i + 1
          const isActive = stepNum === currentStep
          const isDone = stepNum < currentStep
          return (
            <span key={label} style={{
              fontSize: '11px', fontWeight: '500',
              color: isActive
                ? 'var(--avq-accent, #6366f1)'
                : isDone
                ? 'var(--avq-muted-fg, #6b7280)'
                : 'var(--avq-border, #e5e7eb)',
              transition: 'color 200ms ease',
            }}>
              {label}
            </span>
          )
        })}
      </div>
    </div>
  )
}
