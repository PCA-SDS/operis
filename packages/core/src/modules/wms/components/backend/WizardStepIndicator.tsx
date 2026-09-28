import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Check } from 'lucide-react'

export type WizardStep = 1 | 2 | 3

export function WizardStepIndicator({ step }: { step: WizardStep }) {
  const steps = [1, 2, 3] as const

  return (
    <div
      className="flex items-center gap-1.5 pt-1"
      aria-label={`Step ${step} of 3`}
    >
      {steps.map((stepNumber, index) => {
        const completed = stepNumber < step
        const current = stepNumber === step

        return (
          <React.Fragment key={stepNumber}>
            {index > 0 ? (
              <div
                className={cn(
                  'h-0.5 w-4 shrink-0',
                  stepNumber <= step ? 'bg-primary' : 'bg-border',
                )}
                aria-hidden="true"
              />
            ) : null}
            <div
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                completed || current
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
              )}
              aria-current={current ? 'step' : undefined}
            >
              {completed ? <Check className="size-3" aria-hidden="true" /> : stepNumber}
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}
