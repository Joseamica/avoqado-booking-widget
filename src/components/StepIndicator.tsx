import { h } from 'preact'

interface StepIndicatorProps {
  currentStep: number
  totalSteps: number
  labels: string[]
}

export function StepIndicator({ currentStep, totalSteps, labels }: StepIndicatorProps) {
  return (
    <div class="mb-6">
      {/* Progress bar */}
      <div class="mb-3 h-1.5 w-full rounded-full bg-[var(--avq-muted,#f3f4f6)]">
        <div
          class="h-full rounded-full bg-[var(--avq-accent,#6366f1)] transition-all duration-300"
          style={{ width: `${((currentStep - 1) / Math.max(totalSteps - 1, 1)) * 100}%` }}
        />
      </div>
      {/* Labels */}
      <div class="flex justify-between">
        {labels.map((label, i) => {
          const stepNum = i + 1
          const isActive = stepNum === currentStep
          const isDone = stepNum < currentStep
          return (
            <span
              key={label}
              class={`text-xs font-medium transition-colors ${isActive ? 'text-[var(--avq-accent,#6366f1)]' : isDone ? 'text-[var(--avq-muted-fg,#6b7280)]' : 'text-[var(--avq-muted-fg,#6b7280)] opacity-50'}`}
            >
              {label}
            </span>
          )
        })}
      </div>
    </div>
  )
}
