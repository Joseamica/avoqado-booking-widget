import { h } from 'preact'

interface StepIndicatorProps {
  currentStep: number
  totalSteps: number
  labels: string[]
}

export function StepIndicator({ currentStep, totalSteps, labels }: StepIndicatorProps) {
  return (
    <div style={{ marginBottom: '28px', padding: '0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
        {/* Connecting line (background) */}
        <div style={{
          position: 'absolute', top: '14px', left: '20px', right: '20px',
          height: '2px', background: 'var(--avq-border, #e8eaed)',
          borderRadius: '1px',
        }} />
        {/* Connecting line (progress) */}
        <div style={{
          position: 'absolute', top: '14px', left: '20px',
          height: '2px', borderRadius: '1px',
          background: 'var(--avq-accent, #6366f1)',
          width: `calc(${((currentStep - 1) / Math.max(totalSteps - 1, 1)) * 100}% - ${currentStep === 1 ? 0 : 0}px)`,
          transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
          maxWidth: 'calc(100% - 40px)',
        }} />

        {labels.map((label, i) => {
          const stepNum = i + 1
          const isActive = stepNum === currentStep
          const isDone = stepNum < currentStep

          return (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', position: 'relative', zIndex: 1 }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px', fontWeight: '600',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                ...(isDone ? {
                  background: 'var(--avq-accent, #6366f1)',
                  color: '#ffffff',
                  border: '2px solid var(--avq-accent, #6366f1)',
                } : isActive ? {
                  background: 'var(--avq-bg, #ffffff)',
                  color: 'var(--avq-accent, #6366f1)',
                  border: '2px solid var(--avq-accent, #6366f1)',
                  boxShadow: '0 0 0 4px color-mix(in srgb, var(--avq-accent, #6366f1) 12%, transparent)',
                } : {
                  background: 'var(--avq-bg, #ffffff)',
                  color: 'var(--avq-muted-fg, #9ca3af)',
                  border: '2px solid var(--avq-border, #e8eaed)',
                }),
              }}>
                {isDone ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : (
                  stepNum
                )}
              </div>
              <span style={{
                fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap',
                color: isActive
                  ? 'var(--avq-accent, #6366f1)'
                  : isDone
                    ? 'var(--avq-fg, #111827)'
                    : 'var(--avq-muted-fg, #9ca3af)',
                transition: 'color 0.2s ease',
              }}>
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
